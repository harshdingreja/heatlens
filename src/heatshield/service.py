"""Live pipeline used by the API: today's forecast -> corrected heat index -> alerts.

Steps for each request (results cached for 30 minutes):
1. Live forecast from 4 models (Open-Meteo Forecast API, one call).
2. Recent station observations (Meteostat, GHCNh) for the "recent observed" features.
3. The primary model's recent archived forecasts (Previous Runs API, past 21 days)
   to measure its recent error ("recent_bias_7d").
4. Build the same features the corrector was trained on, predict, add alerts + anomalies.

Only small files from artifacts/ are needed, so this also runs on a free server.
"""
from __future__ import annotations

import json
import time
from datetime import timedelta

import joblib
import numpy as np
import pandas as pd

from heatshield.config import ARTIFACTS, MAX_LEAD_DAYS, TIMEZONE, WEATHER_VARS
from heatshield.features.daily import AFTERNOON, MIN_OBS, calendar_day, daily_max_with_rh
from heatshield.features.heat_indices import heat_index_c
from heatshield.ingest.weather import FORECAST_URL, PREVIOUS_RUNS_URL, get_json, hourly_frame
from heatshield.models.alerts import imd_alert, noaa_alert
from heatshield.models.anomaly import IF_FEATURES, Z_THRESHOLD
from heatshield.models.corrector import StackedCorrector  # noqa: F401  (needed to unpickle the model)
from heatshield.models.corrector import station_normal

CACHE_SECONDS = 30 * 60
_cache: dict[str, tuple[float, object]] = {}


def cached(key: str, fn, ttl: int = CACHE_SECONDS):
    """Tiny in-memory cache: Open-Meteo is free but rate-limited, so reuse recent answers."""
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


# ------------------------------------------------------------ artifacts ---
class Artifacts:
    """Everything trained offline, loaded once."""
    def __init__(self):
        self.meta = json.loads((ARTIFACTS / "corrector_meta.json").read_text())
        self.model = joblib.load(ARTIFACTS / "corrector_final.joblib")
        self.forest = joblib.load(ARTIFACTS / "isolation_forest.joblib")
        self.clim = pd.read_csv(ARTIFACTS / "climatology.csv")
        self.offs = pd.read_csv(ARTIFACTS / "station_offsets.csv")
        st = pd.read_csv(ARTIFACTS / "stations.csv", dtype={"station_id": str}).set_index("key")
        self.station = st.loc["santacruz"]
        self.models = self.meta["models"]
        self.primary = self.meta["primary_raw_model"]


_artifacts: Artifacts | None = None


def artifacts() -> Artifacts:
    global _artifacts
    if _artifacts is None:
        _artifacts = Artifacts()
    return _artifacts


def today_ist() -> pd.Timestamp:
    return pd.Timestamp.now(tz=TIMEZONE).normalize().tz_localize(None)


# --------------------------------------------------------------- inputs ---
def live_forecast_daily(a: Artifacts) -> pd.DataFrame:
    """Daily stats per model for the coming days (only complete 24-hour days)."""
    payload = get_json(FORECAST_URL, {
        "latitude": a.station.latitude, "longitude": a.station.longitude,
        "hourly": ",".join(WEATHER_VARS), "models": ",".join(a.models),
        "forecast_days": MAX_LEAD_DAYS + 2, "timezone": TIMEZONE,
    })
    wide = hourly_frame(payload)
    parts = []
    for m in a.models:   # multi-model answers name columns like temperature_2m_icon_global
        part = wide[["time"] + [f"{v}_{m}" for v in WEATHER_VARS]].copy()
        part.columns = ["time"] + WEATHER_VARS
        part["model"] = m
        parts.append(part)
    # ignore_index: each model part starts at row 0; duplicate row labels would make
    # the "hottest hour" lookup return one row per model instead of one.
    hourly = pd.concat(parts, ignore_index=True).dropna(subset=["temperature_2m", "relative_humidity_2m"])
    daily = daily_max_with_rh(hourly, ["model"], t="temperature_2m", rh="relative_humidity_2m")
    extra = hourly.assign(date=hourly["time"].dt.normalize()).groupby(["model", "date"]).agg(
        n_hours=("time", "size"), wind_mean=("wind_speed_10m", "mean"), sw_max=("shortwave_radiation", "max"))
    daily = daily.merge(extra.reset_index(), on=["model", "date"])
    return daily[daily["n_hours"] == 24]


