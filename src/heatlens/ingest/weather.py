"""Open-Meteo downloads: ERA5 history, archived past forecasts, live forecast.

Three APIs, all free and keyless (docs checked 17 Nov 2026):
- Historical Weather API (ERA5 reanalysis): what the weather WAS, back to 1940.
    https://archive-api.open-meteo.com/v1/archive
- Previous Runs API: what forecast models PREDICTED 1..7 days before each hour.
    https://previous-runs-api.open-meteo.com/v1/forecast
    A variable like `temperature_2m_previous_day3` at 2 PM on 10 May is the
    value the model predicted for 2 PM on 10 May when it ran 3 days earlier.
- Forecast API: the live forecast for the next days (used by the dashboard).
    https://api.open-meteo.com/v1/forecast

Caching: history files are saved one per year. A finished past year never
changes, so we skip it if the file exists. The current year is always
re-downloaded because new days keep arriving.

Run from the project root:   python -m heatlens.ingest.weather
"""
from __future__ import annotations

import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests

from heatlens.config import (
    DATA_RAW, ERA5_START, FORECAST_MODELS, MAX_LEAD_DAYS, TIMEZONE, WEATHER_VARS,
)
from heatlens.ingest.stations import load_stations

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

ERA5_DIR = DATA_RAW / "era5"
PREVIOUS_RUNS_DIR = DATA_RAW / "previous_runs"


# ---------------------------------------------------------------- helpers ---
def get_json(url: str, params: dict, retries: int = 5) -> dict:
    """GET a URL and return its JSON, retrying politely if the server is busy.

    429 = "too many requests" (rate limit), 5xx = server error. Both are
    temporary, so we wait (5 s, 10 s, 20 s, ...) and try again. Any other
    error (e.g. 400 = we sent a wrong parameter) is our bug: fail loudly.
    """
    for attempt in range(retries):
        response = requests.get(url, params=params, timeout=180)
        if response.status_code == 200:
            return response.json()
        if response.status_code == 429 or response.status_code >= 500:
            wait = 5 * 2**attempt
            print(f"    server said {response.status_code}, waiting {wait}s ...", flush=True)
            time.sleep(wait)
            continue
        raise RuntimeError(f"{response.status_code} from {url}: {response.text[:300]}")
    raise RuntimeError(f"Gave up on {url} after {retries} tries")


def hourly_frame(payload: dict) -> pd.DataFrame:
    """Turn Open-Meteo's {"hourly": {"time": [...], "var": [...]}} into a DataFrame."""
    df = pd.DataFrame(payload["hourly"])
    df["time"] = pd.to_datetime(df["time"])  # already local IST because we pass `timezone`
    return df


def year_ranges(first_year: int, start: date | None = None):
    """Yield (year, start_date, end_date) for each year up to today."""
    today = date.today()
    for year in range(first_year, today.year + 1):
        y_start = date(year, 1, 1) if start is None else max(start, date(year, 1, 1))
        yield year, y_start, min(today, date(year, 12, 31))


def needs_download(path: Path, year: int) -> bool:
    """Download if the file is missing, or if it's the current (still growing) year."""
    return not path.exists() or year == date.today().year


# ------------------------------------------------------------------- ERA5 ---
def download_era5(lat: float, lon: float, start: date = ERA5_START) -> None:
    """Hourly ERA5 reanalysis at one point, saved as one parquet file per year.

    `models=era5` pins pure ERA5. The default ("best_match") blends several
    datasets, and that blend could change over 35 years, which would break a
    fair climate "normal".
    """
    ERA5_DIR.mkdir(parents=True, exist_ok=True)
    for year, y_start, y_end in year_ranges(start.year, start):
        path = ERA5_DIR / f"era5_{year}.parquet"
        if not needs_download(path, year):
            continue
        print(f"  ERA5 {year} ...", flush=True)
        payload = get_json(ARCHIVE_URL, {
            "latitude": lat, "longitude": lon,
            "start_date": y_start.isoformat(), "end_date": y_end.isoformat(),
            "hourly": ",".join(WEATHER_VARS), "models": "era5", "timezone": TIMEZONE,
        })
        df = hourly_frame(payload)
        df["grid_lat"], df["grid_lon"] = payload["latitude"], payload["longitude"]  # cell actually used
        df.to_parquet(path, index=False)
        time.sleep(1)  # be gentle with a free API


