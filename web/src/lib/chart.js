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
  ink: '#23150f',
  soft: '#6b5a50',
  line: '#e6dbcd',
  sea: '#b4441b',
  grey: '#8a9ba6',
  danger: '#b8232e',
  red: '#b8232e',
  tick: { fontSize: 12, fill: '#6b5a50' },
  tooltip: { borderRadius: 4, borderColor: '#e6dbcd', fontFamily: 'Mukta, sans-serif', fontSize: 13 },
}
