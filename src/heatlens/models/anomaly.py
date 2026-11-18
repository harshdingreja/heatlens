"""Anomaly detection: is a day abnormally hot FOR THAT DATE?

36 °C heat index is normal in May but very unusual in January. So we compare
each day with the 1991-2020 "normal" for its calendar day.

Method 1 (statistics): z-score
    z = (heat index - normal for that date) / typical spread for that date
    z >= 2 -> "abnormally hot" (roughly the hottest 2-3 % of days for that date).
Method 2 (machine learning): IsolationForest
    Learns what normal (departure today, departure over the last 3 days) pairs
    look like, and flags points that are easy to isolate (= rare). It catches
    persistent heat (several warm days in a row) that a single-day z-score can
    miss. We only keep its outliers on the HOT side (departure > 0).

Run:  python -m heatlens.models.anomaly
"""
from __future__ import annotations

import json

import joblib
import matplotlib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import cohen_kappa_score

from heatlens.config import ARTIFACTS, DATA_PROCESSED, FIGURES
from heatlens.models.corrector import load_tables, station_normal

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

Z_THRESHOLD = 2.0
IF_FEATURES = ["hi_dep", "hi_dep_3d"]


def add_departures(df: pd.DataFrame, station: str, clim, offs, hi_col: str = "hi_max") -> pd.DataFrame:
    """Adds normal, std, departure, z-score and the 3-day mean departure. Needs consecutive dates."""
    df = df.sort_values("date").copy()
    df["normal_hi"], df["normal_std"] = station_normal(df["date"], station, clim, offs)
    df["hi_dep"] = df[hi_col] - df["normal_hi"]
    df["z"] = df["hi_dep"] / df["normal_std"]
    s = df.set_index("date")["hi_dep"]
    s = s.reindex(pd.date_range(s.index.min(), s.index.max(), freq="D"))
    df["hi_dep_3d"] = df["date"].map(s.rolling(3, min_periods=2).mean())
    return df


def flag(df: pd.DataFrame, forest: IsolationForest) -> pd.DataFrame:
    df = df.copy()
    df["is_anomaly"] = df["z"] >= Z_THRESHOLD
    ok = df[IF_FEATURES].notna().all(axis=1)
    df["if_anomaly"] = False
    if ok.any():
        outlier = forest.predict(df.loc[ok, IF_FEATURES]) == -1     # -1 means "outlier"
        df.loc[ok, "if_anomaly"] = outlier & (df.loc[ok, "hi_dep"] > 0).to_numpy()
    return df


def main() -> None:
    obs, _, clim, offs = load_tables()
    o = obs[(obs["station"] == "santacruz") & obs["valid"]][["date", "hi_max", "tmax", "rh_at_tmax"]]
    days = add_departures(o, "santacruz", clim, offs)

    train = days[days["date"] < "2026-01-01"].dropna(subset=IF_FEATURES)
    # Let IsolationForest flag about as many days as the z-score rule does in training,
    # so the two methods are compared at the same "budget" of alerts.
    hot_rate = float((train["z"] >= Z_THRESHOLD).mean())
    contamination = min(max(2 * hot_rate, 0.01), 0.1)   # x2: forest outliers include cold ones we drop
    forest = IsolationForest(n_estimators=300, contamination=contamination, random_state=42)
    forest.fit(train[IF_FEATURES])

    days = flag(days, forest)
    test = days[days["date"] >= "2026-01-01"]
    both = lambda d: int((d["is_anomaly"] & d["if_anomaly"]).sum())  # noqa: E731
    either = lambda d: int((d["is_anomaly"] | d["if_anomaly"]).sum())  # noqa: E731
    results = {
        "station": "santacruz", "z_threshold": Z_THRESHOLD,
        "normal": "ERA5 1991-2020 daily max heat index, +/-15-day window, shifted to station level by monthly offset",
        "isolation_forest": {"features": IF_FEATURES, "contamination": round(contamination, 4),
                             "trained_on": "valid Santacruz days 2021-2025"},
        "train_share_z_ge_2": round(hot_rate, 4),
        "test_2026": {
            "days": int(len(test)), "z_anomalies": int(test["is_anomaly"].sum()),
            "if_hot_anomalies": int(test["if_anomaly"].sum()), "both": both(test),
            "jaccard": round(both(test) / either(test), 3) if either(test) else None,
            "cohen_kappa": round(float(cohen_kappa_score(test["is_anomaly"], test["if_anomaly"])), 3),
            "z_anomaly_dates": test.loc[test["is_anomaly"], "date"].dt.date.astype(str).tolist(),
        },
        "all_years_z_anomalies_per_year": days.groupby(days["date"].dt.year)["is_anomaly"].sum().astype(int).to_dict(),
    }
    joblib.dump(forest, ARTIFACTS / "isolation_forest.joblib")
    (ARTIFACTS / "anomaly_results.json").write_text(json.dumps(results, indent=2, default=str))
    days.to_parquet(DATA_PROCESSED / "obs_anomalies.parquet", index=False)
    # Small 2026 series for the dashboard's anomaly chart (the API can't read data/).
    test[["date", "hi_max", "normal_hi", "z", "is_anomaly", "if_anomaly"]].round(2).to_csv(
        ARTIFACTS / "anomalies_2026.csv", index=False)
    # Full 2021-2026 daily history for the dashboard's heat calendar.
    cal = days[["date", "hi_max", "tmax", "rh_at_tmax", "normal_hi", "z", "is_anomaly", "if_anomaly"]].round(2)
    cal.assign(date=cal["date"].dt.date.astype(str)).to_csv(ARTIFACTS / "heat_calendar_santacruz.csv", index=False)

    fig, ax = plt.subplots(figsize=(10, 3.6))
    ax.plot(test["date"], test["hi_max"], color="black", lw=1, label="Observed daily max heat index")
    ax.plot(test["date"], test["normal_hi"], color="gray", ls="--", lw=1, label="1991-2020 normal (station level)")
    ax.scatter(test.loc[test.is_anomaly, "date"], test.loc[test.is_anomaly, "hi_max"], color="red", s=22, label="z >= 2", zorder=3)
    ax.scatter(test.loc[test.if_anomaly, "date"], test.loc[test.if_anomaly, "hi_max"], facecolors="none",
               edgecolors="purple", s=60, label="IsolationForest (hot side)", zorder=4)
    ax.set_ylabel("°C"); ax.set_title("Santacruz 2026: abnormally hot days for the date"); ax.legend(fontsize=8, ncol=2)
    fig.tight_layout(); fig.savefig(FIGURES / "anomalies_2026.png", dpi=130); plt.close(fig)
    print(json.dumps({k: v for k, v in results["test_2026"].items() if k != "z_anomaly_dates"}, indent=1))
    print("z-anomaly dates 2026:", results["test_2026"]["z_anomaly_dates"])
    print("per year:", results["all_years_z_anomalies_per_year"])


if __name__ == "__main__":
    main()
