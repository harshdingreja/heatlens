"""HeatLens REST API (FastAPI).

Run locally:   .venv/bin/uvicorn api.main:app --reload --port 8000
Interactive docs: http://localhost:8000/docs

Endpoints
  GET  /health     is the service up, which models are loaded
  GET  /forecast   next 1-5 days: raw vs corrected heat index, WBGT, alerts, anomalies
  GET  /wards      GeoJSON of BMC wards with vulnerability (HVI), cluster and today's risk
  GET  /risk       Layer 1 extra-deaths estimate with confidence interval + citation
  POST /advisory   short advisory in English / Marathi / Hindi (LLM with strict checks)
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from api.schemas import (AdvisoryRequest, AdvisoryResponse, ForecastResponse, HealthResponse,
                         RiskResponse)
from heatlens import service
from heatlens.config import ARTIFACTS, TIMEZONE
from heatlens.models.alerts import NOAA_BANDS

VERSION = "0.1.0"
app = FastAPI(title="HeatLens API", version=VERSION,
              description="Mumbai heat-stress early warning (SIH 2026, PS SIH26083)")

# CORS: browsers block a page on one address (the dashboard) from calling an API on
# another address unless the API allows it. We allow local dev + Vercel deployments.
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins + ["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

WARDS_FILE = ARTIFACTS / "wards.geojson"
HAZARD_SCORE = {0: 0.0, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1.0}   # NOAA level -> 0..1


def risk_level(score: float) -> str:
    """Ward risk = hazard (0..1) x vulnerability (0..1); cut into 4 readable levels."""
    if score < 0.15:
        return "low"
    if score < 0.30:
        return "moderate"
    if score < 0.50:
        return "high"
    return "very_high"


def get_forecast(days: int = 5) -> dict:
    try:
        bundle = service.build_forecast(days)
    except Exception as exc:   # upstream weather API down, etc.
        raise HTTPException(status_code=502, detail=f"Could not build forecast: {exc}") from exc
    return bundle


def load_wards() -> dict | None:
    """Ward GeoJSON, re-read only when the file changes (its modification time is the cache key)."""
    return _read_wards(WARDS_FILE.stat().st_mtime) if WARDS_FILE.exists() else None


@lru_cache(maxsize=2)
def _read_wards(mtime: float) -> dict:
    return json.loads(WARDS_FILE.read_text())


def risk_module():
    """Layer 1 is optional at import time, so the rest of the API still works without it."""
    try:
        from heatlens.models import mortality_risk
        return mortality_risk
    except Exception:
        return None


# ---------------------------------------------------------------- routes ---
@app.get("/health", response_model=HealthResponse)
def health():
    meta = json.loads((ARTIFACTS / "corrector_meta.json").read_text())
    return {
        "status": "ok", "version": VERSION, "forecast_model": meta["primary_raw_model"],
        "corrector": meta["final_method"], "corrector_trained": (ARTIFACTS / "corrector_final.joblib").exists(),
        "wards_available": WARDS_FILE.exists(), "risk_available": risk_module() is not None,
        "time": datetime.now().astimezone().isoformat(timespec="seconds"),
    }


@app.get("/forecast", response_model=ForecastResponse)
def forecast(days: int = Query(5, ge=1, le=5, description="How many days ahead (1-5)")):
    bundle = dict(get_forecast(days))
    bundle.pop("_recent_obs", None)          # internal only
    return bundle


@app.get("/wards")
def wards():
    geo = load_wards()
    if geo is None:
        raise HTTPException(status_code=503, detail="Ward vulnerability layer not built yet")
    day1 = get_forecast(5)["days"][0]
    level = day1["alert"]["level"] if day1["alert"] else 0
    hazard = HAZARD_SCORE[level]
    features = []
    for f in geo["features"]:
        props = dict(f["properties"])
        hvi = props.get("hvi")
        score = round(hazard * hvi, 3) if hvi is not None else None
        props["risk_today"] = score
        props["risk_level"] = risk_level(score) if score is not None else None
        features.append({**f, "properties": props})
    meta = {"hazard_date": day1["date"], "hazard_alert": day1["alert"]["key"] if day1["alert"] else None,
            "hazard_score": hazard, "risk_formula": "risk_today = hazard_score (NOAA level / 4) x HVI",
            **geo.get("meta", {})}
    return {"type": "FeatureCollection", "meta": meta, "features": features}


@app.get("/risk", response_model=RiskResponse)
def risk():
    mod = risk_module()
    if mod is None:
        raise HTTPException(status_code=503, detail="Layer 1 death-risk model not built yet")
    bundle = get_forecast(5)
    recent = bundle["_recent_obs"].rename(columns={"tmean": "tmean_c", "tmax": "tmax_c"})
    recent = recent[["date", "tmean_c", "tmax_c"]].assign(is_forecast=False)
    future = pd.DataFrame([{"date": pd.Timestamp(d["date"]), "tmean_c": d["tmean_c"], "tmax_c": d["tmax_c"],
                            "is_forecast": True} for d in bundle["days"]])
    daily = pd.concat([recent, future], ignore_index=True)
    result = mod.estimate_extra_deaths(daily)
    summary_file = ARTIFACTS / "state_health_results.json"
    if summary_file.exists() and not result.get("state_model_check"):
        state = json.loads(summary_file.read_text())
        result["state_model_check"] = {"summary": state.get("summary", "")}
    return result


@lru_cache(maxsize=1)
def model_report_cached() -> dict:
    """Everything the 'Model performance' page shows, read from saved results only."""
    def load(name):
        p = ARTIFACTS / name
        return json.loads(p.read_text()) if p.exists() else None

    c = load("corrector_metrics.json")["santacruz"]
    back = pd.read_csv(ARTIFACTS / "backtest_2026_santacruz.csv")
    back = back.rename(columns={"target": "observed", "raw_hi": "raw"})[
        ["date", "lead_days", "observed", "raw", "corrected"]]
    an = load("anomaly_results.json")
    an_series = pd.read_csv(ARTIFACTS / "anomalies_2026.csv")
    v = load("vulnerability_summary.json")
    st = load("state_health_results.json")
    mort = load("mortality_config.json")

    report = {
        "corrector": {
            "station": c["station"], "primary_raw_model": c["primary_raw_model"],
            "final_method": c["final_method"], "train_period": c["train_period"], "test_period": c["test_period"],
            "n_train_rows": c["n_train_rows"], "n_test_rows": c["n_test_rows"],
            "raw_model_train_mae": c["raw_model_train_mae_all_leads"],
            "validation_mae": {k: val["mean_mae"] for k, val in c["validation_mae"].items()},
            "metrics": c["metrics"], "alerts": c["alerts_danger_or_worse"],
            "confusion": {"labels": c["confusion_labels"], "raw": c["confusion_matrix_raw"],
                          "corrected": c["confusion_matrix_final"]},
            "shap_top": [{"feature": k, "value": val} for k, val in list(c["shap_mean_abs_lightgbm"].items())[:12]],
            "backtest": back.to_dict(orient="records"),
        },
        "anomalies": {"summary": {k: val for k, val in an["test_2026"].items() if k != "z_anomaly_dates"},
                      "z_threshold": an["z_threshold"], "per_year": an["all_years_z_anomalies_per_year"],
                      "series": an_series.to_dict(orient="records")},
    }
    if v:
        report["wards"] = {
            "n_wards": v["n_wards"], "chosen_k": v["kmeans"]["chosen_k"],
            "silhouette": v["kmeans"]["chosen_k_silhouette"], "k_scan": v["kmeans"]["scan"],
            "cluster_sizes": v["kmeans"].get("cluster_sizes"),
            "pca_weights": v["hvi"]["pca"]["weights"],
            "explained_variance_ratio": v["hvi"]["pca"]["explained_variance_ratio"],
            "spearman_equal_vs_pca": v["hvi"]["spearman_equal_vs_pca"]["rho"],
            "mcap_reference": v["mcap_crosscheck"]["reference"],
            "mcap": {k: val for k, val in v["mcap_crosscheck"].items() if isinstance(val, dict) and "spearman_rho" in val},
            "satellite": v["satellite"],
        }
    cal_file = ARTIFACTS / "heat_calendar_santacruz.csv"
    if cal_file.exists():   # every valid observed day 2021-2026, for the heat calendar
        report["heat_calendar"] = pd.read_csv(cal_file).to_dict(orient="records")
    history = load("heatwave_history.json")
    if history:
        report["heatwave_history"] = history
    if st and mort:
        d = mort["main_definition"]
        rr = next(r for r in mort["paper"]["rr_tables"]["mumbai"]
                  if r["percentile"] == d["percentile"] and r["consecutive_days"] == d["consecutive_days"])
        report["health"] = {
            "layer1": {"definition": d["text"], "pct_increase": rr["pct_increase"],
                       "ci": [rr["ci_low"], rr["ci_high"]], "baseline_daily_deaths": mort["baseline"]["daily_deaths"],
                       "citation": mort["citation"]},
            "layer2": {"summary": st["summary"], "n_rows": st["data"]["n_rows"],
                       "models": {k: {"irr_per_10_days": m["rate_ratio_per_10_days"]["irr"],
                                      "ci": m["rate_ratio_per_10_days"]["ci"],
                                      "dispersion": m.get("pearson_dispersion"), "aic": m.get("aic")}
                                  for k, m in st["models"].items()}},
        }
    return report


@app.get("/model")
def model_report():
    """Model performance: test-set metrics, backtest, SHAP, anomalies, clustering, health models."""
    try:
        return model_report_cached()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Results not generated yet: {exc}") from exc


@app.post("/advisory", response_model=AdvisoryResponse)
def advisory(req: AdvisoryRequest):
    from heatlens.llm.advisory import generate_advisory
    bundle = get_forecast(5)
    day = next((d for d in bundle["days"] if d["date"] == req.date), bundle["days"][0])
    alert_key = req.alert_level or (day["alert"]["key"] if day["alert"] else "green")
    labels = {b[2]: b[3] for b in NOAA_BANDS}
    if alert_key not in labels:
        raise HTTPException(status_code=422, detail=f"alert_level must be one of {list(labels)}")
    top_wards = req.top_wards
    if top_wards is None:
        geo = load_wards()
        top_wards = [] if geo is None else [
            f["properties"]["ward_id"] for f in
            sorted(geo["features"], key=lambda f: f["properties"].get("hvi_rank", 999))[:3]]
    heat = req.heat_index_c if req.heat_index_c is not None else day["heat_index_corrected_c"]
    return generate_advisory(lang=req.lang, date=req.date or day["date"], alert_key=alert_key,
                             alert_label=labels[alert_key], heat_index_c=heat, top_wards=top_wards)