def recent_obs_daily(a: Artifacts, days: int = 21) -> pd.DataFrame:
    """Last few weeks of station observations as daily max heat index (GHCNh only)."""
    from heatshield.ingest.stations import PARAMETERS, PROVIDER, ms   # imports Meteostat (+SSL fix)
    end = today_ist()
    df = ms.hourly(a.station.station_id, (end - timedelta(days=days)).date(), end.date(),
                   timezone=TIMEZONE, parameters=PARAMETERS, providers=[PROVIDER]).fetch()
    if df is None or df.empty:
        return pd.DataFrame(columns=["date", "hi_max", "tmax", "tmean", "valid"])
    df = df.reset_index()
    df["time"] = df["time"].dt.tz_convert(TIMEZONE).dt.tz_localize(None)
    df[["temp", "rhum"]] = df[["temp", "rhum"]].astype("float64")
    df = df.dropna(subset=["temp", "rhum"])
    df["station"] = "santacruz"
    daily = daily_max_with_rh(df, ["station"])
    counts = df.groupby(df["time"].dt.normalize().rename("date")).agg(
        n_obs=("temp", "size"), n_afternoon=("time", lambda t: t.dt.hour.between(*AFTERNOON).sum()))
    daily = daily.merge(counts.reset_index(), on="date")
    rule = MIN_OBS["santacruz"]
    daily["valid"] = (daily["n_obs"] >= rule["total"]) & (daily["n_afternoon"] >= rule["afternoon"])
    return daily


def recent_raw_errors(a: Artifacts, obs: pd.DataFrame) -> dict[int, pd.Series]:
    """Observed minus raw (primary model) daily max heat index, per lead, for recent days."""
    cols = [f"{v}_previous_day{d}" for d in range(1, MAX_LEAD_DAYS + 1)
            for v in ("temperature_2m", "relative_humidity_2m")]
    payload = get_json(PREVIOUS_RUNS_URL, {
        "latitude": a.station.latitude, "longitude": a.station.longitude, "hourly": ",".join(cols),
        "models": a.primary, "past_days": 21, "forecast_days": 1, "timezone": TIMEZONE,
    })
    h = hourly_frame(payload)
    obs_hi = obs[obs["valid"]].set_index("date")["hi_max"]
    errors = {}
    for lead in range(1, MAX_LEAD_DAYS + 1):
        t, rh = h[f"temperature_2m_previous_day{lead}"], h[f"relative_humidity_2m_previous_day{lead}"]
        hi = pd.Series(heat_index_c(t, rh), index=h["time"]).dropna()
        full = hi.groupby(hi.index.normalize()).agg(["max", "count"])
        raw_daily = full.loc[full["count"] == 24, "max"]          # complete days only
        errors[lead] = (obs_hi - raw_daily).dropna()
    return errors


