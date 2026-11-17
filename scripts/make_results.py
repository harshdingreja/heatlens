"""Write RESULTS.md from the saved result files in artifacts/.

Nothing in RESULTS.md is typed by hand: every number is read from a JSON/CSV
that a training or analysis script produced. Re-run after retraining:
    python scripts/make_results.py
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
A = ROOT / "artifacts"


def load(name):
    p = A / name
    return json.loads(p.read_text()) if p.exists() else None


def fmt(x, nd=2):
    return "–" if x is None else f"{x:.{nd}f}"


def corrector_section(c: dict) -> list[str]:
    s = c["santacruz"]
    m = pd.DataFrame(s["metrics"])
    names = {"A_raw_forecast": f"A · Raw forecast ({s['primary_raw_model']})", "B_persistence": "B · Persistence",
             "C_climatology": "C · Climatology", "D_multimodel_mean": "D · 4-model mean",
             "linear_regression": "Linear regression", "lightgbm": "LightGBM",
             "linear_plus_lightgbm": "Linear + LightGBM (stack)"}
    final = s["final_method"]
    out = ["## 1. Forecast corrector (Santacruz, main result)", "",
           f"- Target: observed daily max heat index at Santacruz (GHCNh). Train {s['train_period'][0]} → {s['train_period'][1]} "
           f"({s['n_train_rows']} rows), test {s['test_period'][0]} → {s['test_period'][1]} ({s['n_test_rows']} rows). Time-based split, no shuffling.",
           f"- Raw model chosen on TRAINING MAE only: {s['raw_model_train_mae_all_leads']}",
           f"- Final model chosen by rolling validation inside 2025 (mean MAE): "
           + ", ".join(f"{k} {v['mean_mae']}" for k, v in s["validation_mae"].items()) + f" → **{final}**", "",
           "### MAE (°C) on the 2026 test period, by lead time", "",
           "| Method | 1 d | 2 d | 3 d | 4 d | 5 d | All |", "|---|---|---|---|---|---|---|"]
    for method, label in names.items():
        row = m[m.method == method].set_index("lead")["mae"]
        bold = "**" if method == final else ""
        out.append(f"| {bold}{label}{bold} | " + " | ".join(fmt(row.get(k)) for k in [1, 2, 3, 4, 5, "all"]) + " |")
    out += ["", "### RMSE (°C), all leads", "", "| Method | RMSE | Bias (pred − obs) |", "|---|---|---|"]
    for method, label in names.items():
        r = m[(m.method == method) & (m.lead == "all")].iloc[0]
        out.append(f"| {label} | {fmt(r.rmse)} | {fmt(r.bias)} |")
    raw = m[(m.method == "A_raw_forecast") & (m.lead == "all")].mae.iloc[0]
    fin = m[(m.method == final) & (m.lead == "all")].mae.iloc[0]
    out += ["", f"**Headline:** MAE {raw:.2f} °C (raw) → {fin:.2f} °C (corrected), a {100 * (raw - fin) / raw:.0f} % reduction.", ""]

    a = s["alerts_danger_or_worse"]
    out += ["### Alerts: 'Danger or worse' (heat index ≥ 39.4 °C) on test days", "",
            f"Observed Danger-or-worse days: {a['observed_danger_days']} of {a['n']} (rows = day × lead).", "",
            "| Method | Precision | Recall | F1 |", "|---|---|---|---|"]
    for method, label in names.items():
        x = a[method]
        out.append(f"| {label} | {fmt(x['precision'])} | {fmt(x['recall'])} | {fmt(x['f1'])} |")
    out += ["", "Confusion matrices: `docs/figures/confusion_raw.png`, `docs/figures/confusion_corrected.png`.", "",
            "### Explainability", "",
            "Top SHAP features (stand-alone LightGBM, mean |SHAP| °C): "
            + ", ".join(f"{k} {v}" for k, v in list(s["shap_mean_abs_lightgbm"].items())[:5]),
            "", "Largest standardised linear coefficients: "
            + ", ".join(f"{k} {v}" for k, v in list(s["linear_coefficients_standardised"].items())[:5]), ""]

    col = c["colaba_secondary"]
    cm = pd.DataFrame(col["metrics"])
    cr = cm[(cm.method == "A_raw_forecast") & (cm.lead == "all")].mae.iloc[0]
    cf = cm[(cm.method == col["final_method"]) & (cm.lead == "all")].mae.iloc[0]
    out += ["### Secondary station: Colaba (synoptic reports only)", "",
            f"Same pipeline, final model {col['final_method']}: MAE {cr:.2f} °C (raw {col['primary_raw_model']}) → {cf:.2f} °C on {col['n_test_rows']} test rows.", ""]
    return out


def anomaly_section(an: dict) -> list[str]:
    t = an["test_2026"]
    return ["## 2. Anomaly detection (Santacruz, 2026)", "",
            f"- z-score ≥ {an['z_threshold']} vs the 1991–2020 normal: **{t['z_anomalies']}** of {t['days']} valid days flagged.",
            f"- IsolationForest (hot side, features {an['isolation_forest']['features']}): **{t['if_hot_anomalies']}** days.",
            f"- Flagged by both: {t['both']} (Jaccard {t['jaccard']}, Cohen's κ {t['cohen_kappa']}).",
            f"- z-anomaly days per year: {an['all_years_z_anomalies_per_year']}", ""]


def wards_section(v: dict) -> list[str]:
    k = v["kmeans"]
    mc = v["mcap_crosscheck"]
    out = ["## 3. Ward vulnerability (Layer 3)", "",
           f"- Wards: {v['n_wards']}. {v['ward_count_note']}",
           f"- HVI equal vs PCA weights: Spearman ρ = {v['hvi']['spearman_equal_vs_pca']['rho']} → used: {v['hvi']['hvi_method']}.",
           f"- PCA: first two components explain {sum(v['hvi']['pca']['explained_variance_ratio'][:2]):.1%} of variance.",
           f"- K-means: chosen k = {k['chosen_k']} (silhouette {k['chosen_k_silhouette']}); rule: {k['rule']}.",
           "", "| k | Inertia | Silhouette |", "|---|---|---|"]
    out += [f"| {r['k']} | {r['inertia']} | {r['silhouette']} |" for r in k["scan"]]
    out += ["", f"- Cluster sizes: {k.get('cluster_sizes')}",
            f"- MCAP cross-check ({mc['reference']}): {mc['note']}"]
    for key, val in mc.items():
        if isinstance(val, dict) and "spearman_rho" in val:
            out.append(f"  - {key}: Spearman ρ = {val['spearman_rho']} (p = {val['spearman_p']}), n = {val['n']}")
    out += [f"- Top 5 most vulnerable wards: " + ", ".join(f"{w['ward_id']} ({w['hvi']})" for w in v["top5_most_vulnerable"]), ""]
    return out


def health_section(mort: dict | None, state: dict | None) -> list[str]:
    out = ["## 4. Health layers", ""]
    if mort:
        out += ["### Layer 1: paper-based extra deaths", "", "```json", json.dumps(
            {k: mort[k] for k in ("citation", "main_definition", "baseline", "thresholds") if k in mort},
            indent=1, ensure_ascii=False)[:3000], "```", ""]
    if state:
        out += ["### Layer 2: state-level Poisson model", "", state.get("summary", ""), "", "```json",
                json.dumps({k: v for k, v in state.items() if k != "summary"}, indent=1, ensure_ascii=False)[:3000], "```", ""]
    return out


def main() -> None:
    lines = ["# HeatShield: Results", "",
             f"_Generated by `scripts/make_results.py` on {date.today().isoformat()} from the files in `artifacts/`. "
             "No number here is typed by hand._", ""]
    c = load("corrector_metrics.json")
    if c:
        lines += corrector_section(c)
    an = load("anomaly_results.json")
    if an:
        lines += anomaly_section(an)
    v = load("vulnerability_summary.json")
    if v:
        lines += wards_section(v)
    lines += health_section(load("mortality_config.json"), load("state_health_results.json"))
    (ROOT / "RESULTS.md").write_text("\n".join(lines) + "\n")
    print("wrote RESULTS.md")


if __name__ == "__main__":
    main()
