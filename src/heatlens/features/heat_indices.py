"""Heat-stress indices: Heat Index (how hot it FEELS) and an approximate WBGT.

Why not just temperature? Sweat cools us only if it can evaporate. In humid
air it can't, so 34 °C at 70 % humidity stresses the body like ~47 °C dry air.

Sources (checked 17 Nov 2026):
- Heat Index: NOAA / NWS Weather Prediction Center, "The Heat Index Equation"
  (Rothfusz 1990 regression + Steadman-based simple formula + two adjustments).
  IMD's experimental heat index uses an equation "similar to NOAA's" (PIB, 20 Jul 2023).
- WBGT: Australian Bureau of Meteorology approximation (ACSM 1984):
  WBGT = 0.567*T + 0.393*e + 3.94, e = water-vapour pressure in hPa.
  Same formula as thermofeel 2.3.0 `calculate_wbgt_simple`. BoM describes it
  as an estimate for moderately sunny, light-wind conditions; it has no explicit
  sun or wind term, so it overestimates in cloud/wind and at night.
"""
from __future__ import annotations

import numpy as np


def c_to_f(temp_c):
    return np.asarray(temp_c, dtype=float) * 9 / 5 + 32


def f_to_c(temp_f):
    return (np.asarray(temp_f, dtype=float) - 32) * 5 / 9


# HARSH: explain this
def heat_index_c(temp_c, rh_pct):
    """NOAA Heat Index in °C. Works on single numbers, numpy arrays and pandas Series."""
    T = c_to_f(temp_c)                       # NOAA's formula is written in °F
    RH = np.asarray(rh_pct, dtype=float)     # relative humidity, 0-100

    # Step 1: simple formula (Steadman). Good enough when it's not hot.
    simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094)

    # Step 2: Rothfusz regression, a curve fitted to Steadman's tables, for hot conditions.
    full = (-42.379 + 2.04901523 * T + 10.14333127 * RH
            - 0.22475541 * T * RH - 0.00683783 * T**2 - 0.05481717 * RH**2
            + 0.00122874 * T**2 * RH + 0.00085282 * T * RH**2
            - 0.00000199 * T**2 * RH**2)

    # Step 3: adjustments at the edges of the regression.
    # Very dry air (RH < 13 %) and 80-112 °F: the regression is too high, subtract.
    dry = (RH < 13) & (T >= 80) & (T <= 112)
    full = np.where(dry, full - ((13 - RH) / 4) * np.sqrt(np.clip(17 - np.abs(T - 95), 0, None) / 17), full)
    # Very humid air (RH > 85 %) and 80-87 °F: the regression is too low, add.
    humid = (RH > 85) & (T >= 80) & (T <= 87)
    full = np.where(humid, full + ((RH - 85) / 10) * ((87 - T) / 5), full)

    # Step 4: NOAA rule: average the simple result with T. If that average is
    # 80 °F or more, use the full regression; otherwise keep the simple one.
    hi_f = np.where((simple + T) / 2 >= 80, full, simple)

    hi_c = f_to_c(hi_f)
    # Keep missing inputs missing (NaN in -> NaN out) instead of inventing values.
    hi_c = np.where(np.isnan(T) | np.isnan(RH), np.nan, hi_c)
    return hi_c if hi_c.ndim else float(hi_c)


def vapour_pressure_hpa(temp_c, rh_pct):
    """Water-vapour pressure (hPa), from the BoM thermal-stress page formula."""
    t = np.asarray(temp_c, dtype=float)
    return np.asarray(rh_pct, dtype=float) / 100 * 6.105 * np.exp(17.27 * t / (237.7 + t))


def wbgt_bom_c(temp_c, rh_pct):
    """Approximate Wet Bulb Globe Temperature (°C), Australian BoM formula."""
    out = 0.567 * np.asarray(temp_c, dtype=float) + 0.393 * vapour_pressure_hpa(temp_c, rh_pct) + 3.94
    return out if out.ndim else float(out)