# ----------------------------------------------------------------- core ---
def build_forecast(days: int = 5) -> dict:
    a = artifacts()
    today = today_ist()
    fc = cached("live_fc", lambda: live_forecast_daily(a))
    obs = cached("recent_obs", lambda: recent_obs_daily(a))
    errors = cached("recent_err", lambda: recent_raw_errors(a, obs))

    valid_obs = obs[obs["valid"] & (obs["date"] <= today - timedelta(days=1))].sort_values("date")
    obs_last = float(valid_obs["hi_max"].iloc[-1]) if len(valid_obs) else np.nan
    obs_7d = float(valid_obs["hi_max"].tail(7).mean()) if len(valid_obs) >= 4 else np.nan

    rows = []
    for lead in range(1, days + 1):
        date = today + timedelta(days=lead)
        row = {"date": date, "lead_days": lead}
        day = fc[fc["date"] == date].set_index("model")
        for m in a.models:
            for v in ["hi_max", "tmax", "rh_at_tmax", "wind_mean", "sw_max"]:
                row[f"{m}_{v}"] = day.at[m, v] if m in day.index else np.nan
        his = [row[f"{m}_hi_max"] for m in a.models]
        row["ens_hi_mean"], row["ens_hi_std"] = np.nanmean(his), np.nanstd(his, ddof=1)
        row["raw_hi"] = row[f"{a.primary}_hi_max"]
        row["obs_hi_last"], row["obs_hi_7d"] = obs_last, obs_7d
        err = errors.get(lead, pd.Series(dtype=float)).tail(7)
        row["recent_bias_7d"] = float(err.mean()) if len(err) >= 3 else np.nan
        row["wbgt_raw"] = day.at[a.primary, "wbgt_max"] if a.primary in day.index else np.nan
        row["tmean_raw"] = day.at[a.primary, "tmean"] if a.primary in day.index else np.nan
        rows.append(row)
    X = pd.DataFrame(rows)
    cday = calendar_day(X["date"])
    X["doy_sin"], X["doy_cos"] = np.sin(2 * np.pi * cday / 365), np.cos(2 * np.pi * cday / 365)
    X["normal_hi"], X["normal_std"] = station_normal(X["date"], "santacruz", a.clim, a.offs)
    X["corrected_hi"] = X["raw_hi"] + a.model.predict(X[a.meta["features"]])

    # Anomalies: compare with the normal for each date; the 3-day departure uses
    # recent observations + the forecast days (so day 1 has some history).
    X["hi_dep"] = X["corrected_hi"] - X["normal_hi"]
    X["z"] = X["hi_dep"] / X["normal_std"]
    o = valid_obs.assign(normal=lambda d: station_normal(d["date"], "santacruz", a.clim, a.offs)[0])
    series = pd.concat([pd.Series((o["hi_max"] - o["normal"]).to_numpy(), index=o["date"]),
                        pd.Series(X["hi_dep"].to_numpy(), index=X["date"])])
    series = series.reindex(pd.date_range(series.index.min(), series.index.max(), freq="D"))
    X["hi_dep_3d"] = X["date"].map(series.rolling(3, min_periods=1).mean())
    X["if_anomaly"] = (a.forest.predict(X[IF_FEATURES]) == -1) & (X["hi_dep"] > 0)

    out_days = []
    for _, r in X.iterrows():
        rh_at = r.get(f"{a.primary}_rh_at_tmax")
        out_days.append({
            "date": r["date"].date().isoformat(), "lead_days": int(r["lead_days"]),
            "tmax_c": _num(r[f"{a.primary}_tmax"]), "rh_at_tmax_pct": _num(rh_at),
            "wind_kmh": _num(r[f"{a.primary}_wind_mean"]), "shortwave_max_wm2": _num(r[f"{a.primary}_sw_max"]),
            "tmean_c": _num(r["tmean_raw"]),
            "heat_index_raw_c": _num(r["raw_hi"]), "heat_index_corrected_c": _num(r["corrected_hi"]),
            "wbgt_c": _num(r["wbgt_raw"]),
            "alert": noaa_alert(r["corrected_hi"]), "imd_alert": imd_alert(r["corrected_hi"]),
            "normal_heat_index_c": _num(r["normal_hi"]), "anomaly_z": _num(r["z"], 2),
            "is_anomaly": bool(r["z"] >= Z_THRESHOLD), "isolation_forest_anomaly": bool(r["if_anomaly"]),
        })
    return {
        "issued": today.date().isoformat(),
        "location": {"name": "Mumbai (Santacruz, IMD 43003)",
                     "lat": float(a.station.latitude), "lon": float(a.station.longitude)},
        "forecast_model": a.primary,
        "corrector": a.meta["final_method"],
        "obs_latest_date": valid_obs["date"].max().date().isoformat() if len(valid_obs) else None,
        "alert_scheme": "NOAA heat index bands (IMD experimental bands also given)",
        "days": out_days,
        "_recent_obs": valid_obs[["date", "tmean", "tmax", "hi_max"]].tail(5),  # for /risk, not in API output
    }


def _num(x, nd: int = 1):
    """Round for JSON; NaN -> None (JSON has no NaN)."""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(x) else round(x, nd)
