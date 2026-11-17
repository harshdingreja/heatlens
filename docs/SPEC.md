# HeatShield: Project Spec

> Original spec as written by Harsh at project start (17 Nov 2026).
> Where verified facts differ from this spec, see `docs/DATA_SOURCES.md`. This file is kept unchanged as the original intent.

## Who I am and how I want to work

I'm Harsh, a 3rd-year B.Tech AI & Data Science student. I know basic Python and basic Java, I'm new to the terminal, and I've never shipped an ML project end to end. I'm building this project for my CV and **I must be able to explain every line in an interview**. So:

3. **Stop after every phase.** Summarise what we built, in a file i can read later
4. **Keep `LEARNING_LOG.md`** with one short entry per phase: concepts learned, decisions made, and why.
5. **Commit to git after every phase** with a clear message.
6. **Never invent numbers.** Every metric in the README or on my CV must come from code we actually ran. If a data source is down or different from what this spec says, tell me and propose an alternative. Don't silently fake data.
7. **Check docs before using a library or API.** APIs change, so verify current endpoints, parameter names and package versions instead of trusting memory.

## The project in one paragraph

**HeatShield** is built on **Smart India Hackathon 2026, problem statement SIH26083: "Extreme Heatwave Early Warning and Human Thermal Stress Index"** (Ministry of Earth Sciences / NCMRWF). Normal heat warnings only look at temperature, but in humid cities like Mumbai, *34 °C at 70 % humidity feels like ~47 °C* and can kill. HeatShield computes a real heat-stress index for **Mumbai** from temperature, humidity, wind and sun. It **forecasts it 1–5 days ahead** (correcting the raw weather forecast with ML), turns it into **alert levels**, estimates the **extra deaths risk** from published Indian research, maps **which of Mumbai's 24 BMC wards are most vulnerable**, and has an LLM write **advisories in English, Marathi and Hindi**. Everything is served by a **FastAPI** backend and shown in a **React dashboard with a ward map**.

## ML capabilities this must demonstrate (the point of the project)

| # | Capability | Where it shows up |
|---|---|---|
| 1 | Forecasting / time series | Heat stress 1–5 days ahead |
| 2 | Regression | ML correction of the raw forecast; state-level health model |
| 3 | Classification | Alert level (green / yellow / orange / red) |
| 4 | Anomaly detection | Days far above normal for that date |
| 5 | Clustering | Grouping wards by vulnerability profile |
| 6 | Explainability | SHAP on the forecast corrector |
| 7 | Geospatial / satellite | Land-surface temperature + green cover per ward |
| 8 | GenAI / LLM | Multilingual advisories |

## Scope

- **In:** Mumbai only, all 24 BMC wards. Daily forecasts for 1–5 days ahead. Web dashboard + REST API. Free hosting.
- **Out:** real SMS/WhatsApp, other cities, hospital-grade predictions, mobile app.
- **Stretch (only if time is left):** Telegram bot that pushes alerts, UTCI index.

## Data sources (verify each one before using it)

