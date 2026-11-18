# HeatLens: demo guide

Everything you need to run, present and defend the project.

---

## 1. Run it on your Mac

Open **Terminal**, then run each block in order.

**Go to the project and switch on the Python environment** (do this in every new terminal):

```bash
cd ~/heatshield && source .venv/bin/activate
```

**Start the API** (leave this terminal open; it serves http://localhost:8000):

```bash
uvicorn api.main:app --reload --port 8000
```

**Start the dashboard** in a *second* terminal tab:

```bash
cd ~/heatshield/web && npm run dev
```

Open http://localhost:5173. The API's interactive docs are at http://localhost:8000/docs.

**Run the tests:**

```bash
cd ~/heatshield && source .venv/bin/activate && python -m pytest -q
```

### Rebuild everything from scratch (optional, ~15 min, needs internet)

```bash
python -m heatlens.ingest.stations
```

```bash
python -m heatlens.ingest.weather
```

```bash
python -m heatlens.features.daily && python -m heatlens.models.corrector && python -m heatlens.models.anomaly
```

```bash
python -m heatlens.models.vulnerability
```

```bash
python scripts/make_results.py
```

**LLM keys:** copy `.env.example` to `.env` and paste your `GROQ_API_KEY` / `GEMINI_API_KEY`. Without keys the advisory still works using hand-written templates, and the panel says "template".

---

## 1b. Deploy (free): what YOU need to click

The code is already on GitHub (public repo `heatlens`) with all config files (`render.yaml`, `web/vercel.json`).

**Step 1: API on Render (~10 min)**
1. Go to https://render.com and click **Get Started**. Sign up with **GitHub**.
2. Click **New +** → **Blueprint** → pick the `heatlens` repo → **Connect**. Render reads `render.yaml` by itself.
3. It asks for 3 values. Paste your `GROQ_API_KEY` and `GEMINI_API_KEY` (or leave them empty; templates will be used). Leave `ALLOWED_ORIGINS` empty: any `*.vercel.app` site is already allowed.
4. Click **Apply** and wait for the build (5–10 min). Copy the URL, e.g. `https://heatlens-api.onrender.com`.
5. Open `<that URL>/health`. You should see `"status": "ok"`.

**Step 2: Dashboard on Vercel (~5 min)**
1. Go to https://vercel.com and sign up with **GitHub**.
2. **Add New…** → **Project** → import `heatlens`.
3. Set **Root Directory** to `web` (click Edit). The framework is detected as Vite.
4. Under **Environment Variables** add `VITE_API_URL` = your Render URL (no trailing `/`).
5. Click **Deploy**. Copy the `https://….vercel.app` link into the top of `README.md` as the live demo link.

**Before presenting:** Render's free server sleeps after ~15 minutes idle, and the first request then takes about a minute. Open the dashboard 2 minutes before you present so it's awake.

---

## 2. Two-minute talk script

> **(Problem, 20 s)** Heat warnings in India mostly look at temperature. But Mumbai is humid. At 34 °C and 70 % humidity, sweat can't evaporate, and the body feels about 47 °C. This is SIH 2026 problem SIH26083 from the Ministry of Earth Sciences: an early warning based on how heat *feels*, not just the thermometer.
>
> **(What it does, 30 s)** HeatLens computes the NOAA Heat Index and an approximate WBGT for Mumbai. It forecasts them 1 to 5 days ahead and turns them into green/yellow/orange/red alerts, with the IMD bands too. It flags days that are abnormally hot *for that date*, maps which of the 24 BMC wards are most vulnerable, estimates extra deaths from a published Indian study, and writes advice in English, Marathi and Hindi.
>
> **(The ML, 40 s)** The key finding: every global weather model forecasts Mumbai about 3 °C too cool in heat-index terms. So I trained a corrector on 2024–2025 and tested it on all of 2026, data it never saw. It cuts the average error from 3.75 °C to 1.45 °C, 61 % lower. More importantly, the raw forecast missed more than half of the dangerous days; the corrected one catches 92 %. I tried LightGBM, but plain linear regression beat it, because trees can't extrapolate a drifting bias. The final model is linear regression plus a small LightGBM on its leftover error, chosen by validation inside 2025, never by peeking at the test set.
>
> **(Wards, 20 s)** For each ward I combined satellite land-surface temperature and green cover from Landsat with Census density, slum share and worker share into a vulnerability index, then clustered the wards with k-means. The ranking agrees strongly with the city's own Climate Action Plan data.
>
> **(Close, 10 s)** It's all served by a FastAPI backend and a React dashboard. Every number comes from code I ran, and the limitations are written in the README.

---

## 3. The three functions you "own" (marked `# HARSH: explain this`)

### `heat_index_c(temp_c, rh_pct)`: `src/heatlens/features/heat_indices.py`
1. `T = c_to_f(temp_c)`: NOAA's formula is defined in °F, so convert first.
2. `RH = np.asarray(...)`: make it an array so the same code works for one number or a whole column.
3. `simple = 0.5 * (T + 61 + (T - 68) * 1.2 + RH * 0.094)`: Steadman's simple formula, good when it isn't hot.
4. `full = -42.379 + ...`: the **Rothfusz regression**, a polynomial in T and RH fitted to Steadman's apparent-temperature tables. The T×RH terms capture "humidity matters more when it's hotter".
5. `dry` adjustment: when RH < 13 % and 80–112 °F, the regression is too high, so subtract a correction.
6. `humid` adjustment: when RH > 85 % and 80–87 °F, it's too low, so add a correction.
7. `np.where((simple + T) / 2 >= 80, full, simple)`: NOAA's rule. Average the simple result with T; if that's at least 80 °F, use the full regression.
8. Convert back to °C. NaN in gives NaN out (we never invent a value).
**Check:** 96 °F at 65 % gives 121 °F, the same as NOAA's chart (tested in `tests/test_core.py`).

### `time_split(df)`: `src/heatlens/models/corrector.py`
1. Sort by date.
2. `train` = 24 Jan 2024 → 31 Dec 2025 (24 Jan is when all forecast archives are complete).
3. `test` = 1 Jan 2026 → latest.
4. `assert train.max < test.min`: a guard that the future never leaks into training.
**Why not random?** A random split would train on Oct 2026 and test on Sep 2026, so the model would "know the future" and look better than it really is.

### `mae(y_true, y_pred)`: same file
1. Convert both to float arrays; `assert` they're the same length.
2. `errors = np.abs(y_true - y_pred)`: size of each miss, ignoring direction.
3. `return errors.mean()`: the average miss, in °C. "MAE 1.45" means "off by 1.45 °C on a typical day".
RMSE squares the misses first, so big misses count more.

---

## 4. Each module in one paragraph

| Module | What it does |
|---|---|
| `ingest/stations.py` | Finds Santacruz (43003) and Colaba (43057) by **name** via Meteostat's nearby search. Downloads hourly obs from **GHCNh only**, because Meteostat's default mixes in model data (85 % of Colaba 2025). Casts UInt8 humidity to float (80 − 81 = 255 bug). |
| `ingest/weather.py` | Open-Meteo: ERA5 history 1991→now (`models=era5` for a consistent climate), Previous Runs API (what 4 models predicted 1–5 days earlier), live forecast. Caches per year; retries politely on HTTP 429. |
| `features/heat_indices.py` | NOAA Heat Index + BoM WBGT approximation. |
| `features/daily.py` | Hourly → daily: max heat index, Tmax, humidity at the hottest hour. Valid-day rules. 1991–2020 climatology (±15-day window). Station-vs-ERA5 monthly offset (station is 1.5–3.5 °C hotter). |
| `models/alerts.py` | NOAA bands → level 0–4 and colours; IMD experimental bands (PIB, 20 Jul 2023). |
| `models/corrector.py` | Builds leak-free features (what was known at issue time), 4 baselines, linear / LightGBM / stack, rolling validation, metrics, alert F1, confusion matrix, SHAP. |
| `models/anomaly.py` | z-score vs the normal for that date, plus IsolationForest on (today's departure, 3-day departure). |
| `models/vulnerability.py` | Ward HVI (equal vs PCA weights), k-means with elbow + silhouette, MCAP cross-check. |
| `models/mortality_risk.py` | Layer 1: paper's relative risk → extra deaths/day with CI. |
| `models/state_health.py` | Layer 2: Poisson regression of state heat deaths on heat-stress days. |
| `llm/advisory.py` | Groq → Gemini → template. Strict prompt and a validator that rejects any number not in the inputs. |
| `service.py` | Live pipeline for the API, with a 30-minute cache. |
| `api/main.py` | FastAPI: `/health`, `/forecast`, `/wards`, `/risk`, `/model`, `/advisory`. Pydantic schemas, CORS. |
| `web/` | React + Vite + Tailwind dashboard, react-leaflet map, recharts chart. |

---

## 5. Ten questions your teacher may ask

**1. Why the heat index and not just temperature?**
The body cools by evaporating sweat. Humid air slows evaporation, so the same temperature is more dangerous. In our data, humidity adds about 6–8.5 °C of felt heat in April–September at Santacruz (EDA notebook, section 2).

**2. What exactly does your ML model predict?**
The *observed* daily maximum heat index at Santacruz, 1–5 days ahead. It actually learns the **error** of the raw forecast (observed − forecast) and adds that correction to the forecast.

**3. How do you know it isn't overfitting or cheating?**
Strict time split: train 2024–2025, test 2026, which was never used for any decision. Features only use what was known when the forecast was issued (observations up to the day *before* the issue date). The model choice was made by rolling validation inside 2025.

**4. Why did linear regression beat LightGBM?**
The forecast's error drifts: about +2.8 °C on average in training, larger in 2026. A tree model can only output values it saw in training, so it can't follow a drift. A linear model can extrapolate, especially via the "recent bias" feature.

**5. What are your baselines and why do they matter?**
Raw forecast, persistence (the last observed day), and climatology (the normal for that date). A model is only useful if it beats simple rules. Ours does at every lead time.

**6. Precision fell from 0.94 to 0.72. Isn't that worse?**
For a health warning, missing a dangerous day (low recall) is worse than an extra warning. Raw recall was 0.45, so it missed more than half the Danger days; ours is 0.92. That's a deliberate, stated trade-off.

**7. Where does your data come from, and can you trust it?**
NOAA GHCNh station observations (real measurements only), ECMWF ERA5 reanalysis, archived forecasts from ECMWF, NOAA GFS, DWD ICON and JMA via Open-Meteo, Landsat via Microsoft Planetary Computer, and Census 2011. I removed model-filled values and checked GHCNh against the older ISD archive (0.03 °C mean difference).

**8. How did you build the ward vulnerability index?**
Five indicators per ward: summer land-surface temperature, NDVI (lower = more vulnerable), population density, slum share and worker share. Each is scaled 0–1 and averaged (equal weights); PCA weights gave nearly the same ranking. Then k-means grouped the wards; k was chosen with the elbow and silhouette methods.

**9. Can your death estimate be trusted?**
It's labelled "evidence-based estimate, not a clinical prediction". The peer-reviewed study (Env. Int. 2024, 10 cities) includes Mumbai, so I use Mumbai's own effect: +3.4 % deaths (95 % CI 0.8–6.1) when daily mean temperature stays above Mumbai's 97th percentile for 2+ days. With MCGM's 255.5 deaths/day (2023), that's about 8.7 extra deaths per heatwave day (CI 2.0–15.6). The state-level model (Layer 2) is only a sanity check: hotter state-years report more heat deaths (Negative Binomial, +5.8 % per 10 danger days). I used Negative Binomial instead of Poisson because the counts were 37× more variable than Poisson assumes.

**10. How do you stop the LLM from inventing numbers?**
Three layers. The prompt says to use only the given numbers. A validator extracts every number from the reply (including Devanagari digits) and rejects it if any number wasn't in the inputs. If the reply is rejected, the system falls back to Gemini, then to a hand-written template.
