// Shared constants and small formatting helpers.

// NOAA heat index bands (°C). The API decides each day's alert; these are only
// used to draw the threshold lines and shaded bands in the chart and ribbon.
export const NOAA_BANDS = [
  { key: 'caution', label: 'Caution', from: 26.7, to: 32.2, color: 'green' },
  { key: 'extreme_caution', label: 'Extreme Caution', from: 32.2, to: 39.4, color: 'yellow' },
  { key: 'danger', label: 'Danger', from: 39.4, to: 51.7, color: 'orange' },
  { key: 'extreme_danger', label: 'Extreme Danger', from: 51.7, to: 60, color: 'red' },
]

// Alert colour name (from the API) -> hex, matching the tokens in index.css
export const HEAT_HEX = {
  green: '#3e8e5e',
  yellow: '#e3b023',
  orange: '#e06c1f',
  red: '#b8232e',
}

// Text that stays readable on top of each alert colour
export const HEAT_TEXT_ON = {
  green: '#ffffff',
  yellow: '#0e2a3b',
  orange: '#0e2a3b',
  red: '#ffffff',
}

// Ward risk level (from the API) -> map fill colour + human label
export const RISK_LEVELS = [
  { key: 'low', label: 'Low', hex: '#f4e4bd' },
  { key: 'moderate', label: 'Moderate', hex: '#efb565' },
  { key: 'high', label: 'High', hex: '#dc6a2a' },
  { key: 'very_high', label: 'Very high', hex: '#9e1f2a' },
]
export const riskHex = (key) => RISK_LEVELS.find((r) => r.key === key)?.hex ?? '#d5dde1'
export const riskLabel = (key) => RISK_LEVELS.find((r) => r.key === key)?.label ?? 'No data'

// ---- formatting (all of them show an en dash for missing values) ----
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export const fmtTemp = (v, digits = 1) => (isNum(v) ? `${v.toFixed(digits)}°` : '–')
export const fmtNum = (v, digits = 0) =>
  isNum(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '–'
export const fmtPct = (share, digits = 0) => (isNum(share) ? `${(share * 100).toFixed(digits)}%` : '–')

// "2026-11-18" -> "Wed 18 Nov". Parsed as a local date so the day never shifts.
export function fmtDay(iso) {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function fmtLongDate(iso) {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}
