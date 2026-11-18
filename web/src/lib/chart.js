// Chart helpers shared by the model-performance charts.

// "Mar", "Apr" ... from "2026-03-04"
export function monthTick(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { month: 'short' })
}

// One tick per month: the first date of each month present in the data
export function monthTicks(rows, key = 'date') {
  const seen = new Set()
  return rows.map((r) => r[key]).filter((d) => {
    const m = d.slice(0, 7)
    if (seen.has(m)) return false
    seen.add(m)
    return true
  })
}

export function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function dateRange(a, b) {
  const [ya] = a.split('-')
  const [yb] = b.split('-')
  return `${shortDate(a)}${ya !== yb ? ` ${ya}` : ''} – ${shortDate(b)} ${yb}`
}

export const CHART = {
  ink: '#0e2a3b',
  soft: '#4a6070',
  line: '#c9d4da',
  sea: '#1d5e86',
  grey: '#8a9ba6',
  danger: '#e06c1f',
  red: '#b8232e',
  tick: { fontSize: 12, fill: '#4a6070' },
  tooltip: { borderRadius: 4, borderColor: '#c9d4da', fontFamily: 'Mukta, sans-serif', fontSize: 13 },
}
