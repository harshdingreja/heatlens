# HeatLens API contract

Base URL: `http://localhost:8000` locally, the Render URL in production (frontend reads `VITE_API_URL`).
All temperatures are °C. Dates are ISO `YYYY-MM-DD` in IST. Numbers may be `null` when data is missing.

## GET /health
```json
{"status": "ok", "version": "0.1.0", "forecast_model": "gfs_seamless", "corrector_trained": true, "time": "2026-11-17T18:00:00+05:30"}
```

## GET /forecast?days=5   (days 1..5)
```json
{
  "issued": "2026-11-17",
  "location": {"name": "Mumbai (Santacruz, IMD 43003)", "lat": 19.1167, "lon": 72.85},
  "forecast_model": "gfs_seamless",
  "corrector": "LightGBM",
  "obs_latest_date": "2026-11-14",
  "alert_scheme": "NOAA heat index bands",
  "days": [
    {
      "date": "2026-11-18", "lead_days": 1,
      "tmax_c": 33.4, "rh_at_tmax_pct": 58.0, "wind_kmh": 12.1, "shortwave_max_wm2": 780.0,
      "heat_index_raw_c": 37.9, "heat_index_corrected_c": 39.1, "wbgt_c": 28.7,
      "alert": {"level": 2, "key": "extreme_caution", "label": "Extreme Caution", "color": "yellow"},
      "imd_alert": {"key": "yellow", "label": "Yellow", "color": "yellow"},
      "normal_heat_index_c": 36.0, "anomaly_z": 1.1, "is_anomaly": false, "isolation_forest_anomaly": false
    }
  ]
}
```
`alert.level`: 0 green (below Caution or Caution), 1 = ... see `models/alerts.py`. Colors are one of `green|yellow|orange|red`.

## GET /wards
GeoJSON FeatureCollection (EPSG:4326) with an extra top-level `meta` member.
```json
{
  "type": "FeatureCollection",
  "meta": {"hazard_date": "2026-11-18", "hazard_alert": "extreme_caution", "hazard_score": 0.5, "hvi_method": "equal weights", "n_clusters": 3},
  "features": [
    {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": []},
     "properties": {
       "ward_id": "K/E", "ward_name": "K East (Andheri East)",
       "population": 823885, "pop_density": 34000.0, "slum_share": 0.62, "worker_share": 0.40,
       "lst_summer_c": 41.2, "ndvi_summer": 0.18,
       "hvi": 0.71, "hvi_rank": 3, "cluster": 2, "cluster_label": "High vulnerability",
       "risk_today": 0.36, "risk_level": "high"
     }}
  ]
}
```
`risk_level` is one of `low|moderate|high|very_high`.

## GET /risk
```json
{
  "disclaimer": "Evidence-based estimate, not a clinical prediction.",
  "citation": "…Environment International 184 (2024) 108461…",
  "baseline_daily_deaths": 250.0, "baseline_source": "…",
  "heatwave_definition": "…",
  "days": [
    {"date": "2026-11-18", "heatwave": false, "relative_risk": null, "rr_ci": null,
     "extra_deaths": 0.0, "extra_deaths_ci": [0.0, 0.0]}
  ],
  "state_model_check": {"summary": "…"}
}
```

## POST /advisory
Request (all fields except `lang` optional; the server fills missing ones from today's forecast and ward data):
```json
{"lang": "mr", "date": "2026-11-18", "alert_level": "extreme_caution", "heat_index_c": 39.1, "top_wards": ["K/E", "L", "M/E"]}
```
Response:
```json
{"lang": "mr", "text": "…", "provider": "groq", "model": "…", "inputs_used": {"date": "…", "alert_level": "…", "heat_index_c": 39.1, "top_wards": ["…"]}}
```
`provider` is `groq`, `gemini`, or `template` (used when no API key works; the response says so).

## GET /model
Everything the "Model performance" page shows, read from saved results in `artifacts/` (nothing is computed live):
`corrector` (test metrics per lead and method, alert precision/recall/F1, confusion matrices, SHAP top features, 2026 backtest rows),
`anomalies` (2026 series with z-score and IsolationForest flags, agreement stats), `wards` (k-means scan, PCA weights, MCAP correlations),
`health` (Layer 1 effect + CI, Layer 2 Poisson/Negative Binomial table).
