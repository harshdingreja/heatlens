// NOAA Heat Index, ported line by line from src/heatlens/features/heat_indices.py
// (Rothfusz regression + Steadman simple formula + both adjustments + the 80 °F rule).
// Used by the "what-if" calculator so the page and the Python models give identical numbers.

export const cToF = (c) => (c * 9) / 5 + 32
export const fToC = (f) => ((f - 32) * 5) / 9

// Heat index in °F from temperature in °F and relative humidity in % (0-100)
export function heatIndexF(T, RH) {
  // Step 1: simple formula (Steadman)
  const simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094)
  // Step 2: Rothfusz regression
  let full =
    -42.379 + 2.04901523 * T + 10.14333127 * RH -
    0.22475541 * T * RH - 0.00683783 * T ** 2 - 0.05481717 * RH ** 2 +
    0.00122874 * T ** 2 * RH + 0.00085282 * T * RH ** 2 -
    0.00000199 * T ** 2 * RH ** 2
  // Step 3a: very dry air (RH < 13 %) and 80-112 °F: subtract
  if (RH < 13 && T >= 80 && T <= 112) {
    full -= ((13 - RH) / 4) * Math.sqrt(Math.max(17 - Math.abs(T - 95), 0) / 17)
  }
  // Step 3b: very humid air (RH > 85 %) and 80-87 °F: add
  if (RH > 85 && T >= 80 && T <= 87) {
    full += ((RH - 85) / 10) * ((87 - T) / 5)
  }
  // Step 4: NOAA rule: if (simple + T) / 2 >= 80 °F use the regression, else the simple formula
  return (simple + T) / 2 >= 80 ? full : simple
}

// Same thing in °C (what the dashboard shows)
export function heatIndexC(tempC, rh) {
  if (!Number.isFinite(tempC) || !Number.isFinite(rh)) return NaN
  return fToC(heatIndexF(cToF(tempC), rh))
}

// NOAA bands (°C), same edges as models/alerts.py
export const NOAA_LEVELS = [
  { level: 0, key: 'none', label: 'Below caution', min: -Infinity, color: '#3e8e5e' },
  { level: 1, key: 'caution', label: 'Caution', min: 26.7, color: '#3e8e5e' },
  { level: 2, key: 'extreme_caution', label: 'Extreme Caution', min: 32.2, color: '#e3b023' },
  { level: 3, key: 'danger', label: 'Danger', min: 39.4, color: '#e06c1f' },
  { level: 4, key: 'extreme_danger', label: 'Extreme Danger', min: 51.7, color: '#b8232e' },
]
export function noaaLevel(hiC) {
  let out = NOAA_LEVELS[0]
  for (const l of NOAA_LEVELS) if (hiC >= l.min) out = l
  return out
}

// Plain-language effects, from NOAA/NWS heat index chart wording
export const NOAA_EFFECTS = {
  none: 'No heat-index warning. Normal precautions.',
  caution: 'Fatigue is possible with long exposure and activity.',
  extreme_caution: 'Heat cramps and heat exhaustion are possible with long exposure and activity.',
  danger: 'Heat cramps or heat exhaustion are likely; heat stroke is possible with long exposure and activity.',
  extreme_danger: 'Heat stroke is highly likely.',
}