def load_era5() -> pd.DataFrame:
    """All ERA5 years in one table. ERA5 arrives about 5 days late, so the newest rows are empty."""
    files = sorted(ERA5_DIR.glob("era5_*.parquet"))
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)


# ----------------------------------------------------------- Previous Runs ---
def previous_runs_columns() -> list[str]:
    """temperature_2m, temperature_2m_previous_day1, ..., _previous_day5, same for each variable.

    Lead 0 (no suffix) is the most recent run, i.e. almost an analysis.
    """
    cols = []
    for var in WEATHER_VARS:
        cols.append(var)
        cols += [f"{var}_previous_day{d}" for d in range(1, MAX_LEAD_DAYS + 1)]
    return cols


def wide_to_long(df: pd.DataFrame) -> pd.DataFrame:
    """Reshape one-column-per-lead into one-row-per-lead.

    Wide (as the API sends it):   time | temperature_2m_previous_day1 | ..._day2 | ...
    Long (easier to analyse):     time | lead_days | temperature_2m | ...
    """
    pieces = []
    for lead in range(0, MAX_LEAD_DAYS + 1):
        suffix = "" if lead == 0 else f"_previous_day{lead}"
        part = df[["time"] + [v + suffix for v in WEATHER_VARS]].copy()
        part.columns = ["time"] + WEATHER_VARS
        part.insert(1, "lead_days", lead)
        pieces.append(part)
    return pd.concat(pieces, ignore_index=True)


def download_previous_runs(station_key: str, lat: float, lon: float) -> None:
    """Archived forecasts for every model in FORECAST_MODELS at one station."""
    PREVIOUS_RUNS_DIR.mkdir(parents=True, exist_ok=True)
    for model, first_year in FORECAST_MODELS.items():
        for year, y_start, y_end in year_ranges(first_year):
            path = PREVIOUS_RUNS_DIR / f"{model}_{station_key}_{year}.parquet"
            if not needs_download(path, year):
                continue
            print(f"  previous runs {model} {station_key} {year} ...", flush=True)
            payload = get_json(PREVIOUS_RUNS_URL, {
                "latitude": lat, "longitude": lon,
                "start_date": y_start.isoformat(), "end_date": y_end.isoformat(),
                "hourly": ",".join(previous_runs_columns()),
                "models": model, "timezone": TIMEZONE,
            })
            long = wide_to_long(hourly_frame(payload))
            long.insert(0, "model", model)
            long.insert(1, "station", station_key)
            long.to_parquet(path, index=False)
            time.sleep(1)


def load_previous_runs() -> pd.DataFrame:
    """All archived forecasts (every model, station, year) in one long table."""
    files = sorted(PREVIOUS_RUNS_DIR.glob("*.parquet"))
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)


# ------------------------------------------------------------ Live forecast ---
def fetch_live_forecast(lat: float, lon: float, model: str = "gfs_seamless", days: int = 6) -> pd.DataFrame:
    """Hourly forecast for today + the next days. Not saved: it changes every few hours."""
    payload = get_json(FORECAST_URL, {
        "latitude": lat, "longitude": lon, "hourly": ",".join(WEATHER_VARS),
        "models": model, "forecast_days": days, "timezone": TIMEZONE,
    })
    return hourly_frame(payload)


# ------------------------------------------------------------------- main ---
if __name__ == "__main__":
    stations = load_stations().set_index("key")
    scz = stations.loc["santacruz"]

    print("1/3 ERA5 history at Santacruz (1991 -> today)")
    download_era5(scz.latitude, scz.longitude)

    print("2/3 Archived forecasts (Previous Runs API)")
    for key, row in stations.iterrows():
        download_previous_runs(key, row.latitude, row.longitude)

    print("3/3 Live forecast smoke test")
    live = fetch_live_forecast(scz.latitude, scz.longitude)
    print(f"  live forecast: {len(live)} hours, {live.time.min()} -> {live.time.max()}")

    era5, prev = load_era5(), load_previous_runs()
    print(f"\nERA5: {len(era5):,} hourly rows | Previous runs: {len(prev):,} rows")
