"""Forecast corrector: learn the weather model's typical error and fix it.

Question it answers: "The model says tomorrow's max heat index at Santacruz is
38 °C. What will the station actually measure?"

Pipeline
1. One row per (forecast lead time 1..5 days, valid date).
2. Target = OBSERVED daily max heat index at the station.
3. Features = what was known when the forecast was issued: the 4 models'
   forecasts, the lead time, the season, the climate normal, recent observations,
   and the forecast's recent error.
4. Baselines: A raw forecast, B persistence, C climatology (+ the 4-model mean).
5. Models: linear regression, then LightGBM. Both learn the RESIDUAL
   (observed - raw forecast); final prediction = raw forecast + predicted residual.
6. Time-based split: train 24 Jan 2024 - 31 Dec 2025, test 1 Jan 2026 - latest.

Run:  python -m heatlens.models.corrector
"""
from __future__ import annotations

import json

import joblib
import lightgbm as lgb
import matplotlib
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from heatlens.config import ARTIFACTS, DATA_PROCESSED, FIGURES, FORECAST_MODELS
from heatlens.features.daily import calendar_day
from heatlens.ingest.stations import load_stations
from heatlens.models.alerts import DANGER_THRESHOLD_C, NOAA_KEYS, noaa_level

matplotlib.use("Agg")  # draw plots to files, no window
import matplotlib.pyplot as plt  # noqa: E402

MODELS = list(FORECAST_MODELS)
FC_VARS = ["hi_max", "tmax", "rh_at_tmax", "wind_mean", "sw_max"]
TRAIN_START = pd.Timestamp("2024-01-24")   # first day all archived models have full data
TRAIN_END = pd.Timestamp("2025-12-31")
TEST_START = pd.Timestamp("2026-01-01")
SEED = 42


