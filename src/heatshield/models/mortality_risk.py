"""Layer 1: evidence-based estimate of EXTRA deaths in Mumbai during a heatwave.

Science source: de Bont et al. (2024), "Impact of heatwaves on all-cause
mortality in India: A comprehensive multi-city study", Environment
International 184:108461. 10 cities, 2008-2019, ~3.6 million deaths.
Mumbai IS one of the 10 cities (data 2009 - Nov 2015, mean 251 deaths/day).

How the paper defines a heatwave: DAILY MEAN temperature above a city's own
annual percentile (95th/97th/99th) for N consecutive days (1/2/3/5).
Main definition: >= 2 consecutive days above the 97th percentile.

Our estimate for one day:
    extra deaths = baseline deaths per day x (RR - 1)
where RR (relative risk) = 1 + %increase/100 from the paper's Table S1. The 95 %
confidence interval of RR gives the interval for extra deaths.

Which RR? The paper gives Mumbai's OWN estimate (3.4 %, 95 % CI 0.8-6.1 for
the main definition), much lower than the 10-city pooled 14.7 % (10.3-19.3).
A Mumbai-specific number is the better evidence for Mumbai, so it is our main
estimate. The pooled number is shown next to it as an upper scenario.

Temperature "space": percentiles must be computed from the same kind of data
they are compared with. Our thresholds come from the Santacruz station (GHCNh,
2021-2025). Observed days are station data, so they're used as they are.
Forecast days come from a weather model (ICON by default), which runs about
0.9 °C cooler than the station. So before comparing, we remove the model's
average bias for that lead time (measured on 2024-2025 only).

This is an evidence-based estimate, NOT a clinical prediction.

Build the config:   python -m heatshield.models.mortality_risk
"""
from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd

from heatshield.config import ARTIFACTS, DATA_RAW, FIGURES

CONFIG_PATH = ARTIFACTS / "mortality_config.json"
STATE_RESULTS_PATH = ARTIFACTS / "state_health_results.json"
HEALTH_DIR = DATA_RAW / "health"

DISCLAIMER = "Evidence-based estimate, not a clinical prediction."
CITATION = (
    "de Bont J, Nori-Sarma A, Stafoggia M, et al. Impact of heatwaves on all-cause mortality in India: "
    "A comprehensive multi-city study. Environment International 184 (2024) 108461. "
    "doi:10.1016/j.envint.2024.108461 (Mumbai-specific estimates: Supplementary Table S1)"
)
MAIN_DEFINITION = {"percentile": 97, "consecutive_days": 2}

# Baseline: MCGM key statistics (civicDemographics page), total deaths registered in 2023.
BASELINE_ANNUAL_DEATHS = 93_255
BASELINE_YEAR = 2023
BASELINE_SOURCE = (
    "MCGM (BMC) Key Statistics, 'Total deaths in year 2023' = 93,255 for Greater Mumbai "
    "(https://mcgm.gov.in/irj/portal/anonymous/qlCivicDemographics, read 17 Nov 2026); / 365 days"
)

THRESHOLD_YEARS = ("2021-01-01", "2025-12-31")   # station percentiles (2026 kept out)
BIAS_YEARS = ("2024-01-24", "2025-12-31")        # forecast-bias period = corrector training period
MIN_HOURS_PER_DAY = 18                           # a station day needs >= 18 hourly readings


# ----------------------------------------------------------- building blocks ---
def station_daily(station: str = "santacruz") -> pd.DataFrame:
    """Daily mean and max temperature from hourly GHCNh observations."""
    obs = pd.read_parquet(DATA_RAW / "obs_hourly.parquet")
    obs = obs[obs["station"] == station]
    daily = obs.groupby(obs["time"].dt.normalize())["temp"].agg(tmean_c="mean", tmax_c="max", n="count")
    return daily[daily["n"] >= MIN_HOURS_PER_DAY].drop(columns="n")


def era5_daily() -> pd.DataFrame:
    files = sorted((DATA_RAW / "era5").glob("era5_*.parquet"))
    era = pd.concat([pd.read_parquet(f) for f in files])
    daily = era.groupby(era["time"].dt.normalize())["temperature_2m"].agg(tmean_c="mean", n="count")
    return daily[daily["n"] == 24].drop(columns="n")


