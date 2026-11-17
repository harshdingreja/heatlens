# Layers 1 and 2: health risk

Code: `ingest/health.py` (data), `models/mortality_risk.py` (Layer 1), `models/state_health.py` (Layer 2).
Outputs: `artifacts/mortality_config.json`, `artifacts/state_health_results.json`, `docs/figures/health_*.png`.
Rebuild: `python -m heatshield.ingest.health && python -m heatshield.models.mortality_risk && python -m heatshield.models.state_health`

## Layer 1: extra deaths during a heatwave (evidence-based estimate, not a clinical prediction)

**Paper.** de Bont et al. 2024, *Environment International* 184:108461, doi:10.1016/j.envint.2024.108461. Open access: [Europe PMC PMC11790314](https://europepmc.org/article/PMC/PMC11790314). Full text and supplement were downloaded via the Europe PMC API.
- 10 cities: Ahmedabad, Bangalore, Chennai, Delhi, Hyderabad, Kolkata, **Mumbai**, Pune, Shimla, Varanasi. Mumbai is included: 2009 to Nov 2015, mean 251 deaths/day (Table 1).
- Exposure: **daily mean** temperature (ECMWF 0.25°). Heatwave = above the city's annual 95th/97th/99th percentile for 1/2/3/5 consecutive days. Main definition: **≥ 2 days above P97**.
- Supplementary Table S1 (parsed into `data/raw/health/paper_table_s1.csv`), 97th percentile:

| Consecutive days | Mumbai % increase (95 % CI) | 10-city pooled % increase (95 % CI) |
|---|---|---|
| 1 | 5.2 (3.0–7.4) | 12.2 (8.5–15.9) |
| **2 (main)** | **3.4 (0.8–6.1)** | **14.7 (10.3–19.3)** |
| 3 | 4.0 (0.9–7.2) | 17.8 (12.1–23.8) |
| 5 | 5.0 (0.3–10.0) | 19.4 (11.5–27.9) |

**Decision:** we use **Mumbai's own estimate** (RR 1.034, CI 1.008–1.061) because the paper measured it for Mumbai. The paper also says Mumbai had among the weakest effects. The 10-city pooled RR (1.147) is reported next to it as an upper scenario (`pooled_10_city_scenario`).

**Baseline deaths.** MCGM Key Statistics ([mcgm.gov.in civicDemographics](https://mcgm.gov.in/irj/portal/anonymous/qlCivicDemographics), read 17 Nov 2026): **93,255 deaths registered in 2023**, which is **255.49/day**. This agrees with the paper's 251/day.

**Formula.** `extra deaths/day = 255.49 × (RR − 1)`, so a main-definition heatwave day gives **8.7 extra deaths (95 % CI 2.0–15.6)**. The pooled scenario gives 37.6 (26.3–49.3).

**Thresholds and temperature space.** Percentiles only make sense against the same kind of data.
- Thresholds come from the **Santacruz station** (GHCNh daily mean, days with ≥ 18 hourly readings, 2021–2025, n = 1,803 days): **P95 31.33, P97 31.66, P99 32.32 °C**.
- Reference values: ERA5 nearest grid cell, 2009–2015, P97 = 30.25 °C. The paper's own city-average P97 was about 31.2 °C (Table 1: heatwaves averaged 31.5 °C, 1.1 % above P97).
- Observed days are station data, so they're used directly. Forecast days come from a model, so we subtract that model's mean daily-mean bias against the station, per lead day. The bias was measured over 24 Jan 2024 to 31 Dec 2025 only (no 2026 data), about 689 days per lead:

| Model | Bias lead 1 / 3 / 5 (°C) |
|---|---|
| ICON (API default) | −0.69 / −0.69 / −0.73 |
| ECMWF IFS 0.25 | −1.07 / −1.17 / −1.16 |
| GFS | +0.75 / +0.58 / +0.61 |
| JMA GSM | −0.98 / −1.05 / −1.05 |

**Sanity check on history.** The main definition fires on 49 days, which form **12 episodes in 2021–2025 (2.4/yr)**. The paper reports 3.6/yr for Mumbai in 2009–2015, so it's the same order. Missing station days break runs, so we slightly undercount. See `docs/figures/health_mumbai_heatwave_days.png`.

**API use.** `estimate_extra_deaths(daily)` takes the last ≤ 5 observed Santacruz days (`is_forecast=False`) followed by forecast days (`is_forecast=True`, raw ICON daily mean/max). Observed days let a heatwave that began before today count. A gap in dates breaks a run. It returns only forecast days, each with `relative_risk`, `rr_ci`, `extra_deaths`, `extra_deaths_ci`, all definitions met, and the pooled scenario.

## Layer 2: state-level model on real Indian heat-death data

**Data (213 state-years, 36 states/UTs, 2017–2022, 4,925 deaths):**
- **Outcome:** NCRB *Accidental Deaths & Suicides in India*, heat/sun-stroke deaths. These were taken from Parliament answers: the [PIB annexure for 2017–2021](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2023/jul/doc2023726228401.pdf) and the [MoES/PIB Release 2158403 for 2018–2022](https://www.moes.gov.in/static/uploads/2025/08/0e2522b2318ad6307cfb52656e346820.pdf). The overlapping years agree exactly, and this is checked in code. Yearly totals are 1127, 890, 1274, 530, 374, 730.
- **Exposure:** days per year with max hourly NOAA heat index ≥ 39.4 °C ("Danger") at each state/UT capital, from ERA5 (`models=era5`). Capitals were geocoded with the Open-Meteo geocoding API. Punjab, Haryana and Chandigarh share Chandigarh.
- **Offset:** log Census-2011 population (the 2011 column of Wikipedia's state population list).

**Why not data.gov.in directly?** On 17 Nov 2026, every data.gov.in file returned 403 unless you filled a sign-up form with a captcha or used a personal API key, and the public sample key was rate-limited. The NCRB dataset on data.gov.in cites the same Parliament answer. Its 10-row preview matches our parsed table exactly. Two smaller tables were transcribed from data.gov.in previews and kept for reference only:
- NPCCHH national suspected cases / confirmed deaths, 2021–2024 (all 4 rows)
- IDSP state table 2016–2021 (**only 10 of 25 rows** are visible, so it is not used in the model)

**Why Poisson?** Deaths are non-negative counts with many zeros (52 % of rows are 0). Poisson regression models log(expected deaths), and `exp(coef)` is a rate ratio.

| Model (`deaths ~ danger_days + year`, offset log pop) | Rate ratio per +10 danger days (95 % CI) | Fit |
|---|---|---|
| Poisson | 1.013 (1.008–1.018) | Pearson dispersion **37.5** (should be ≈ 1), AIC 6107 |
| **Negative Binomial (NB2)** | **1.058 (1.011–1.108)**, p = 0.016 | alpha 3.03, AIC **1169** |

The Poisson model is badly overdispersed, so its CI is too narrow. The Negative Binomial model allows the extra variance and is the one to quote: **10 more "Danger" heat-index days in a year is associated with about 6 % more reported heat deaths**. Explanatory power is low (McFadden pseudo-R² 0.011), because reporting differs hugely between states. For example, humid southern capitals have many danger days but report almost no deaths. Using "Extreme Caution" days (≥ 32.2 °C) instead gives Poisson 1.033 (1.028–1.038). See `docs/figures/health_state_poisson.png`.

**Sanity check of Layer 1.** The paper attributes about 48 deaths/yr (CI 12–84, Table S3) to heatwaves in Mumbai, which is 3.69 per million (MCGM 2023 population). Maharashtra's certified heat/sun-stroke deaths average 95.3/yr, or 0.85 per million (Census 2011). The paper's rate is about 4.3× higher. That gap is expected: all-cause excess deaths include heart and lung deaths that are never certified as heatstroke, and official counts are known undercounts. So Layer 2 does not contradict Layer 1. It only confirms the direction: hotter state-years report more deaths.

## Limitations (say these out loud)
- Layer 1 applies RRs from 2009–2015 to today. Thresholds come from 5 years of station data (2021–2025), not the paper's satellite/ECMWF city average.
- Mumbai's own CI (0.8–6.1 %) is wide, and some longer definitions have CIs crossing 0 (`ci_excludes_zero` in the config).
- Baseline deaths are a 2023 annual average, so seasonal variation is ignored.
- Layer 2: about 200 rows, undercounted and inconsistently reported outcomes, one capital per state as exposure, and population fixed at 2011. Use it as a sanity check, not a predictor.