# ------------------------------------------------------------ metrics ---
# HARSH: explain this
def mae(y_true, y_pred) -> float:
    """Mean Absolute Error: on average, how many °C the prediction is off."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    assert y_true.shape == y_pred.shape, "need one prediction per observation"
    errors = np.abs(y_true - y_pred)     # size of each miss, ignoring direction
    return float(errors.mean())          # average miss


def rmse(y_true, y_pred) -> float:
    """Root Mean Squared Error: like MAE but punishes big misses more."""
    diff = np.asarray(y_true, dtype=float) - np.asarray(y_pred, dtype=float)
    return float(np.sqrt(np.mean(diff**2)))


def bias(y_true, y_pred) -> float:
    """Mean of (prediction - truth). Positive = forecast too hot on average."""
    return float(np.mean(np.asarray(y_pred, dtype=float) - np.asarray(y_true, dtype=float)))


# -------------------------------------------------------------- split ---
# HARSH: explain this
def time_split(df: pd.DataFrame, date_col: str = "date",
               train_start=TRAIN_START, train_end=TRAIN_END, test_start=TEST_START):
    """Split by DATE, never randomly.

    A random split would put days from 2026 into training and days from 2025
    into testing, so the model would "see the future" and look better than it
    really is. Forecasting must be judged on days that come after training.
    """
    df = df.sort_values(date_col)
    train = df[(df[date_col] >= train_start) & (df[date_col] <= train_end)]
    test = df[df[date_col] >= test_start]
    assert train[date_col].max() < test[date_col].min(), "train must end before test starts"
    return train.copy(), test.copy()


# ------------------------------------------------------------ dataset ---
def load_tables():
    obs = pd.read_parquet(DATA_PROCESSED / "obs_daily.parquet")
    fc = pd.read_parquet(DATA_PROCESSED / "fc_daily.parquet")
    clim = pd.read_parquet(DATA_PROCESSED / "climatology.parquet")
    offs = pd.read_parquet(DATA_PROCESSED / "station_offsets.parquet")
    return obs, fc, clim, offs


def station_normal(dates: pd.Series, station: str, clim: pd.DataFrame, offs: pd.DataFrame):
    """Climate-normal heat index for each date, shifted from ERA5 to station level."""
    dates = pd.to_datetime(pd.Series(dates)).reset_index(drop=True)
    c = clim.set_index("cday")
    cday = calendar_day(dates)
    off = offs[offs["station"] == station].set_index("month")["mean"]
    normal = c.loc[cday, "hi_normal_era5"].to_numpy() + dates.dt.month.map(off).to_numpy()
    std = c.loc[cday, "hi_std_era5"].to_numpy()
    return normal, std


def feature_columns() -> list[str]:
    cols = ["lead_days", "doy_sin", "doy_cos", "normal_hi", "obs_hi_last", "obs_hi_7d",
            "recent_bias_7d", "ens_hi_mean", "ens_hi_std"]
    for m in MODELS:
        for v in FC_VARS:
            if not (m == "jma_gsm" and v == "sw_max"):  # JMA archive has no solar radiation
                cols.append(f"{m}_{v}")
    return cols


def build_dataset(station: str, primary: str, obs, fc, clim, offs) -> pd.DataFrame:
    """One row per (lead, valid date) with features + target for one station."""
    f = fc[fc["station"] == station]
    wide = f.pivot_table(index=["lead_days", "date"], columns="model", values=FC_VARS)
    wide.columns = [f"{model}_{var}" for var, model in wide.columns]
    wide = wide.reset_index()
    hi_cols = [f"{m}_hi_max" for m in MODELS]
    wide["ens_hi_mean"] = wide[hi_cols].mean(axis=1)   # simple multi-model average
    wide["ens_hi_std"] = wide[hi_cols].std(axis=1)     # do the models disagree?
    wide["raw_hi"] = wide[f"{primary}_hi_max"]

    # Observed daily max heat index as a daily series (bad days -> NaN).
    o = obs[obs["station"] == station].set_index("date")
    obs_hi = o["hi_max"].where(o["valid"])
    obs_hi = obs_hi.reindex(pd.date_range(obs_hi.index.min(), wide["date"].max(), freq="D"))
    wide["target"] = wide["date"].map(obs_hi)

    # What was known when the forecast was made? A lead-L forecast for day V was
    # issued on day V-L; the last COMPLETE observed day at that time is V-L-1.
    issue = wide["date"] - pd.to_timedelta(wide["lead_days"], unit="D")
    last_obs_day = issue - pd.Timedelta(days=1)
    wide["obs_hi_last"] = last_obs_day.map(obs_hi)
    wide["obs_hi_7d"] = last_obs_day.map(obs_hi.rolling(7, min_periods=4).mean())

    # Recent error of the primary model at the same lead (a running bias estimate).
    wide["recent_bias_7d"] = np.nan
    for lead in range(1, 6):
        rows = wide["lead_days"] == lead
        raw = wide.loc[rows].set_index("date")["raw_hi"].reindex(obs_hi.index)
        err7 = (obs_hi - raw).rolling(7, min_periods=3).mean()
        wide.loc[rows, "recent_bias_7d"] = last_obs_day[rows].map(err7).to_numpy()

    cday = calendar_day(wide["date"])
    wide["doy_sin"] = np.sin(2 * np.pi * cday / 365)   # season as a circle, so
    wide["doy_cos"] = np.cos(2 * np.pi * cday / 365)   # 31 Dec sits next to 1 Jan
    wide["normal_hi"], wide["normal_std"] = station_normal(wide["date"], station, clim, offs)
    wide["station"] = station
    return wide


def choose_primary(station: str, obs, fc) -> tuple[str, dict]:
    """Pick the raw model with the lowest heat-index MAE on the TRAINING period only.

    Choosing on the test period would leak test information into a design choice.
    """
    o = obs[(obs["station"] == station) & obs["valid"]][["date", "hi_max"]]
    f = fc[(fc["station"] == station) & fc["date"].between(TRAIN_START, TRAIN_END)]
    both = f.merge(o, on="date", suffixes=("_fc", "_obs"))
    common = both.groupby(["lead_days", "date"])["model"].transform("nunique") == len(MODELS)
    both = both[common]                                   # same days for every model = fair
    scores = {m: mae(g["hi_max_obs"], g["hi_max_fc"]) for m, g in both.groupby("model")}
    return min(scores, key=scores.get), {k: round(v, 3) for k, v in scores.items()}


# ------------------------------------------------------------- models ---
def fit_linear(train: pd.DataFrame, features: list[str]):
    model = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LinearRegression())
    model.fit(train[features], train["target"] - train["raw_hi"])
    return model


STACK_PARAMS = dict(n_estimators=100, num_leaves=4, min_child_samples=80, learning_rate=0.03,
                    subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=SEED, verbose=-1)


class StackedCorrector:
    """Linear regression first, then a SMALL LightGBM on what the linear model still gets wrong.

    Why: the raw forecast's error drifts over time (+2.8 °C in training, larger in
    2026). Trees can't predict values outside what they saw in training, but a
    linear model can follow a trend (e.g. via recent_bias_7d). The small tree model
    then adds the non-linear leftovers (season x humidity effects).
    """
    def fit(self, df: pd.DataFrame, features: list[str]):
        self.features = features
        self.linear = fit_linear(df, features)
        linear_pred = df["raw_hi"] + self.linear.predict(df[features])
        self.trees = lgb.LGBMRegressor(**STACK_PARAMS)
        self.trees.fit(df[features], df["target"] - linear_pred)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Predicted RESIDUAL (add it to the raw forecast)."""
        return self.linear.predict(X[self.features]) + self.trees.predict(X[self.features])


