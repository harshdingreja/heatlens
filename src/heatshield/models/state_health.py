"""Layer 2: a simple, explainable model on REAL Indian heat-death data.

Question: do states that had more dangerously hot-and-humid days in a year
also report more heat/sun-stroke deaths that year?

Data (one row = one state/UT in one year, 2017-2022):
  - deaths: NCRB "Accidental Deaths & Suicides in India", heat/sun-stroke
    deaths, as tabled in Parliament (see ingest/health.py)
  - danger_days: days whose max heat index at the state capital was >= 39.4 °C
    (NOAA "Danger"), from ERA5 hourly temperature + humidity
  - population: Census 2011 (offset, so we model deaths PER PERSON)

Why Poisson regression? Deaths are COUNTS: whole numbers, never negative,
often 0, and their spread grows with their size. Linear regression assumes a
continuous, symmetric outcome and can predict negative deaths. Poisson
regression models log(expected deaths) = b0 + b1*danger_days + log(population),
so exp(b1) is a rate ratio: "each extra danger day multiplies the expected
death rate by exp(b1)".

Poisson assumes variance = mean. Real data is usually "overdispersed"
(variance >> mean). We test that with Pearson chi2 / degrees of freedom
(≈1 is fine, >>1 is overdispersed) and compare with a Negative Binomial model,
which allows extra variance.

Honest caveats: ~200 rows, official heat deaths are known undercounts, and
reporting differs a lot between states. This layer is a sanity check on
Layer 1, not a predictor.

Run:   python -m heatshield.models.state_health
"""
from __future__ import annotations

import json
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf

from heatshield.config import ARTIFACTS, DATA_RAW, FIGURES
from heatshield.ingest.health import POPULATION_NAME_MAP

HEALTH_DIR = DATA_RAW / "health"
RESULTS_PATH = ARTIFACTS / "state_health_results.json"
MORTALITY_CONFIG = ARTIFACTS / "mortality_config.json"


def build_panel() -> pd.DataFrame:
    deaths = pd.read_csv(HEALTH_DIR / "ncrb_heat_deaths_2017_2022.csv")
    heat = pd.read_csv(HEALTH_DIR / "state_heat_days_2017_2022.csv")
    pop = pd.read_csv(HEALTH_DIR / "state_population_census2011.csv")
    deaths["pop_name"] = deaths["state"].map(lambda s: POPULATION_NAME_MAP.get(s, s))
    panel = (deaths.merge(heat[["state", "year", "capital", "danger_days", "extreme_caution_days", "mean_daily_max_hi"]],
                          on=["state", "year"], how="left")
                   .merge(pop.rename(columns={"state": "pop_name"}), on="pop_name", how="left"))
    missing = panel[panel[["danger_days", "population_2011"]].isna().any(axis=1)]
    assert missing.empty, f"Unmatched rows:\n{missing[['state', 'year']]}"
    panel = panel.dropna(subset=["deaths"])           # Ladakh 2017-2019 is '-' (UT created in 2019)
    panel["deaths"] = panel["deaths"].astype(int)
    panel["log_pop"] = np.log(panel["population_2011"])
    panel["deaths_per_million"] = panel["deaths"] / panel["population_2011"] * 1e6
    return panel.reset_index(drop=True)


def _irr(result, term: str, per: float = 10) -> dict:
    """Rate ratio for +`per` units of `term`, with 95 % CI."""
    b, se = result.params[term], result.bse[term]
    return {"per": per, "irr": round(float(np.exp(per * b)), 3),
            "ci": [round(float(np.exp(per * (b - 1.96 * se))), 3), round(float(np.exp(per * (b + 1.96 * se))), 3)],
            "coef": round(float(b), 5), "se": round(float(se), 5), "p_value": float(f"{result.pvalues[term]:.3g}")}


