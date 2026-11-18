import { useMemo, useRef, useState } from 'react'
import { fmtTemp } from '../lib/heat'

// GitHub-style calendar of every observed day at Santacruz since 2021, coloured by daily
// maximum heat index. Dots = statistically unusual days (z ≥ 2). Outlined = real heatwave days.

const CELL = 11
const GAP = 2
const STEP = CELL + GAP
// Sequential warm palette (light -> dark), heat index bins in °C
const RAMP = ['#fff3d1', '#fde3a4', '#fcc876', '#f9a854', '#f3843e', '#e45e30', '#c93c2a', '#a1262a', '#6f1a26']
const EDGES = [28, 31, 33, 35, 37, 39.4, 42, 45] // RAMP[i] is used below EDGES[i]
const colorFor = (hi) => {
  const i = EDGES.findIndex((e) => hi < e)
  return RAMP[i === -1 ? RAMP.length - 1 : i]
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const isoOf = (dt) => dt.toISOString().slice(0, 10)

export default function HeatCalendar({ days, episodes = [], onEpisode }) {
  const [tip, setTip] = useState(null) // { day, x, y, episode }
  const wrapRef = useRef(null)

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  // date -> heatwave episode it belongs to
  const episodeOf = useMemo(() => {
    const m = new Map()
    for (const e of episodes) {
      for (let dt = parse(e.start); dt <= parse(e.end); dt = new Date(dt.getTime() + 864e5)) m.set(isoOf(dt), e)
    }
    return m
  }, [episodes])
  const years = useMemo(() => [...new Set(days.map((d) => d.date.slice(0, 4)))].sort(), [days])
  // One year at a time keeps the view readable; default to the latest year.
  const [year, setYear] = useState(() => years[years.length - 1])
  const yearDays = days.filter((d) => d.date.startsWith(year))
  const anomalies = yearDays.filter((d) => d.is_anomaly).length
  const yearEpisodes = episodes.filter((e) => e.start.startsWith(year) || e.end.startsWith(year))
  const dangerDays = yearDays.filter((d) => d.hi_max >= 39.4).length

  const show = (evt, day, episode) => {
    const box = wrapRef.current.getBoundingClientRect()
    const r = evt.currentTarget.getBoundingClientRect()
    setTip({ day, episode, x: r.left - box.left + wrapRef.current.scrollLeft + CELL / 2, y: r.top - box.top })
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div role="tablist" aria-label="Year" className="flex flex-wrap gap-1.5">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              role="tab"
              aria-selected={y === year}
              onClick={() => { setYear(y); setTip(null) }}
              className={`rounded-sm border px-3 py-1.5 font-semibold ${y === year ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-soft hover:text-ink'}`}
            >
              {y}
            </button>
          ))}
        </div>
        <Legend />
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        {year}: {yearDays.length} observed days, {dangerDays} at NOAA Danger or above, {anomalies} unusually hot for the date, {yearEpisodes.length} heatwaves.
        Blank = no station data.
      </p>

      <div ref={wrapRef} className="relative mt-3 overflow-x-auto pb-2" onMouseLeave={() => setTip(null)}>
        <div className="min-w-max space-y-3">
          {[year].map((y) => (
            <YearRow key={y} year={Number(y)} byDate={byDate} episodeOf={episodeOf} onHover={show} onLeave={() => setTip(null)} onEpisode={onEpisode} />
          ))}
        </div>
        {tip && <Tooltip tip={tip} />}
      </div>
    </div>
  )
}