# Rolling-origin validation INSIDE the training period: train on everything before
# each quarter of 2025, validate on that quarter. Used to choose the final model,
# so the 2026 test set is never used for any decision.
CV_FOLDS = [("2025-01-01", "2025-03-31"), ("2025-04-01", "2025-06-30"),
            ("2025-07-01", "2025-09-30"), ("2025-10-01", "2025-12-31")]


def rolling_validation(train: pd.DataFrame, features: list[str], fitters: dict) -> dict:
    scores = {}
    for name, fit in fitters.items():
        errs = []
        for start, end in CV_FOLDS:
            past = train[train["date"] < start]
            fold = train[(train["date"] >= start) & (train["date"] <= end)]
            model = fit(past, features)
            errs.append(mae(fold["target"], fold["raw_hi"] + model.predict(fold[features])))
        scores[name] = {"fold_mae": [round(e, 3) for e in errs], "mean_mae": round(float(np.mean(errs)), 3)}
    return scores


def fit_lightgbm(train: pd.DataFrame, features: list[str]):
    """LightGBM with early stopping on the LAST 20 % of the training period (by date)."""
    cut = train["date"].quantile(0.8)
    fit_part, val_part = train[train["date"] < cut], train[train["date"] >= cut]
    params = dict(n_estimators=3000, learning_rate=0.02, num_leaves=15, min_child_samples=30,
                  subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0,
                  random_state=SEED, verbose=-1)
    probe = lgb.LGBMRegressor(**params)
    probe.fit(fit_part[features], fit_part["target"] - fit_part["raw_hi"],
              eval_set=[(val_part[features], val_part["target"] - val_part["raw_hi"])],
              eval_metric="l1", callbacks=[lgb.early_stopping(100, verbose=False)])
    best_iter = int(probe.best_iteration_ or 200)
    final = lgb.LGBMRegressor(**{**params, "n_estimators": best_iter})
    final.fit(train[features], train["target"] - train["raw_hi"])   # refit on all training data
    return final, best_iter


# --------------------------------------------------------- evaluation ---
def evaluate(test: pd.DataFrame, preds: dict[str, np.ndarray]) -> pd.DataFrame:
    rows = []
    for lead in [*range(1, 6), "all"]:
        sel = np.ones(len(test), bool) if lead == "all" else (test["lead_days"] == lead).to_numpy()
        y = test.loc[sel, "target"]
        for name, p in preds.items():
            rows.append({"lead": lead, "method": name, "n": int(sel.sum()),
                         "mae": mae(y, p[sel]), "rmse": rmse(y, p[sel]), "bias": bias(y, p[sel])})
    return pd.DataFrame(rows)


def alert_scores(test: pd.DataFrame, preds: dict[str, np.ndarray]) -> dict:
    """Precision / recall / F1 for the event 'Danger or worse' (heat index >= 39.4 °C)."""
    truth = test["target"].to_numpy() >= DANGER_THRESHOLD_C
    out = {"observed_danger_days": int(truth.sum()), "n": int(len(truth))}
    for name, p in preds.items():
        pred = p >= DANGER_THRESHOLD_C
        out[name] = {"precision": float(precision_score(truth, pred, zero_division=0)),
                     "recall": float(recall_score(truth, pred, zero_division=0)),
                     "f1": float(f1_score(truth, pred, zero_division=0)),
                     "predicted_danger_days": int(pred.sum())}
    return out


