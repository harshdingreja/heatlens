"""Turn hourly raw data into DAILY tables (one row per day), with heat indices.

Outputs (data/processed/):
- obs_daily.parquet      : station observations, one row per station-day
- fc_daily.parquet       : archived forecasts, one row per model-station-lead-day
- era5_daily.parquet     : ERA5 at Santacruz, one row per day 1991 -> today
- climatology.parquet    : the "normal" heat index for each calendar day (1991-2020)

Run:  python -m heatlens.features.daily
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from heatlens.config import CLIMATOLOGY_YEARS, DATA_PROCESSED, DATA_RAW
from heatlens.features.heat_indices import heat_index_c, wbgt_bom_c
from heatlens.ingest.weather import load_era5, load_previous_runs

# A day of observations only counts if it is complete enough to trust its maximum.
# Santacruz reports every hour, so we ask for most of the day plus the afternoon.
# Colaba reports only at synoptic hours (05:30, 08:30, 11:30, 14:30, 17:30, 20:30 IST),
# so we just require the two midday reports when the daily peak happens.
MIN_OBS = {"santacruz": {"total": 18, "afternoon": 4}, "colaba": {"total": 3, "afternoon": 2}}
AFTERNOON = (11, 17)  # hours (IST) when the daily heat peak normally happens


def daily_max_with_rh(df: pd.DataFrame, keys: list[str], t="temp", rh="rhum") -> pd.DataFrame:
    """Per group: max heat index, max temp, humidity at the hottest hour, WBGT, means."""
    df = df.copy()
    df["hi"] = heat_index_c(df[t], df[rh])
    df["wbgt"] = wbgt_bom_c(df[t], df[rh])
    df["date"] = df["time"].dt.normalize()
    g = df.groupby(keys + ["date"])
    out = g.agg(tmax=(t, "max"), tmean=(t, "mean"), hi_max=("hi", "max"),
                wbgt_max=("wbgt", "max"), rh_mean=(rh, "mean"))
    idx_hot = g[t].idxmax().dropna()                                  # row of the hottest hour
    out["rh_at_tmax"] = df.loc[idx_hot.values, rh].values if len(idx_hot) == len(out) else np.nan
    return out.reset_index()


def build_obs_daily() -> pd.DataFrame:
    obs = pd.read_parquet(DATA_RAW / "obs_hourly.parquet").dropna(subset=["temp", "rhum"])
    obs["afternoon"] = obs["time"].dt.hour.between(*AFTERNOON)
    counts = obs.groupby(["station", obs["time"].dt.normalize().rename("date")]).agg(
        n_obs=("temp", "size"), n_afternoon=("afternoon", "sum")).reset_index()
    daily = daily_max_with_rh(obs, ["station"]).merge(counts, on=["station", "date"])
    rules = daily["station"].map(MIN_OBS)
    daily["valid"] = (daily["n_obs"] >= rules.str["total"]) & (daily["n_afternoon"] >= rules.str["afternoon"])
    return daily


def build_fc_daily() -> pd.DataFrame:
    """Daily stats of every archived forecast. A day needs all 24 forecast hours."""
    fc = load_previous_runs()
    fc = fc[fc["lead_days"] >= 1]                                   # leads 1..5 are real forecasts
    fc = fc.dropna(subset=["temperature_2m", "relative_humidity_2m"])
    keys = ["model", "station", "lead_days"]
    daily = daily_max_with_rh(fc, keys, t="temperature_2m", rh="relative_humidity_2m")
    extra = fc.assign(date=fc["time"].dt.normalize()).groupby(keys + ["date"]).agg(
        n_hours=("time", "size"), wind_mean=("wind_speed_10m", "mean"),
        sw_max=("shortwave_radiation", "max"))
    daily = daily.merge(extra.reset_index(), on=keys + ["date"])
    return daily[daily["n_hours"] == 24].drop(columns="n_hours")


def build_era5_daily() -> pd.DataFrame:
    era5 = load_era5().dropna(subset=["temperature_2m", "relative_humidity_2m"])
    era5["station"] = "era5"
    daily = daily_max_with_rh(era5, ["station"], t="temperature_2m", rh="relative_humidity_2m")
    n = era5.groupby(era5["time"].dt.normalize()).size()
    return daily[daily["date"].map(n) == 24].drop(columns="station")


def calendar_day(dates: pd.Series) -> pd.Series:
    """Day of year 1..365 with 29 Feb folded into 28 Feb, so every year has the same 365 slots."""
    d = pd.to_datetime(dates)
    doy = d.dt.day_of_year
    leap_after_feb = d.dt.is_leap_year & (d.dt.month > 2)
    doy = doy - leap_after_feb.astype(int)
    return doy.where(~(d.dt.is_leap_year & (d.dt.month == 2) & (d.dt.day == 29)), 59)


def build_climatology(era5_daily: pd.DataFrame, window: int = 15) -> pd.DataFrame:
    """Normal (mean) and spread (std) of daily max heat index for each calendar day, 1991-2020.

    A single calendar day has only 30 values (one per year), which is noisy, so each
    day uses all years' values within +/- `window` days (wrapping around New Year).
    """
    y0, y1 = CLIMATOLOGY_YEARS
    base = era5_daily[era5_daily["date"].dt.year.between(y0, y1)].copy()
    base["cday"] = calendar_day(base["date"])
    rows = []
    for cday in range(1, 366):
        dist = np.abs(base["cday"] - cday)
        dist = np.minimum(dist, 365 - dist)                       # circular distance
        sel = base.loc[dist <= window]
        rows.append({"cday": cday,
                     "hi_normal_era5": sel["hi_max"].mean(), "hi_std_era5": sel["hi_max"].std(),
                     "tmax_normal_era5": sel["tmax"].mean(), "n_values": len(sel)})
    return pd.DataFrame(rows)


def station_offsets(obs_daily: pd.DataFrame, era5_daily: pd.DataFrame) -> pd.DataFrame:
    """ERA5 is a ~25 km grid box partly over the sea, so it is cooler than the station.

    To compare a station value with an ERA5 'normal', we add the average station - ERA5
    difference for that month (measured on overlapping days 2021-2025).
    """
    both = obs_daily[obs_daily["valid"]].merge(era5_daily[["date", "hi_max"]], on="date", suffixes=("", "_era5"))
    both = both[both["date"].dt.year <= 2025]
    both["diff"] = both["hi_max"] - both["hi_max_era5"]
    return both.groupby(["station", both["date"].dt.month.rename("month")])["diff"].agg(["mean", "count"]).reset_index()


def main() -> None:
    DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
    obs = build_obs_daily();    obs.to_parquet(DATA_PROCESSED / "obs_daily.parquet", index=False)
    fc = build_fc_daily();      fc.to_parquet(DATA_PROCESSED / "fc_daily.parquet", index=False)
    era5 = build_era5_daily();  era5.to_parquet(DATA_PROCESSED / "era5_daily.parquet", index=False)
    clim = build_climatology(era5); clim.to_parquet(DATA_PROCESSED / "climatology.parquet", index=False)
    offs = station_offsets(obs, era5); offs.to_parquet(DATA_PROCESSED / "station_offsets.parquet", index=False)

    print("obs_daily valid days:", obs[obs.valid].groupby("station").size().to_dict(),
          "| total days:", obs.groupby("station").size().to_dict())
    print("fc_daily rows per model:", fc.groupby("model").size().to_dict())
    print("fc first date per model:", fc.groupby("model")["date"].min().dt.date.astype(str).to_dict())
    print("era5_daily:", len(era5), "days,", era5.date.min().date(), "->", era5.date.max().date())
    print("station - ERA5 heat-index offset by month (santacruz):",
          offs[offs.station == "santacruz"].set_index("month")["mean"].round(1).to_dict())


if __name__ == "__main__":
    main()
