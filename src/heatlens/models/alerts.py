"""Turn a heat index (°C) into an alert level. This is the "classification" step.

Two schemes:
1. NOAA / US National Weather Service heat index bands (the spec's main scheme):
       below 26.7 °C    -> no alert       (green)
       26.7 - 32.2 °C   -> Caution         (green)
       32.2 - 39.4 °C   -> Extreme Caution (yellow)
       39.4 - 51.7 °C   -> Danger          (orange)
       >= 51.7 °C       -> Extreme Danger  (red)
2. IMD experimental heat index colours (India-specific option). Source: PIB press
   release "IMD has launched Heat Index", 20 Jul 2023 (Rajya Sabha reply):
       Green < 35, Yellow 36-45, Orange 46-55, Red > 55 °C.
   The published bands leave gaps (35-36, 45-46, 55). We close them by putting
   each gap in the LOWER band (e.g. 35.5 -> green), which is a documented choice.
"""
from __future__ import annotations

import numpy as np

# (lower bound °C, level, key, label, colour), checked from top to bottom
NOAA_BANDS = [
    (51.7, 4, "extreme_danger", "Extreme Danger", "red"),
    (39.4, 3, "danger", "Danger", "orange"),
    (32.2, 2, "extreme_caution", "Extreme Caution", "yellow"),
    (26.7, 1, "caution", "Caution", "green"),
    (-np.inf, 0, "green", "No alert", "green"),
]
NOAA_KEYS = [b[2] for b in sorted(NOAA_BANDS, key=lambda b: b[1])]   # level 0..4 in order
DANGER_THRESHOLD_C = 39.4  # "Danger or worse" - the event we score with precision/recall

IMD_BANDS = [  # (strictly-above bound, key, label, colour)
    (55.0, "red", "Red", "red"),
    (45.0, "orange", "Orange", "orange"),
    (35.0, "yellow", "Yellow", "yellow"),
    (-np.inf, "green", "Green", "green"),
]


def noaa_level(hi_c):
    """Alert level 0-4 for one value or an array (NaN -> -1 meaning 'unknown')."""
    hi = np.asarray(hi_c, dtype=float)
    level = np.select([hi >= 51.7, hi >= 39.4, hi >= 32.2, hi >= 26.7], [4, 3, 2, 1], default=0)
    level = np.where(np.isnan(hi), -1, level)
    return level if level.ndim else int(level)


def noaa_alert(hi_c: float | None) -> dict | None:
    """Full alert info for ONE heat-index value, ready for the API."""
    if hi_c is None or np.isnan(hi_c):
        return None
    for bound, level, key, label, color in NOAA_BANDS:
        if hi_c >= bound:
            return {"level": level, "key": key, "label": label, "color": color}


def imd_alert(hi_c: float | None) -> dict | None:
    if hi_c is None or np.isnan(hi_c):
        return None
    for bound, key, label, color in IMD_BANDS:
        # Gap rule: a value counts for a band only once it reaches the band's
        # published lower edge (36, 46, 56); gap values stay in the lower band.
        published_lower = {"yellow": 36.0, "orange": 46.0, "red": 55.0}.get(key, -np.inf)
        if hi_c > bound and (hi_c >= published_lower or key == "red"):
            return {"key": key, "label": label, "color": color}
    return {"key": "green", "label": "Green", "color": "green"}