def plot_confusion(test: pd.DataFrame, pred: np.ndarray, title: str, path) -> list[list[int]]:
    labels = list(range(5))
    cm = confusion_matrix(noaa_level(test["target"].to_numpy()), noaa_level(pred), labels=labels)
    fig, ax = plt.subplots(figsize=(5.5, 4.5))
    ax.imshow(cm, cmap="Oranges")
    names = ["None", "Caution", "Ext. Caution", "Danger", "Ext. Danger"]
    ax.set_xticks(labels, names, rotation=30, ha="right"); ax.set_yticks(labels, names)
    ax.set_xlabel("Predicted alert"); ax.set_ylabel("Observed alert"); ax.set_title(title)
    for i in labels:
        for j in labels:
            ax.text(j, i, cm[i, j], ha="center", va="center", fontsize=9)
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)
    return cm.tolist()


def shap_summary(model, X: pd.DataFrame, path) -> dict:
    import shap
    explainer = shap.TreeExplainer(model)
    values = explainer.shap_values(X)
    shap.summary_plot(values, X, show=False, max_display=15)
    plt.title("What drives the correction? (SHAP, test period)")
    plt.tight_layout(); plt.savefig(path, dpi=130); plt.close("all")
    importance = pd.Series(np.abs(values).mean(axis=0), index=X.columns).sort_values(ascending=False)
    return {k: round(float(v), 4) for k, v in importance.items()}


def plot_backtest(test: pd.DataFrame, pred: np.ndarray, lead: int, path) -> None:
    sel = (test["lead_days"] == lead).to_numpy()
    t = test[sel]
    fig, ax = plt.subplots(figsize=(10, 3.6))
    ax.plot(t["date"], t["target"], color="black", lw=1.4, label="Observed (Santacruz)")
    ax.plot(t["date"], t["raw_hi"], color="tab:blue", lw=1, alpha=0.8, label="Raw forecast")
    ax.plot(t["date"], pred[sel], color="tab:red", lw=1, label="Corrected (HeatLens)")
    ax.axhline(DANGER_THRESHOLD_C, color="orange", ls="--", lw=1, label="NOAA Danger 39.4 °C")
    ax.set_ylabel("Daily max heat index (°C)"); ax.set_title(f"2026 test period, lead {lead} day")
    ax.legend(ncol=4, fontsize=8, loc="lower left"); fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