def forecast_mean_bias(station: str = "santacruz") -> dict:
    """Average (forecast daily mean - observed daily mean) per model and lead day."""
    files = sorted((DATA_RAW / "previous_runs").glob(f"*_{station}_*.parquet"))
    runs = pd.concat([pd.read_parquet(f) for f in files])
    runs = runs[runs["lead_days"].between(1, 5)]
    fc = (runs.groupby(["model", "lead_days", runs["time"].dt.normalize()])["temperature_2m"]
              .agg(tmean_fc="mean", n="count").reset_index())
    fc = fc[fc["n"] == 24].rename(columns={"time": "date"})
    obs = station_daily(station)["tmean_c"].rename("tmean_obs").rename_axis("date").reset_index()
    both = fc.merge(obs, on="date")
    both = both[(both["date"] >= BIAS_YEARS[0]) & (both["date"] <= BIAS_YEARS[1])]
    both["bias"] = both["tmean_fc"] - both["tmean_obs"]
    out = {}
    for (model, lead), g in both.groupby(["model", "lead_days"]):
        out.setdefault(model, {})[str(lead)] = {"bias_c": round(float(g["bias"].mean()), 3), "n_days": int(len(g))}
    return out


def heatwave_flags(tmean: pd.Series, threshold: float, min_days: int) -> pd.Series:
    """True for every day inside a run of >= `min_days` consecutive days with
    tmean > threshold. A missing day (gap in dates or NaN) breaks the run."""
    s = tmean.sort_index()
    hot = (s > threshold).to_numpy()
    dates = pd.DatetimeIndex(s.index)
    flags = np.zeros(len(s), dtype=bool)
    start = 0
    for i in range(1, len(s) + 1):
        run_breaks = (i == len(s)) or (not hot[i]) or (not hot[i - 1]) or (dates[i] - dates[i - 1]).days != 1
        if run_breaks:
            if hot[start] and (i - start) >= min_days:
                flags[start:i] = True
            start = i
    return pd.Series(flags, index=s.index)


def count_episodes(flags: pd.Series) -> int:
    """Number of separate heatwave runs."""
    f = flags.astype(int).to_numpy()
    return int(((f[1:] == 1) & (f[:-1] == 0)).sum() + (f[0] == 1 if len(f) else 0))


# -------------------------------------------------------------- the config ---
def build_config() -> dict:
    s1 = pd.read_csv(HEALTH_DIR / "paper_table_s1.csv")
    station = station_daily()
    st_period = station.loc[THRESHOLD_YEARS[0]:THRESHOLD_YEARS[1], "tmean_c"]
    era = era5_daily()["tmean_c"]
    era_paper = era.loc["2009-01-01":"2015-11-30"]   # Mumbai's period in the paper

    thresholds = {f"p{p}": round(float(st_period.quantile(p / 100)), 2) for p in (95, 97, 99)}

    def rr_rows(city: str) -> list[dict]:
        rows = s1[s1["city"] == city]
        return [{"percentile": int(r.percentile), "consecutive_days": int(r.consecutive_days),
                 "pct_increase": r.pct_increase, "ci_low": r.ci_low, "ci_high": r.ci_high,
                 "ci_excludes_zero": bool(r.ci_low > 0)} for r in rows.itertuples()]

    # Sanity check on history: how often does our rule fire in the station record?
    main_flags = heatwave_flags(station.loc[: "2025-12-31", "tmean_c"], thresholds["p97"], 2)
    years = main_flags.index.year.nunique()

    config = {
        "disclaimer": DISCLAIMER,
        "citation": CITATION,
        "paper": {
            "doi": "10.1016/j.envint.2024.108461",
            "open_access": "https://europepmc.org/article/PMC/PMC11790314",
            "cities": ["Ahmedabad", "Bangalore", "Chennai", "Delhi", "Hyderabad", "Kolkata",
                       "Mumbai", "Pune", "Shimla", "Varanasi"],
            "mumbai_included": True,
            "mumbai_period": "2009 - Nov 2015 (paper Table 1)",
            "mumbai_mean_daily_deaths_in_paper": 251,
            "exposure_metric": "daily mean temperature (ECMWF/ERA5 0.25 deg, averaged over the city)",
            "heatwave_rule": "daily mean temperature above the city's annual percentile for N consecutive days",
            "rr_tables": {"mumbai": rr_rows("Mumbai"), "pooled_10_cities": rr_rows("Pooled (10 cities)")},
            "mumbai_attributable_deaths_per_year_main_def": {"value": 48, "ci": [12, 84],
                                                             "source": "paper Supplementary Table S3"},
        },
        "main_definition": {**MAIN_DEFINITION,
                            "text": "Daily mean temperature above Mumbai's 97th percentile for at least 2 consecutive days"},
        "baseline": {
            "annual_deaths": BASELINE_ANNUAL_DEATHS, "year": BASELINE_YEAR,
            "daily_deaths": round(BASELINE_ANNUAL_DEATHS / 365, 2), "source": BASELINE_SOURCE,
            "cross_check": "Paper Table 1 gives 251 deaths/day for Mumbai in 2009-2015.",
        },
        "thresholds": {
            "space": "station (Santacruz 43003, GHCNh hourly, daily mean of days with >= 18 readings)",
            "period": f"{THRESHOLD_YEARS[0]} to {THRESHOLD_YEARS[1]}",
            "n_days": int(st_period.size),
            "tmean_c": thresholds,
            "reference_era5_same_percentiles_2009_2015": {f"p{p}": round(float(era_paper.quantile(p / 100)), 2) for p in (95, 97, 99)},
            "reference_paper_implied_p97_c": round(31.5 / 1.011, 2),
            "note": ("Paper Table 1: Mumbai heatwaves averaged 31.5 °C, 1.1 % above its 97th percentile, so "
                     "the paper's P97 was about 31.2 °C. ERA5 at the single grid cell nearest Santacruz gives "
                     "a lower value; the station gives a higher one. Percentiles are relative, so we stay "
                     "consistent by using station thresholds with station-space temperatures."),
        },
        "forecast_bias_removed": {
            "what": "mean(model daily-mean temperature - station daily mean), per lead day",
            "period": f"{BIAS_YEARS[0]} to {BIAS_YEARS[1]}",
            "models": forecast_mean_bias(),
        },
        "history_check": {
            "years": f"{main_flags.index.min().date()} to {main_flags.index.max().date()} (complete station days)",
            "heatwave_days_main_definition": int(main_flags.sum()),
            "heatwave_episodes_main_definition": count_episodes(main_flags),
            "episodes_per_year": round(count_episodes(main_flags) / years, 2),
            "paper_mumbai_episodes_per_year": 3.6,
        },
    }
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, indent=2))
    return config


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text())


