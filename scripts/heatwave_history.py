"""Real Mumbai heatwaves 2021-2026 (station data) + how the forecaster did in the 2026 ones.

Heatwave definition = the paper's main one (Layer 1): daily mean temperature above
Mumbai's 97th percentile for at least 2 consecutive days, at Santacruz (GHCNh).
Extra deaths are the Layer 1 ESTIMATE (paper's Mumbai relative risk x MCGM baseline),
not counted deaths: India publishes no daily death counts for Mumbai.

Run:  python scripts/heatwave_history.py   -> artifacts/heatwave_history.json
"""
from __future__ import annotations

import json

import pandas as pd

from heatlens.config import ARTIFACTS, DATA_PROCESSED

DANGER = 39.4


def main() -> None:
    m = json.loads((ARTIFACTS / "mortality_config.json").read_text())
    p97 = m["thresholds"]["tmean_c"]["p97"]
    base = m["baseline"]["daily_deaths"]
    rr = next(r for r in m["paper"]["rr_tables"]["mumbai"]
              if r["percentile"] == m["main_definition"]["percentile"]
              and r["consecutive_days"] == m["main_definition"]["consecutive_days"])

    obs = pd.read_parquet(DATA_PROCESSED / "obs_daily.parquet")
    s = obs[(obs["station"] == "santacruz") & (obs["n_obs"] >= 18)].set_index("date").sort_index()
    s = s.reindex(pd.date_range(s.index.min(), s.index.max()))   # gaps break a heatwave run
    hot = s["tmean"] > p97
    run_id = (hot != hot.shift()).cumsum()                       # new id whenever hot/not-hot flips

    back = pd.read_csv(ARTIFACTS / "backtest_2026_santacruz.csv", parse_dates=["date"])
    episodes = []
    for _, g in s[hot].groupby(run_id[hot]):
        if len(g) < m["main_definition"]["consecutive_days"]:
            continue
        ep = {"start": g.index[0].date().isoformat(), "end": g.index[-1].date().isoformat(), "days": len(g),
              "max_tmean_c": round(float(g["tmean"].max()), 1), "max_tmax_c": round(float(g["tmax"].max()), 1),
              "max_heat_index_c": round(float(g["hi_max"].max()), 1),
              "extra_deaths_est": round(len(g) * base * rr["pct_increase"] / 100),
              "extra_deaths_ci": [round(len(g) * base * rr["ci_low"] / 100), round(len(g) * base * rr["ci_high"] / 100)],
              "in_test_period": g.index[0].year >= 2026}
        if ep["in_test_period"]:                                   # forecast skill during this heatwave
            w = back[back["date"].between(g.index[0], g.index[-1])]
            skill = {}
            for lead in (1, 3, 5):
                x = w[w["lead_days"] == lead]
                danger = x["target"] >= DANGER
                skill[str(lead)] = {
                    "mae_raw": round(float((x["raw_hi"] - x["target"]).abs().mean()), 2),
                    "mae_heatlens": round(float((x["corrected"] - x["target"]).abs().mean()), 2),
                    "danger_days": int(danger.sum()),
                    "caught_raw": int((danger & (x["raw_hi"] >= DANGER)).sum()),
                    "caught_heatlens": int((danger & (x["corrected"] >= DANGER)).sum())}
            ep["forecast_skill"] = skill
            ep["daily_lead1"] = w[w["lead_days"] == 1][["date", "target", "raw_hi", "corrected"]].rename(
                columns={"target": "observed", "raw_hi": "raw"}).assign(
                date=lambda d: d["date"].dt.date.astype(str)).round(2).to_dict(orient="records")
        episodes.append(ep)

    out = {"definition": m["main_definition"]["text"], "p97_tmean_c": p97,
           "effect": {"pct_increase": rr["pct_increase"], "ci": [rr["ci_low"], rr["ci_high"]]},
           "baseline_daily_deaths": base,
           "note": "Extra deaths are an evidence-based estimate (paper relative risk x MCGM baseline), not counted deaths.",
           "episodes": episodes}
    (ARTIFACTS / "heatwave_history.json").write_text(json.dumps(out, indent=1))
    print(f"{len(episodes)} episodes, {sum(e['days'] for e in episodes)} heatwave days, "
          f"est. extra deaths {sum(e['extra_deaths_est'] for e in episodes)}")


if __name__ == "__main__":
    main()