# --------------------------------------------------------------- main ---
def run_station(station: str, save_models: bool) -> dict:
    obs, fc, clim, offs = load_tables()
    primary, model_scores = choose_primary(station, obs, fc)
    data = build_dataset(station, primary, obs, fc, clim, offs)
    features = feature_columns()

    train, test = time_split(data)
    train = train.dropna(subset=["target", "raw_hi"])
    # Every method is scored on exactly the same test rows.
    test = test.dropna(subset=["target", "raw_hi", "obs_hi_last", "normal_hi"])

    # 1) Choose the final model by rolling validation inside the training period.
    fitters = {
        "linear_regression": fit_linear,
        "lightgbm": lambda df, f: fit_lightgbm(df, f)[0],
        "linear_plus_lightgbm": lambda df, f: StackedCorrector().fit(df, f),
    }
    cv_scores = rolling_validation(train, features, fitters)
    final_method = min(cv_scores, key=lambda k: cv_scores[k]["mean_mae"])

    # 2) Refit every candidate on the full training period.
    linear = fit_linear(train, features)
    lgbm, best_iter = fit_lightgbm(train, features)
    stack = StackedCorrector().fit(train, features)
    fitted = {"linear_regression": linear, "lightgbm": lgbm, "linear_plus_lightgbm": stack}

    # 3) Score everything on the untouched 2026 test period.
    raw = test["raw_hi"].to_numpy()
    preds = {
        "A_raw_forecast": raw,
        "B_persistence": test["obs_hi_last"].to_numpy(),
        "C_climatology": test["normal_hi"].to_numpy(),
        "D_multimodel_mean": test["ens_hi_mean"].to_numpy(),
        **{name: raw + model.predict(test[features]) for name, model in fitted.items()},
    }
    metrics = evaluate(test, preds)
    result = {
        "station": station, "primary_raw_model": primary,
        "raw_model_train_mae_all_leads": model_scores,
        "train_period": [str(train["date"].min().date()), str(train["date"].max().date())],
        "test_period": [str(test["date"].min().date()), str(test["date"].max().date())],
        "n_train_rows": int(len(train)), "n_test_rows": int(len(test)),
        "validation_mae": cv_scores, "final_method": final_method,
        "lightgbm_best_iteration": best_iter,
        "metrics": metrics.round(4).to_dict(orient="records"),
        "alerts_danger_or_worse": alert_scores(test, preds),
    }

    if save_models:
        ARTIFACTS.mkdir(exist_ok=True); FIGURES.mkdir(parents=True, exist_ok=True)
        joblib.dump(fitted[final_method], ARTIFACTS / "corrector_final.joblib")
        lgbm.booster_.save_model(str(ARTIFACTS / "corrector_lgbm.txt"))
        final_pred = preds[final_method]
        result["confusion_matrix_final"] = plot_confusion(
            test, final_pred, f"Corrected ({final_method}), 2026", FIGURES / "confusion_corrected.png")
        result["confusion_matrix_raw"] = plot_confusion(
            test, raw, f"Raw {primary}, 2026", FIGURES / "confusion_raw.png")
        result["confusion_labels"] = NOAA_KEYS
        # SHAP for the stand-alone LightGBM corrector (spec) ...
        result["shap_mean_abs_lightgbm"] = shap_summary(lgbm, test[features], FIGURES / "shap_summary.png")
        # ... and for the tree part of the stack (what it adds on top of linear).
        result["shap_mean_abs_stack_trees"] = shap_summary(
            stack.trees, test[features], FIGURES / "shap_stack_trees.png")
        coefs = linear[-1].coef_                                  # standardised inputs -> comparable sizes
        result["linear_coefficients_standardised"] = dict(sorted(
            {f: round(float(c), 4) for f, c in zip(features, coefs)}.items(), key=lambda kv: -abs(kv[1])))
        plot_backtest(test, final_pred, 1, FIGURES / "backtest_lead1.png")
        back = test[["date", "lead_days", "target", "raw_hi"]].assign(
            corrected=final_pred, linear=preds["linear_regression"], lightgbm=preds["lightgbm"])
        back.round(2).to_csv(ARTIFACTS / "backtest_2026_santacruz.csv", index=False)
        meta = {"primary_raw_model": primary, "final_method": final_method, "features": features,
                "models": MODELS, "train_period": result["train_period"],
                "target": "observed daily max heat index (°C) at Santacruz, GHCNh",
                "prediction": "raw_hi + predicted residual"}
        (ARTIFACTS / "corrector_meta.json").write_text(json.dumps(meta, indent=2))
    return result


def main() -> None:
    results = {"santacruz": run_station("santacruz", save_models=True),
               "colaba_secondary": run_station("colaba", save_models=False)}
    # Climatology + station offsets are needed by the API at run time.
    _, _, clim, offs = load_tables()
    clim.round(4).to_csv(ARTIFACTS / "climatology.csv", index=False)
    offs.round(4).to_csv(ARTIFACTS / "station_offsets.csv", index=False)
    load_stations().to_csv(ARTIFACTS / "stations.csv", index=False)   # the API needs station coordinates
    (ARTIFACTS / "corrector_metrics.json").write_text(json.dumps(results, indent=2, default=str))

    for key, r in results.items():
        m = pd.DataFrame(r["metrics"])
        print(f"\n=== {key}: primary raw model = {r['primary_raw_model']} | train MAE by model {r['raw_model_train_mae_all_leads']}")
        print("validation (2025 quarters):", {k: v["mean_mae"] for k, v in r["validation_mae"].items()}, "-> final:", r["final_method"])
        print(f"train {r['train_period']} ({r['n_train_rows']} rows) | test {r['test_period']} ({r['n_test_rows']} rows)")
        print(m.pivot(index="method", columns="lead", values="mae").round(2).to_string())
        print("alerts:", json.dumps(r["alerts_danger_or_worse"], indent=None)[:600])


if __name__ == "__main__":
    # Call main() through the real module name so the saved StackedCorrector is
    # stored as heatlens.models.corrector.StackedCorrector (not __main__.…),
    # otherwise the API can't load the pickled model.
    from heatlens.models.corrector import main as module_main
    module_main()
