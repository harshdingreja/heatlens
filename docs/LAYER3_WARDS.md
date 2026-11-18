# Layer 3: Ward heat vulnerability (24 BMC wards)

Run: `python -m heatlens.models.vulnerability` (add `--refresh` to rebuild the Landsat composites, which takes about 5 minutes).
Outputs: `artifacts/wards.geojson`, `artifacts/vulnerability_summary.json` (every number below comes from it), `docs/figures/layer3_*.png`.

## Data (all real, downloaded by code)
| Indicator | Source | Direction |
|---|---|---|
| Ward boundaries (24) | DataMeet Municipal_Spatial_Data `BMC_Wards.geojson` | n/a |
| population, slum_share | BMC Public Health Dept "Census 2011 FAQ" (official ward-wise table) | slum share ↑ = more vulnerable |
| worker_share = (main + marginal workers) / population | Census of India 2011 PCA, ward level (DDW_PCA2723 Mumbai, DDW_PCA2722 Suburban) | ↑ = more vulnerable (daytime exposure proxy) |
| pop_density = population / polygon area (UTM 43N) | derived | ↑ = more vulnerable |
| lst_summer_c, ndvi_summer | Landsat 8/9 C2 L2, Mar–May 2023–25, < 20 % cloud, 55 scenes (Planetary Computer) | LST ↑ = more, NDVI ↑ = **less** vulnerable |

**Ward count.** BMC split P/North (2023) and K/East (2024), but the boundaries, Census 2011 and MCAP all use the 24-ward layout, so we keep 24.
**Census-ward mapping is proven, not assumed.** The census uses 97 small wards (codes like `0206`). Grouping them by the first two digits gives 24 totals, and each total matches exactly one BMC ward population (all 24 match exactly, summing to 12,442,373).
**Satellite.** LST in °C = DN × 0.00341802 + 149 − 273.15, and reflectance = DN × 0.0000275 − 0.2 (both from the STAC metadata). Pixels flagged as cloud, dilated cloud, cirrus, shadow **or water** are masked out, because sea and creek pixels would make coastal wards look cool. We take the per-pixel median over all dates, then the ward mean.

## Method
1. **Min-max normalise** each indicator to 0..1, oriented so that 1 = most vulnerable. NDVI is flipped.
2. **HVI (equal weights)** = mean of the 5 scores. **HVI (PCA weights)**: keep components with eigenvalue > 1 (2 kept, together explaining 84 % of the variance). Each indicator's weight = Σ (variance share × loading²), rescaled to sum to 1. Resulting weights: 0.19–0.21.
3. **Chosen `hvi` = equal weights.** With n = 24, PCA loadings are unstable; equal weights are transparent; and PCA gives almost the same ranking anyway.
4. **K-means** on z-scored indicators, k = 2..8 (`n_init = 50`, seed 42). Rule: the highest silhouette with k ≥ 3, because we need at least low/moderate/high tiers.

## Results
| | value |
|---|---|
| Spearman ρ, equal vs PCA ranking | **0.994** |
| Leave-one-indicator-out ρ vs full HVI | 0.906 (drop NDVI) to 0.980 (drop density) |
| Silhouette k = 2..8 | 0.253, 0.292, **0.305**, 0.294, 0.282, 0.299, 0.266 → **k = 4** |
| Clusters | Very high: C · High: B, E, F/N, F/S, G/N, H/E, K/E, L · Moderate: A, D, G/S, H/W, K/W · Low: 10 northern/eastern suburbs |
| Top 5 HVI | C 0.757, L 0.682, G/N 0.617, H/E 0.598, K/E 0.588 |
| Least vulnerable | R/C 0.146, T 0.151 (green, near Sanjay Gandhi NP) |

Silhouettes of 0.25–0.31 are weak: the wards form a continuum, not crisp groups. C forms a cluster of its own because it is by far the densest ward (86,858 people/km², NDVI 0.16).

## MCAP cross-check (BMC/WRI India 2022 Vulnerability Assessment)
MCAP publishes **no composite ward index**, so we compare against the ward-level numbers it does publish. Figure 8 (p. 21) gives the ward mean October LST for 2017–19, plus the ward order by % metal/asbestos roofs. We digitised it from the PDF image. As a validation, 23 of 24 values fall inside the bins on MCAP's own Figure 33 map.
| Comparison (n = 24) | Spearman ρ | p |
|---|---|---|
| Our summer LST vs MCAP October LST | **0.900** | 2.1e-9 |
| Our HVI vs MCAP LST | **0.926** | 8.5e-11 |
| Our HVI rank vs MCAP roofing rank | −0.344 | 0.099 (not significant) |
| Our slum-share rank vs MCAP roofing rank | 0.741 | 3.5e-5 |

- Our satellite processing independently reproduces MCAP's heat map: ρ = 0.90, despite a different season and different years.
- Our HVI does **not** match MCAP's housing-material order. MCAP's roofing order is led by slum-heavy suburbs (S, P/N, N, M/E). Our HVI is led by dense, hot island-city wards (C, L, G/N). The underlying data agree (our slum share tracks their roofing, ρ = 0.74); the difference is that our HVI weights density and surface heat equally with slums.
- MCAP's most heat-exposed ward, M/E (40.08 % of people on ≥ 35 °C surfaces), is **12th** in our HVI. MCAP's least exposed, A (0.92 %), is **16th**.

## Limitations
- Census 2011 is 15 years old. Wards have grown, and slums have been redeveloped since.
- Density is gross (whole polygon area), so wards containing forest or mangroves (R/C, T, M/E) look less dense than their built-up areas really are.
- `worker_share` only ranges 0.35–0.48, but min-max stretches it to 0..1. It is a weak proxy, since the census has no "outdoor worker" split by ward. Dropping it changes the ranking little (ρ = 0.964).
- LST measures ground-surface temperature, not the air temperature people feel. It comes from 10:30 am overpasses on clear days only.
- The MCAP values are digitised from a 534 × 131 px chart image (±0.1 °C reading precision).