# ------------------------------------------------------------- the estimate ---
def _rr_entry(table: list[dict], percentile: int, days: int) -> dict | None:
    return next((r for r in table if r["percentile"] == percentile and r["consecutive_days"] == days), None)


def _extra(baseline: float, entry: dict) -> dict:
    rr = 1 + entry["pct_increase"] / 100
    lo, hi = 1 + entry["ci_low"] / 100, 1 + entry["ci_high"] / 100
    return {"relative_risk": round(rr, 3), "rr_ci": [round(lo, 3), round(hi, 3)],
            "extra_deaths": round(baseline * (rr - 1), 1),
            "extra_deaths_ci": [round(baseline * (lo - 1), 1), round(baseline * (hi - 1), 1)]}


def to_station_space(daily: pd.DataFrame, cfg: dict, forecast_model: str) -> pd.Series:
    """Observed rows: unchanged. Forecast rows: subtract the model's mean bias for
    that lead day (lead = 1 for the first forecast row, 2 for the next, ...,
    unless the input already has a 'lead_days' column)."""
    tmean = daily["tmean_c"].astype(float).copy()
    fc = daily["is_forecast"].astype(bool)
    if fc.any():
        biases = cfg["forecast_bias_removed"]["models"].get(forecast_model)
        if biases is None:
            raise ValueError(f"No bias table for model '{forecast_model}'")
        leads = daily.loc[fc, "lead_days"] if "lead_days" in daily else pd.Series(range(1, fc.sum() + 1), index=daily.index[fc])
        for idx, lead in leads.items():
            key = str(int(min(max(lead, 1), 5)))           # leads beyond 5 reuse the lead-5 bias
            tmean.loc[idx] = tmean.loc[idx] - biases[key]["bias_c"]
    return tmean