def fit(panel: pd.DataFrame) -> dict:
    out = {}
    specs = {
        "poisson_danger": "deaths ~ danger_days",
        "poisson_danger_year": "deaths ~ danger_days + C(year)",
        "poisson_caution_year": "deaths ~ extreme_caution_days + C(year)",
    }
    for name, formula in specs.items():
        res = smf.glm(formula, data=panel, family=sm.families.Poisson(), offset=panel["log_pop"]).fit()
        term = formula.split("~")[1].split("+")[0].strip()
        out[name] = {
            "formula": formula + "  (offset = log Census-2011 population)",
            "n_rows": int(res.nobs),
            "rate_ratio_per_10_days": _irr(res, term),
            "pearson_dispersion": round(float(res.pearson_chi2 / res.df_resid), 2),
            "deviance_pseudo_r2": round(float(1 - res.deviance / res.null_deviance), 3),
            "aic": round(float(res.aic), 1),
        }

    # Negative Binomial: same mean model, but variance = mu + alpha*mu^2.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        nb = smf.negativebinomial("deaths ~ danger_days + C(year)", data=panel,
                                  offset=panel["log_pop"]).fit(disp=False, maxiter=200)
    out["negbin_danger_year"] = {
        "formula": "deaths ~ danger_days + C(year)  (offset = log population), NB2",
        "n_rows": int(nb.nobs),
        "rate_ratio_per_10_days": _irr(nb, "danger_days"),
        "alpha": round(float(nb.params["alpha"]), 3),
        "mcfadden_pseudo_r2": round(float(nb.prsquared), 3),
        "aic": round(float(nb.aic), 1),
    }
    return out


def layer1_sanity(panel: pd.DataFrame) -> dict:
    """Order-of-magnitude comparison between the paper (Layer 1) and NCRB counts."""
    mh = panel[panel["state"] == "Maharashtra"]
    cfg = json.loads(MORTALITY_CONFIG.read_text()) if MORTALITY_CONFIG.exists() else None
    out = {
        "maharashtra_ncrb_heatstroke_deaths_per_year_2017_2022_mean": round(float(mh["deaths"].mean()), 1),
        "maharashtra_ncrb_by_year": dict(zip(mh["year"].astype(str), mh["deaths"].astype(int))),
        "maharashtra_population_2011": int(mh["population_2011"].iloc[0]),
    }
    if cfg:
        paper = cfg["paper"]["mumbai_attributable_deaths_per_year_main_def"]
        mumbai_pop = 13_014_390  # MCGM mid-year estimate 2023 (same MCGM page as the baseline deaths)
        out["paper_mumbai_attributable_deaths_per_year"] = paper
        out["mumbai_population_mcgm_2023"] = mumbai_pop
        # Compare per million people, because Mumbai is only part of Maharashtra.
        out["paper_mumbai_per_million_per_year"] = round(paper["value"] / mumbai_pop * 1e6, 2)
        out["ncrb_maharashtra_per_million_per_year"] = round(
            out["maharashtra_ncrb_heatstroke_deaths_per_year_2017_2022_mean"] / out["maharashtra_population_2011"] * 1e6, 2)
        out["per_capita_ratio_paper_vs_ncrb"] = round(
            out["paper_mumbai_per_million_per_year"] / out["ncrb_maharashtra_per_million_per_year"], 1)
        out["note"] = ("Not like-for-like: the paper counts ALL-CAUSE excess deaths during heatwaves (incl. heart "
                       "and lung deaths, 2009-2015); NCRB counts deaths certified as heat/sun-stroke (2017-2022). "
                       "Populations are from different years (MCGM 2023 estimate vs Census 2011).")
    return out


