"""Layer 1 tests. They use a small hand-made config, so they run in milliseconds
and don't need any downloaded data."""
import pandas as pd
import pytest

from heatshield.models.mortality_risk import estimate_extra_deaths, heatwave_flags

BASELINE = 255.49


def make_config():
    table = [{"percentile": p, "consecutive_days": n, "pct_increase": 3.4, "ci_low": 0.8, "ci_high": 6.1,
              "ci_excludes_zero": True} for p in (95, 97, 99) for n in (1, 2, 3, 5)]
    pooled = [{**r, "pct_increase": 14.7, "ci_low": 10.3, "ci_high": 19.3} for r in table]
    bias = {str(lead): {"bias_c": -0.7, "n_days": 600} for lead in range(1, 6)}
    return {
        "baseline": {"daily_deaths": BASELINE, "source": "test"},
        "paper": {"rr_tables": {"mumbai": table, "pooled_10_cities": pooled}},
        "thresholds": {"tmean_c": {"p95": 31.3, "p97": 31.6, "p99": 32.3}},
        "main_definition": {"text": "2 days > P97"},
        "forecast_bias_removed": {"models": {"icon_global": bias}},
    }


def make_daily(observed, forecast):
    temps = observed + forecast
    return pd.DataFrame({
        "date": pd.date_range("2026-05-01", periods=len(temps), freq="D"),
        "tmean_c": temps,
        "tmax_c": [t + 4 for t in temps],
        "is_forecast": [False] * len(observed) + [True] * len(forecast),
    })


def test_no_heatwave_means_zero_extra_deaths():
    out = estimate_extra_deaths(make_daily([28, 28, 28], [28, 28, 28, 28, 28]), config=make_config())
    assert len(out["days"]) == 5                      # only forecast days are returned
    assert all(d["extra_deaths"] == 0.0 and d["relative_risk"] is None for d in out["days"])


def test_heatwave_uses_baseline_times_rr_minus_one():
    # forecast 31.0 raw -> 31.7 after removing ICON's -0.7 bias -> above P97 (31.6) for 2+ days
    out = estimate_extra_deaths(make_daily([28, 28], [31.0, 31.0, 31.0, 28, 28]), config=make_config())
    hw = [d for d in out["days"] if d["heatwave"]]
    assert len(hw) == 3
    assert hw[0]["extra_deaths"] == pytest.approx(round(BASELINE * 0.034, 1))
    lo, hi = hw[0]["extra_deaths_ci"]
    assert lo <= hw[0]["extra_deaths"] <= hi        # CI must contain the estimate
    assert hw[0]["rr_ci"][0] <= hw[0]["relative_risk"] <= hw[0]["rr_ci"][1]


def test_single_hot_day_is_not_a_two_day_heatwave():
    out = estimate_extra_deaths(make_daily([28, 28], [31.0, 28, 28, 28, 28]), config=make_config())
    assert not any(d["heatwave"] for d in out["days"])


def test_observed_days_count_towards_a_run():
    # last observed day is hot (station space, no bias shift), first forecast day hot -> 2-day run
    out = estimate_extra_deaths(make_daily([28, 32.0], [31.0, 28, 28, 28, 28]), config=make_config())
    assert out["days"][0]["heatwave"] is True


def test_gap_in_dates_breaks_a_run():
    s = pd.Series([32.0, 32.0], index=pd.to_datetime(["2026-05-01", "2026-05-03"]))
    assert not heatwave_flags(s, 31.6, 2).any()