| Need | Source | Notes |
|---|---|---|
| Ground truth weather | **Meteostat** Python package: Mumbai **Santacruz** and **Colaba** stations | Find the station IDs with Meteostat's nearby-stations search around 19.07 N, 72.87 E. Don't hard-code guesses. Hourly temp, humidity, wind |
| Long history / climatology | **Open-Meteo Historical Weather API** (ERA5, 1940 onwards) | Used for the 30-year "normal" per calendar day (1991–2020) and anomaly detection |
| Past forecasts at fixed lead times | **Open-Meteo Previous Runs API** (`https://previous-runs-api.open-meteo.com/v1/forecast`), variables like `temperature_2m_previous_day1` … `_previous_day5` | Most models are archived from **Jan 2024**, so the forecast-correction model trains on 2024 onwards. Check which model has the longest history for Mumbai |
| Live forecast | Open-Meteo Forecast API | For the dashboard's "next 5 days" |
| Heat–mortality relationship | *"Impact of heatwaves on all-cause mortality in India: A comprehensive multi-city study"*, **Environment International 184 (2024) 108461**, 10 cities, 2008–2019, ~3.6M deaths. Headline result: a heatwave of 2+ days above the 97th percentile raises daily deaths by **~14.7 % (95 % CI 10.3–19.3)** | Read the paper. Confirm which cities are included (check whether Mumbai is) and use its relative-risk table by heatwave definition. Cite it |
| Mumbai baseline daily deaths | Civil Registration System (CRS) / MCGM annual registered deaths ÷ 365 | Find and cite the most recent year available |
| State-level heat health data | **data.gov.in**: *"State-wise Heatstroke Deaths reported under Heat Related Illness Surveillance, India from 2016 to 2021"*, *"State/UT-wise Number of Deaths Due to Heat/Sun Stroke as per NCRB 2018–2022"*, and the national year-wise heat-illness cases & deaths dataset | Small data, and known to be **undercounted**. Document this |
| Ward boundaries | Mumbai 24 BMC wards GeoJSON/shapefile (e.g. DataMeet's municipal spatial data on GitHub) | Verify ward count and names |
| Ward demographics | Census 2011 ward-level data for Greater Mumbai (population, density, slum population, workers) | Elderly-by-ward may not exist, so use what does and document it |
| Land-surface temperature + green cover | Landsat 8/9 Collection 2 Level-2 surface temperature + NDVI (Sentinel-2 or Landsat), via **Microsoft Planetary Computer** (no account needed to read) or Google Earth Engine | Summer-season median per ward |
| Validation of ward ranking | BMC's **Mumbai Climate Action Plan (MCAP) Vulnerability Assessment Report** | Compare our ward ranking with theirs (rank correlation) |

## How it works: 3 layers + core

**Core: forecast + alerts + anomalies**
1. Compute daily max **Heat Index** (NOAA Rothfusz formula with adjustments) and an approximate **WBGT** (shaded estimate; use `pythermalcomfort` if suitable, otherwise the Australian BoM approximation, and document which). 🧑‍💻 I write the heat-index function.
2. **Alert levels** from Heat Index using NOAA bands: Caution 26.7–32.2 °C, Extreme Caution 32.2–39.4 °C, Danger 39.4–51.7 °C, Extreme Danger ≥ 51.7 °C, mapped to 🟢🟡🟠🔴. Also check whether IMD's experimental heat-index colour bands are documented. If they are, offer them as an India-specific option.
3. **Forecast corrector:** for each lead time 1–5 days, predict the *observed* daily max heat index at Santacruz/Colaba from the raw forecast plus features (forecast values, lead time, day of year, recent observed values, climatology). Models in this order:
   - Baseline A: raw forecast as-is
   - Baseline B: persistence (tomorrow = today)
   - Baseline C: climatology
   - Model: linear regression → **LightGBM**
   - **Time-based split only, never shuffle:** train on Jan 2024–Dec 2025, test on Jan 2026–latest. 🧑‍💻 I write the split.
4. **Evaluation:** MAE and RMSE in °C per lead time vs all baselines. For alerts: precision / recall / F1 on Danger-or-worse days, plus a confusion matrix. 🧑‍💻 I write the MAE function.
5. **Explainability:** SHAP summary plot for the LightGBM corrector.
6. **Anomaly detection:** departure from the 1991–2020 normal for that calendar day (z-score), plus an IsolationForest comparison. Flag "abnormally hot for this date".

**Layer 1: science-based death-risk estimate**
- Apply the paper's relative risks to the forecast: if forecast conditions meet a heatwave definition, `expected extra deaths/day = baseline daily deaths × (RR − 1)`, shown **with its confidence interval**.
- Label it everywhere as *"evidence-based estimate, not a clinical prediction."*

**Layer 2: ML on real Indian health data**
- Join state-year heatstroke deaths/cases with state-year counts of high-heat-stress days (ERA5 at state capitals or state centroids).
- Fit a simple, explainable model (Poisson regression first, since it's count data, and explain why). Report honestly. With ~200 rows, keep it simple and say so.
- Use it as a sanity check on Layer 1, not as the main predictor. **Build this layer last and cut it if we run out of time.**

**Layer 3: ward vulnerability**
- Per ward: summer LST median, NDVI (green cover), population density, slum share, worker share.
- **Heat Vulnerability Index** = normalised indicators combined (start with equal weights, then try PCA weights, and compare).
- **K-means clustering** of wards into 3–4 risk groups, choosing k with the elbow and silhouette methods.
- Cross-check our ranking against the MCAP vulnerability report.
- **Final ward risk = city-level hazard (forecast alert) × ward vulnerability.**

**LLM advisories**
- `POST /advisory` takes the alert level, date, top-risk wards and language (`en` / `mr` / `hi`) and returns a short, practical advisory (e.g. shift outdoor work before 11 am, hydration, check on elderly neighbours).
- Use **Groq** as primary and **Gemini** as fallback. Keys go in `.env` (`GROQ_API_KEY`, `GEMINI_API_KEY`), never committed. Add `.env.example`.
- Use a strict prompt: the LLM may only use the numbers we pass in and must not invent statistics.

## Backend (FastAPI)

- `GET /health`
- `GET /forecast?days=5`: per day: raw vs corrected heat index, WBGT, alert level, anomaly flag
- `GET /wards`: GeoJSON with HVI, cluster, and today's ward risk
- `GET /risk`: Layer 1 estimate with CI and source citation
- `POST /advisory`: LLM advisory (`lang` = en/mr/hi)
- Cache Open-Meteo calls (they're free but rate-limited). Pydantic models for every response. A few `pytest` tests for the heat-index function, the split, and each endpoint.

## Frontend (React + Vite + Tailwind)

- One page: a 5-day alert strip at the top, a **ward map** (react-leaflet) coloured by risk, a chart of corrected vs raw forecast, the death-risk card with its source, and an advisory panel with an EN / मराठी / हिंदी toggle.
- Mobile-friendly. If we're behind schedule, Streamlit is the fallback, but ask me first.

## Repo structure

```
heatshield/
├── docs/SPEC.md            # this file
├── LEARNING_LOG.md
├── README.md               # problem, approach, results table, limitations, demo link
├── RESULTS.md              # every metric, generated by scripts
├── data/raw/  data/processed/   # gitignored; scripts download data
├── src/heatshield/
│   ├── ingest/             # weather.py, stations.py, health.py, wards.py, satellite.py
│   ├── features/heat_indices.py
│   ├── models/             # corrector.py, alerts.py, anomaly.py, vulnerability.py, mortality_risk.py, state_health.py
│   └── llm/advisory.py
├── api/main.py
├── web/                    # React app
├── notebooks/              # EDA only
└── tests/
```

## Build plan (~8–9 days, one phase per day, stop after each)

| Day | Phase |
|---|---|
| 1 | Setup (venv, git, structure) + weather ingestion (Meteostat, Open-Meteo archive, Previous Runs) + EDA notebook |
| 2 | Heat Index / WBGT + alert levels + anomaly detection |
| 3 | Forecast corrector: baselines → LightGBM, evaluation, SHAP |
| 4 | Layer 3: ward boundaries, census, LST/NDVI → HVI + clustering + MCAP cross-check |
| 5 | Layer 1 (paper-based death risk) + Layer 2 (state health model, cut if short on time) |
| 6 | FastAPI + LLM advisories + tests |
| 7 | React dashboard + map |
| 8 | Deploy (API on Render free tier, frontend on Vercel or GitHub Pages), README, RESULTS, demo GIF |
| 9 | Buffer / stretch (Telegram bot, UTCI) |

## Definition of done

1. Live demo link + public GitHub repo with README, results table and limitations.
2. The corrected forecast **beats the raw forecast** on the 2026 test period, or, if it doesn't, the README says so honestly with analysis.
3. All 24 wards have an HVI score and cluster, compared against MCAP.
4. The death-risk estimate shows its source and confidence interval.
5. Advisories work in all 3 languages.
6. I can explain every module in 2 minutes. You've quizzed me on each phase.

## Honest limitations to put in the README

- Official Indian heat-death numbers are known undercounts, so Layer 2 labels are noisy.
- Layer 1 applies multi-city relative risks to Mumbai. That's an estimate, not a Mumbai-specific model.
- ERA5 and global forecast models are coarse (~10–25 km), so ward-level variation comes from satellite LST, not the forecast.
- Station ground truth is only 2 points for the whole city.

## At the very end

Write me **2 CV bullet points** for HeatShield using only the real numbers from `RESULTS.md`, in this style:
*"Built HeatShield on SIH 2026 PS #26083 (MoES): forecasts Mumbai heat stress 1–5 days ahead with LightGBM, cutting error from X °C to Y °C vs the raw forecast; maps vulnerability across 24 BMC wards with satellite LST + clustering; FastAPI + React, with LLM advisories in 3 languages."*
