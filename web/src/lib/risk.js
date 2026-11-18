// Ward risk for any forecast day, using EXACTLY the API's rule (api/main.py):
//   hazard = NOAA alert level / 4         (from /forecast days[i].alert.level, 0..4)
//   risk   = hazard × ward HVI            (HVI is 0..1)
//   low < 0.15 ≤ moderate < 0.30 ≤ high < 0.50 ≤ very_high
export const hazardScore = (alertLevel) => (Number.isFinite(alertLevel) ? alertLevel / 4 : 0)

export const wardRisk = (hvi, alertLevel) => hazardScore(alertLevel) * (hvi ?? 0)

export function riskLevelOf(score) {
  if (score < 0.15) return 'low'
  if (score < 0.3) return 'moderate'
  if (score < 0.5) return 'high'
  return 'very_high'
}

// Copy of a /wards FeatureCollection with risk recomputed for one forecast day
export function wardsForDay(wards, day) {
  const level = day?.alert?.level
  return {
    ...wards,
    features: wards.features.map((f) => {
      const risk = wardRisk(f.properties.hvi, level)
      return { ...f, properties: { ...f.properties, risk_today: risk, risk_level: riskLevelOf(risk) } }
    }),
  }
}