def plot(panel: pd.DataFrame, results: dict) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(7, 4.2))
    sc = ax.scatter(panel["danger_days"], panel["deaths_per_million"], c=panel["year"], cmap="viridis", s=18, alpha=0.8)
    for _, r in panel[panel["deaths_per_million"] > 6].iterrows():
        ax.annotate(f"{r.state} {r.year}", (r.danger_days, r.deaths_per_million), fontsize=6, alpha=0.7)
    ax.set_xlabel("days with max heat index ≥ 39.4 °C at the state capital (ERA5)")
    ax.set_ylabel("NCRB heat/sun-stroke deaths per million")
    irr = results["negbin_danger_year"]["rate_ratio_per_10_days"]
    ax.set_title(f"States 2017-2022 (n={len(panel)}): Negative Binomial rate ratio per +10 danger days = "
                 f"{irr['irr']} ({irr['ci'][0]}-{irr['ci'][1]})", fontsize=8)
    fig.colorbar(sc, label="year")
    fig.tight_layout()
    FIGURES.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIGURES / "health_state_poisson.png", dpi=130)
    plt.close(fig)


def summary_text(results: dict, sanity: dict) -> str:
    p = results["poisson_danger_year"]
    nb = results["negbin_danger_year"]
    r = p["rate_ratio_per_10_days"]
    s = (f"State check (NCRB heat/sun-stroke deaths 2017-2022, {p['n_rows']} state-years): Poisson rate ratio per "
         f"+10 'Danger' heat-index days = {r['irr']} (95% CI {r['ci'][0]}-{r['ci'][1]}), but the data are strongly "
         f"overdispersed (Pearson dispersion {p['pearson_dispersion']}); the Negative Binomial model gives "
         f"{nb['rate_ratio_per_10_days']['irr']} ({nb['rate_ratio_per_10_days']['ci'][0]}-"
         f"{nb['rate_ratio_per_10_days']['ci'][1]}).")
    if "paper_mumbai_attributable_deaths_per_year" in sanity:
        s += (f" Sanity check: the paper attributes ~{sanity['paper_mumbai_attributable_deaths_per_year']['value']} "
              f"deaths/yr to heatwaves in Mumbai ({sanity['paper_mumbai_per_million_per_year']} per million), "
              f"~{sanity['per_capita_ratio_paper_vs_ncrb']}x the per-capita rate of certified heat/sun-stroke deaths "
              f"in Maharashtra ({sanity['ncrb_maharashtra_per_million_per_year']} per million). That gap is expected "
              "(all-cause excess vs certified heatstroke, plus undercounting), so Layer 2 does not contradict Layer 1; "
              "it confirms that hotter state-years report more heat deaths.")
    return s


def run() -> dict:
    panel = build_panel()
    panel.to_csv(HEALTH_DIR / "state_panel_2017_2022.csv", index=False)
    results = fit(panel)
    sanity = layer1_sanity(panel)
    payload = {
        "summary": summary_text(results, sanity),
        "data": {
            "n_rows": int(len(panel)), "n_states": int(panel["state"].nunique()),
            "years": [int(panel["year"].min()), int(panel["year"].max())],
            "total_deaths": int(panel["deaths"].sum()),
            "share_of_rows_with_zero_deaths": round(float((panel["deaths"] == 0).mean()), 3),
            "outcome_source": "NCRB ADSI heat/sun-stroke deaths via Parliament answers (PIB 2023 annexure; PIB Release 2158403, 20 Aug 2025)",
            "exposure_source": "ERA5 hourly T + RH at each state/UT capital (Open-Meteo archive, models=era5), NOAA heat index",
            "population_source": "Census 2011 (Wikipedia 'List of states and union territories of India by population', 2011 Census column)",
        },
        "models": results,
        "layer1_sanity_check": sanity,
        "caveats": [
            "Official heat deaths are known undercounts; reporting completeness differs between states.",
            "One capital per state is a crude exposure measure for a whole state.",
            "Population is fixed at Census 2011 (no newer official census); year effects absorb national trends.",
            "Small sample (~200 rows): use as a sanity check, not as a predictor.",
        ],
    }
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(payload, indent=2))
    plot(panel, results)
    return payload


if __name__ == "__main__":
    out = run()
    print(out["summary"])
    print(json.dumps(out["models"], indent=1))
    print(json.dumps(out["layer1_sanity_check"], indent=1))
