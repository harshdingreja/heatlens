// Spider chart of a ward's 5 vulnerability indicators vs the city mean.
// Each indicator is min-max normalised across the 24 wards (0 = least vulnerable ward, 1 = most).
// NDVI is inverted: less greenery = more vulnerable.

const AXES = [
  { key: 'lst_summer_c', label: 'Surface heat' },
  { key: 'ndvi_summer', label: 'Lack of greenery', invert: true },
  { key: 'pop_density', label: 'Crowding' },
  { key: 'slum_share', label: 'Slum share' },
  { key: 'worker_share', label: 'Workers' },
]

function normalise(features) {
  const props = features.map((f) => f.properties ?? f)
  const range = Object.fromEntries(
    AXES.map((a) => {
      const vals = props.map((p) => p[a.key]).filter(Number.isFinite)
      return [a.key, [Math.min(...vals), Math.max(...vals)]]
    }),
  )
  return (p) =>
    AXES.map((a) => {
      const [lo, hi] = range[a.key]
      const v = hi > lo && Number.isFinite(p[a.key]) ? (p[a.key] - lo) / (hi - lo) : 0
      return a.invert ? 1 - v : v
    })
}

export default function WardRadar({ wards, ward }) {
  const norm = normalise(wards.features)
  const all = wards.features.map((f) => norm(f.properties))
  const mean = AXES.map((_, i) => all.reduce((s, v) => s + v[i], 0) / all.length)
  const mine = norm(ward)
  const cx = 130
  const cy = 112
  const R = 78
  const at = (i, r) => {
    const a = (Math.PI * 2 * i) / AXES.length - Math.PI / 2
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const poly = (vals) => vals.map((v, i) => at(i, R * Math.max(0.03, v)).join(',')).join(' ')

  return (
    <figure className="mt-3">
      <svg viewBox="0 0 260 225" className="mx-auto w-full max-w-[19rem]" role="img" aria-label={`Vulnerability profile of ward ${ward.ward_id} compared with the city mean`}>
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon key={r} points={AXES.map((_, i) => at(i, R * r).join(',')).join(' ')} fill="none" stroke="#c9d4da" strokeWidth={r === 1 ? 1.2 : 0.7} />
        ))}
        {AXES.map((a, i) => {
          const [x, y] = at(i, R)
          const [lx, ly] = at(i, R + 18)
          return (
            <g key={a.key}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="#c9d4da" strokeWidth="0.7" />
              <text x={lx} y={ly} fontSize="10.5" fill="#4a6070" textAnchor={lx < cx - 5 ? 'end' : lx > cx + 5 ? 'start' : 'middle'} dominantBaseline="middle">
                {a.label}
              </text>
            </g>
          )
        })}
        <polygon points={poly(mean)} fill="none" stroke="#8a9ba6" strokeWidth="1.5" strokeDasharray="4 3" />
        <polygon className="radar-shape" points={poly(mine)} fill="rgba(224,108,31,0.28)" stroke="#e06c1f" strokeWidth="2" />
        {mine.map((v, i) => {
          const [x, y] = at(i, R * Math.max(0.03, v))
          return <circle key={i} cx={x} cy={y} r="3" fill="#e06c1f" />
        })}
      </svg>
      <figcaption className="flex justify-center gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded-sm border-2 border-heat-orange bg-heat-orange/30" /> Ward {ward.ward_id}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t-2 border-dashed border-[#8a9ba6]" /> City mean
        </span>
      </figcaption>
      <p className="mt-1 text-center text-[11px] text-ink-soft">Scaled 0–1 across the 24 wards; outer edge = most vulnerable ward.</p>
    </figure>
  )
}