def estimate_extra_deaths(daily: pd.DataFrame, forecast_model: str = "icon_global", config: dict | None = None) -> dict:
    """Extra deaths per forecast day (dict shaped like GET /risk in docs/API_CONTRACT.md).

    `daily` columns: date, tmean_c, tmax_c, is_forecast. Put a few OBSERVED days
    first (is_forecast=False) so multi-day heatwaves that started before today
    are recognised. Only forecast days are returned.
    """
    cfg = config or load_config()
    baseline = cfg["baseline"]["daily_deaths"]
    mumbai_table = cfg["paper"]["rr_tables"]["mumbai"]
    pooled_table = cfg["paper"]["rr_tables"]["pooled_10_cities"]

    df = daily.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    df["tmean_station_c"] = to_station_space(df, cfg, forecast_model)

    thresholds = cfg["thresholds"]["tmean_c"]
    flags = {(p, n): heatwave_flags(df["tmean_station_c"].dropna(), thresholds[f"p{p}"], n)
             for p in (95, 97, 99) for n in (1, 2, 3, 5)}
    main_key = (MAIN_DEFINITION["percentile"], MAIN_DEFINITION["consecutive_days"])

    days = []
    for d, row in df[df["is_forecast"].astype(bool)].iterrows():
        is_hw = bool(flags[main_key].get(d, False))
        met = [{"percentile": p, "consecutive_days": n,
                "mumbai_pct_increase": (_rr_entry(mumbai_table, p, n) or {}).get("pct_increase")}
               for (p, n), f in flags.items() if bool(f.get(d, False))]
        entry = {
            "date": d.date().isoformat(),
            "tmean_input_c": round(float(row["tmean_c"]), 2),
            "tmean_station_space_c": round(float(row["tmean_station_c"]), 2),
            "tmax_c": None if pd.isna(row.get("tmax_c")) else round(float(row["tmax_c"]), 2),
            "threshold_p97_c": thresholds["p97"],
            "heatwave": is_hw,
            "relative_risk": None, "rr_ci": None,
            "extra_deaths": 0.0, "extra_deaths_ci": [0.0, 0.0],
            "pooled_10_city_scenario": None,
            "definitions_met": met,
        }
        if is_hw:
            entry.update(_extra(baseline, _rr_entry(mumbai_table, *main_key)))
            entry["pooled_10_city_scenario"] = _extra(baseline, _rr_entry(pooled_table, *main_key))
        days.append(entry)

    total = sum(x["extra_deaths"] for x in days)
    state_check = None
    if STATE_RESULTS_PATH.exists():
        state_check = {"summary": json.loads(STATE_RESULTS_PATH.read_text()).get("summary")}

    return {
        "disclaimer": DISCLAIMER,
        "citation": CITATION,
        "baseline_daily_deaths": baseline,
        "baseline_source": cfg["baseline"]["source"],
        "heatwave_definition": cfg["main_definition"]["text"]
                               + f" (Mumbai P97 = {thresholds['p97']} °C, station daily mean)",
        "rr_source": "Mumbai-specific estimate, 2 days > P97: +3.4 % (95 % CI 0.8-6.1), paper Table S1",
        "temperature_space_note": (f"Forecast daily means from '{forecast_model}' are shifted by the model's "
                                   "2024-2025 mean bias vs the Santacruz station before comparing with thresholds."),
        "days": days,
        "window_total_extra_deaths": round(total, 1),
        "state_model_check": state_check,
    }


# ----------------------------------------------------------------- figure ---
def plot_history(path=None) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cfg = load_config()
    st = station_daily()["tmean_c"]
    p97 = cfg["thresholds"]["tmean_c"]["p97"]
    flags = heatwave_flags(st, p97, 2)
    fig, ax = plt.subplots(figsize=(11, 3.6))
    ax.plot(st.index, st.values, lw=0.6, color="#555", label="Santacruz daily mean (GHCNh)")
    ax.axhline(p97, color="#d1495b", lw=1.2, ls="--", label=f"97th percentile = {p97} °C")
    hw = st[flags]
    ax.scatter(hw.index, hw.values, s=10, color="#d1495b", zorder=3, label="heatwave day (2+ days > P97)")
    ax.set_ylabel("°C"); ax.set_title("Mumbai heatwave days under the paper's main definition")
    ax.legend(loc="lower left", fontsize=8, frameon=False)
    fig.tight_layout()
    FIGURES.mkdir(parents=True, exist_ok=True)
    fig.savefig(path or FIGURES / "health_mumbai_heatwave_days.png", dpi=130)
    plt.close(fig)


if __name__ == "__main__":
    cfg = build_config()
    print(json.dumps({k: cfg[k] for k in ("thresholds", "baseline", "history_check")}, indent=2))
    print("ICON bias:", cfg["forecast_bias_removed"]["models"].get("icon_global"))
    plot_history()
    # Demo on the most recent observed days (all treated as 'observed').
    st = station_daily().tail(10).reset_index().rename(columns={"time": "date"})
    st["is_forecast"] = [False] * 5 + [True] * 5
    st.loc[st["is_forecast"], "lead_days"] = range(1, 6)
    print(json.dumps(estimate_extra_deaths(st, forecast_model="icon_global")["days"][:2], indent=2))
