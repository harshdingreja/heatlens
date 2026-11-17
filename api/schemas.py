"""Pydantic models: the exact shape of every API response.

FastAPI uses these to validate our output and to generate the docs at /docs.
If the code ever returns a wrong type (e.g. text where a number belongs),
the request fails loudly instead of sending bad data to the dashboard.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    status: str
    version: str
    forecast_model: str
    corrector: str
    corrector_trained: bool
    wards_available: bool
    risk_available: bool
    time: str


class Alert(BaseModel):
    level: int
    key: str
    label: str
    color: str


class ImdAlert(BaseModel):
    key: str
    label: str
    color: str


class ForecastDay(BaseModel):
    date: str
    lead_days: int
    tmax_c: float | None
    rh_at_tmax_pct: float | None
    wind_kmh: float | None
    shortwave_max_wm2: float | None
    tmean_c: float | None
    heat_index_raw_c: float | None
    heat_index_corrected_c: float | None
    wbgt_c: float | None
    alert: Alert | None
    imd_alert: ImdAlert | None
    normal_heat_index_c: float | None
    anomaly_z: float | None
    is_anomaly: bool
    isolation_forest_anomaly: bool


class Location(BaseModel):
    name: str
    lat: float
    lon: float


class ForecastResponse(BaseModel):
    issued: str
    location: Location
    forecast_model: str
    corrector: str
    obs_latest_date: str | None
    alert_scheme: str
    days: list[ForecastDay]


class RiskDay(BaseModel):
    model_config = ConfigDict(extra="allow")   # Layer 1 may add extra explanation fields
    date: str
    heatwave: bool
    relative_risk: float | None = None
    rr_ci: list[float] | None = None
    extra_deaths: float | None = None
    extra_deaths_ci: list[float] | None = None


class RiskResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    disclaimer: str
    citation: str
    baseline_daily_deaths: float
    baseline_source: str
    heatwave_definition: str
    days: list[RiskDay]
    state_model_check: dict | None = None


class AdvisoryRequest(BaseModel):
    lang: Literal["en", "mr", "hi"] = "en"
    date: str | None = None
    alert_level: str | None = None     # NOAA key, e.g. "danger"; filled from the forecast if missing
    heat_index_c: float | None = None
    top_wards: list[str] | None = None


class AdvisoryResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    lang: str
    text: str
    provider: str
    model: str | None = None
    inputs_used: dict
