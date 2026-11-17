# Learning log

## Phase 1: Setup + data ingestion
- **Check where data comes from:** Meteostat's default mixes in a *forecast model* (85 % of Colaba's 2025 hours). We keep GHCNh real observations only. NOAA's ISD archive ended Aug 2025, and GHCNh replaces it.
- **dtype trap:** humidity is stored as UInt8, so `80 − 81 = 255`. Always cast to float before doing maths.
- The forecast archive starts 24 Jan 2024 for Mumbai (not 1 Jan as the spec assumed). Checked by querying, not guessed.

## Phase 2: Heat index, alerts, anomalies
- Heat index = NOAA Rothfusz regression + 2 edge adjustments; checked against NOAA's chart (96 °F/65 % → 121 °F).
- "Abnormal" must be relative to the *date*: z-score vs the 1991–2020 normal. ERA5 is ~2.4 °C cooler than the station, so normals are shifted by a monthly offset.
- IsolationForest is unsupervised; it flags *rare* points (hot or cold), so we keep only the hot side.

## Phase 3: Forecast corrector
- Predict the forecast's **error**, not the temperature itself; features may only use what was known at issue time (no leakage).
- Linear regression beat LightGBM: trees can't extrapolate a drifting bias. The final stack (linear + small LightGBM) was chosen by rolling validation inside 2025, never on the 2026 test set.
- Result: MAE 3.75 → 1.45 °C; Danger-day recall 0.45 → 0.92 (precision 0.94 → 0.72, a stated trade-off).

## Phase 4: Ward vulnerability
- Normalise each indicator to 0–1, flipped so higher = more vulnerable (NDVI is reversed). Equal and PCA weights rank wards almost identically (ρ 0.994).
- Silhouette picks k = 4, but scores of ~0.3 mean the wards form a continuum; we say so.
- Validation against MCAP: agrees on heat (ρ 0.93), disagrees on housing vulnerability. Reported honestly.

## Phase 6–7: API, LLM, dashboard
- FastAPI + Pydantic: the response schema is enforced, and NaN becomes `null` (JSON has no NaN). CORS lets the browser call the API.
- LLM safety: a validator rejects any number not given in the inputs (Devanagari digits included), with fallback Groq → Gemini → template.
- Pickle gotcha: a class saved from a script run as `__main__` can't be loaded elsewhere, so always save via the real module path.
