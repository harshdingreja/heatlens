"""Project-wide settings in one place.

If you want to change a location, a date range or a folder, change it here and
every script picks it up. No "magic numbers" scattered across files.
"""
from datetime import date
from pathlib import Path

# ---- Folders --------------------------------------------------------------
# This file lives at src/heatshield/config.py, so 3 levels up is the project root.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = PROJECT_ROOT / "data" / "raw"              # exactly what we downloaded
DATA_PROCESSED = PROJECT_ROOT / "data" / "processed"  # cleaned / derived tables
ARTIFACTS = PROJECT_ROOT / "artifacts"                 # small trained models + results (committed, the API needs them)
FIGURES = PROJECT_ROOT / "docs" / "figures"            # plots used in README / DEMO

# ---- Place and time -------------------------------------------------------
TIMEZONE = "Asia/Kolkata"       # all timestamps are stored in Indian Standard Time
MUMBAI_CENTER = (19.07, 72.87)  # (lat, lon) used to search for nearby stations

# Stations we want, matched by name in Meteostat's nearby-station search.
# We store NAMES, not IDs: the IDs are looked up (see ingest/stations.py).
STATION_NAMES = {"santacruz": "Santacruz", "colaba": "Colaba"}

# ---- Date ranges ----------------------------------------------------------
OBS_START = date(2021, 1, 1)    # station observations: matches the longest forecast archive (JMA, Jan 2021)
ERA5_START = date(1991, 1, 1)   # reanalysis history: covers the 1991-2020 climate "normal"
CLIMATOLOGY_YEARS = (1991, 2020)

# ---- Forecast models (Open-Meteo Previous Runs API) ------------------------
# model id -> first year to download. Start dates were checked for Mumbai on
# 17 Nov 2026 (see docs/DATA_SOURCES.md). Earlier days come back empty.
FORECAST_MODELS = {
    "gfs_seamless": 2024,   # NOAA GFS     - full variables from 24 Jan 2024
    "icon_global": 2024,    # DWD ICON     - full variables from 24 Jan 2024
    "ecmwf_ifs025": 2024,   # ECMWF IFS    - full variables from 12 Mar 2024
    "jma_gsm": 2021,        # Japan JMA    - temp + humidity from 7 Jan 2021, no solar radiation
}
MAX_LEAD_DAYS = 5           # we forecast 1-5 days ahead

# Variables we pull from every Open-Meteo API (same names in all of them).
WEATHER_VARS = [
    "temperature_2m",        # air temperature 2 m above ground, °C
    "relative_humidity_2m",  # %
    "wind_speed_10m",        # km/h (Open-Meteo default unit; Meteostat also uses km/h)
    "shortwave_radiation",   # sunlight reaching the ground, W/m² (needed later for WBGT)
]
