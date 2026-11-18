"""Tests for the core science + ML helpers: heat index, alerts, split, MAE."""
import numpy as np
import pandas as pd
import pytest

from heatlens.features.heat_indices import heat_index_c, wbgt_bom_c
from heatlens.models.alerts import imd_alert, noaa_alert, noaa_level
from heatlens.models.corrector import mae, rmse, time_split


def f_to_c(f):
    return (f - 32) * 5 / 9


# --- heat index: compare with NOAA's published heat index chart ---------
@pytest.mark.parametrize("temp_f, rh, chart_f", [(96, 65, 121), (90, 40, 91), (100, 50, 118), (86, 90, 105)])
def test_heat_index_matches_noaa_chart(temp_f, rh, chart_f):
    hi_f = heat_index_c(f_to_c(temp_f), rh) * 9 / 5 + 32
    assert abs(hi_f - chart_f) <= 1.5          # chart values are rounded


def test_heat_index_mumbai_example_from_spec():
    assert 46 <= heat_index_c(34, 70) <= 48    # "34 °C at 70 % feels like ~47 °C"


def test_heat_index_mild_weather_close_to_air_temp():
    assert abs(heat_index_c(22, 50) - 22) < 1.5


def test_heat_index_keeps_missing_values_missing():
    out = heat_index_c(pd.Series([30.0, np.nan]), pd.Series([60.0, 50.0]))
    assert not np.isnan(out[0]) and np.isnan(out[1])


def test_wbgt_increases_with_humidity():
    assert wbgt_bom_c(32, 80) > wbgt_bom_c(32, 40)


# --- alerts -------------------------------------------------------------
def test_noaa_bands():
    assert noaa_alert(25)["key"] == "green"
    assert noaa_alert(30)["key"] == "caution"
    assert noaa_alert(35)["key"] == "extreme_caution"
    assert noaa_alert(39.4)["key"] == "danger"
    assert noaa_alert(52)["key"] == "extreme_danger"
    assert list(noaa_level(np.array([20, 30, 35, 45, 60]))) == [0, 1, 2, 3, 4]


def test_imd_bands_and_gap_rule():
    assert imd_alert(34)["key"] == "green"
    assert imd_alert(35.5)["key"] == "green"   # published gap 35-36 -> lower band
    assert imd_alert(40)["key"] == "yellow"
    assert imd_alert(50)["key"] == "orange"
    assert imd_alert(56)["key"] == "red"


# --- metrics ------------------------------------------------------------
def test_mae_and_rmse_by_hand():
    y, p = [30, 32, 34], [31, 32, 31]          # errors 1, 0, 3
    assert mae(y, p) == pytest.approx(4 / 3)
    assert rmse(y, p) == pytest.approx(np.sqrt(10 / 3))


def test_mae_rejects_mismatched_lengths():
    with pytest.raises(AssertionError):
        mae([1, 2, 3], [1, 2])


# --- time split: never let the future leak into training ------------------
def test_time_split_is_strictly_chronological():
    df = pd.DataFrame({"date": pd.date_range("2024-01-01", "2026-06-30", freq="D")}).sample(frac=1, random_state=0)
    train, test = time_split(df)
    assert train["date"].max() <= pd.Timestamp("2025-12-31")
    assert test["date"].min() >= pd.Timestamp("2026-01-01")
    assert train["date"].max() < test["date"].min()
    assert train["date"].min() >= pd.Timestamp("2024-01-24")