function YearRow({ year, byDate, episodeOf, onHover, onLeave, onEpisode }) {
  const jan1 = Date.UTC(year, 0, 1)
  const offset = new Date(jan1).getUTCDay() // weekday of 1 Jan (0 = Sunday)
  const nDays = (Date.UTC(year + 1, 0, 1) - jan1) / 864e5
  const weeks = Math.ceil((nDays + offset) / 7)
  const LEFT = 40
  const TOP = 14
  const cells = []
  const monthLabels = []
  for (let i = 0; i < nDays; i++) {
    const dt = new Date(jan1 + i * 864e5)
    const iso = isoOf(dt)
    const col = Math.floor((i + offset) / 7)
    const row = (i + offset) % 7
    if (dt.getUTCDate() === 1) monthLabels.push({ x: LEFT + col * STEP, label: MONTHS[dt.getUTCMonth()] })
    const day = byDate.get(iso)
    const ep = episodeOf.get(iso)
    cells.push({ iso, x: LEFT + col * STEP, y: TOP + row * STEP, day, ep })
  }

  return (
    <svg width={LEFT + weeks * STEP} height={TOP + 7 * STEP} role="img" aria-label={`Heat index calendar ${year}`}>
      <text x="0" y={TOP + 3.5 * STEP} fontSize="12" fontWeight="700" fill="#23150f" dominantBaseline="middle">
        {year}
      </text>
      {monthLabels.map((m) => (
        <text key={m.label} x={m.x} y="10" fontSize="10" fill="#4a6070">
          {m.label}
        </text>
      ))}
      {cells.map((c) =>
        c.day ? (
          <g
            key={c.iso}
            onMouseEnter={(e) => onHover(e, c.day, c.ep)}
            onFocus={(e) => onHover(e, c.day, c.ep)}
            onBlur={onLeave}
            onClick={c.ep && onEpisode ? () => onEpisode(c.ep.start) : undefined}
            className={c.ep ? 'cursor-pointer' : undefined}
            tabIndex={c.ep ? 0 : -1}
            onKeyDown={c.ep && onEpisode ? (e) => e.key === 'Enter' && onEpisode(c.ep.start) : undefined}
          >
            <rect x={c.x} y={c.y} width={CELL} height={CELL} rx="2" fill={colorFor(c.day.hi_max)} stroke={c.ep ? '#23150f' : 'none'} strokeWidth={c.ep ? 1.6 : 0} />
            {c.day.is_anomaly && <circle cx={c.x + CELL / 2} cy={c.y + CELL / 2} r="2" fill="#23150f" />}
          </g>
        ) : (
          <rect key={c.iso} x={c.x} y={c.y} width={CELL} height={CELL} rx="2" fill="none" stroke="#dbe3e7" strokeWidth="0.6" />
        ),
      )}
    </svg>
  )
}

function Tooltip({ tip }) {
  const d = tip.day
  return (
    <div
      className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-lg"
      style={{ left: Math.max(112, tip.x), top: tip.y - 6 }}
      role="tooltip"
    >
      <p className="font-bold">{new Date(d.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 tabular">
        <dt className="text-ink-soft">Heat index</dt>
        <dd className="font-semibold">{fmtTemp(d.hi_max)}C</dd>
        <dt className="text-ink-soft">Air temp.</dt>
        <dd>{fmtTemp(d.tmax)}C</dd>
        <dt className="text-ink-soft">Humidity</dt>
        <dd>{d.rh_at_tmax != null ? `${Math.round(d.rh_at_tmax)}%` : '–'}</dd>
        <dt className="text-ink-soft">Normal</dt>
        <dd>{fmtTemp(d.normal_hi)}C</dd>
        <dt className="text-ink-soft">z-score</dt>
        <dd>{d.z != null ? d.z.toFixed(1) : '–'}</dd>
      </dl>
      {d.is_anomaly && <p className="mt-1 text-xs font-semibold text-heat-red">Unusually hot for the date</p>}
      {tip.episode && <p className="mt-1 text-xs font-semibold text-sea">Heatwave {tip.episode.start} to {tip.episode.end}. Click to open it.</p>}
    </div>
  )
}

function Legend() {
  const labels = ['<28', '', '', '', '', '39.4', '', '', '45+']
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-end gap-0.5" aria-label="Heat index colour scale, from under 28 °C to over 45 °C">
        {RAMP.map((c, i) => (
          <div key={c} className="flex flex-col items-center">
            <span className="block h-3 w-4 rounded-sm" style={{ background: c }} />
            <span className="h-3 text-[9px] leading-3 text-ink-soft tabular">{labels[i]}</span>
          </div>
        ))}
      </div>
      <span className="flex items-center gap-1 text-xs">
        <svg width="12" height="12" aria-hidden="true">
          <rect x="0.5" y="0.5" width="11" height="11" rx="2" fill="#f9a854" />
          <circle cx="6" cy="6" r="2" fill="#23150f" />
        </svg>
        unusual
      </span>
      <span className="flex items-center gap-1 text-xs">
        <svg width="12" height="12" aria-hidden="true">
          <rect x="0.8" y="0.8" width="10.4" height="10.4" rx="2" fill="#f9a854" stroke="#23150f" strokeWidth="1.6" />
        </svg>
        heatwave
      </span>
    </div>
  )
}
