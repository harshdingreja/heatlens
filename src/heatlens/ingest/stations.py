"""Ground-truth weather observations for Mumbai, from Meteostat.

Two jobs:
1. find_mumbai_stations(): search Meteostat for stations near Mumbai and pick
   Santacruz and Colaba by NAME. We never hard-code station IDs.
2. download_observations(): download hourly temperature, dew point, humidity
   and wind for those stations.

Where the numbers come from matters. By default Meteostat fills gaps with
output from a weather MODEL (DWD MOSMIX). In 2025 that was 85 % of Colaba's
hours. Ground truth must be real measurements, so we ask for one provider
only: GHCNh (NOAA's Global Historical Climatology Network - hourly, the
official replacement for the ISD archive, which stopped in Aug 2025).

Run from the project root:   python -m heatlens.ingest.stations
"""
from __future__ import annotations

import os
from datetime import date

import certifi

# Python from python.org on macOS doesn't use the Mac's certificate store, so
# HTTPS downloads through urllib (which Meteostat uses) fail with
# CERTIFICATE_VERIFY_FAILED. Pointing SSL_CERT_FILE at certifi's certificate
# bundle fixes it for this program only (no system settings are changed).
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

import meteostat as ms  # noqa: E402  (import after the SSL fix above)
import pandas as pd  # noqa: E402

from heatlens.config import DATA_RAW, MUMBAI_CENTER, OBS_START, STATION_NAMES, TIMEZONE  # noqa: E402

STATIONS_FILE = DATA_RAW / "stations.csv"
OBS_FILE = DATA_RAW / "obs_hourly.parquet"

PARAMETERS = [ms.Parameter.TEMP, ms.Parameter.DWPT, ms.Parameter.RHUM, ms.Parameter.WSPD]
PROVIDER = ms.Provider.GHCNH  # real observations only, no model gap-filling


def find_mumbai_stations(radius_m: int = 50_000) -> pd.DataFrame:
    """Search stations within `radius_m` metres of Mumbai and keep the ones we want.

    Saves the result to data/raw/stations.csv so later steps can reuse it.
    """
    lat, lon = MUMBAI_CENTER
    nearby = ms.stations.nearby(ms.Point(lat, lon), radius=radius_m, limit=20)

    picked = []
    for key, name_part in STATION_NAMES.items():
        matches = nearby[nearby["name"].str.contains(name_part, case=False)]
        if matches.empty:
            raise RuntimeError(f"No station named like '{name_part}' within {radius_m} m of Mumbai")
        closest = matches.sort_values("distance").iloc[[0]].copy()  # [[0]] keeps it a DataFrame
        closest.insert(0, "key", key)
        picked.append(closest)

    stations = pd.concat(picked).reset_index(names="station_id")
    STATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    stations.to_csv(STATIONS_FILE, index=False)
    return stations


def load_stations() -> pd.DataFrame:
    """Read the saved station list (runs the search first if it doesn't exist yet)."""
    if not STATIONS_FILE.exists():
        return find_mumbai_stations()
    # dtype=str: station IDs like "43003" are labels, not numbers
    return pd.read_csv(STATIONS_FILE, dtype={"station_id": str})


def download_observations(start: date = OBS_START, end: date | None = None) -> pd.DataFrame:
    """Download hourly observations for every station in stations.csv.

    Meteostat blocks hourly requests longer than 3 years, so we ask one
    calendar year at a time and stick the pieces together.
    """
    end = end or date.today()
    stations = load_stations()
    id_to_key = dict(zip(stations["station_id"], stations["key"]))

    yearly = []
    for year in range(start.year, end.year + 1):
        y_start = max(start, date(year, 1, 1))
        y_end = min(end, date(year, 12, 31))
        print(f"  observations {year} ...", flush=True)
        df = ms.hourly(
            list(id_to_key), y_start, y_end,
            timezone=TIMEZONE, parameters=PARAMETERS, providers=[PROVIDER],
        ).fetch(sources=True)
        if df is not None:
            yearly.append(df)

    obs = pd.concat(yearly).reset_index()  # index (station, time) -> normal columns

    # Safety check: every value must come from GHCNh, never from a model.
    sources = set(obs["temp_source"].dropna()) | set(obs["rhum_source"].dropna())
    assert sources <= {PROVIDER.value}, f"Unexpected data sources: {sources}"

    obs["station"] = obs["station"].map(id_to_key)  # "43003" -> "santacruz"
    # Store times as plain local IST clock times (drop the "+05:30" part).
    obs["time"] = obs["time"].dt.tz_convert(TIMEZONE).dt.tz_localize(None)

    # Meteostat stores humidity as an unsigned 8-bit integer (UInt8). Doing
    # maths on that is dangerous: 80 - 81 wraps around to 255. Use floats.
    values = ["temp", "dwpt", "rhum", "wspd"]
    obs[values] = obs[values].astype("float64")

    obs = obs[["station", "time", *values]].sort_values(["station", "time"]).reset_index(drop=True)
    obs.to_parquet(OBS_FILE, index=False)
    return obs


if __name__ == "__main__":
    st = find_mumbai_stations()
    print("Stations found:\n", st[["key", "station_id", "name", "latitude", "longitude", "distance"]], "\n")
    obs = download_observations()
    print(f"\nSaved {len(obs):,} hourly rows to {OBS_FILE}")
    print(obs.groupby("station")["time"].agg(["min", "max", "count"]))
