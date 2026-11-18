import { useState } from 'react'
import { useTween } from '../lib/anim'
import { HEAT_HEX, HEAT_TEXT_ON, fmtDay, fmtTemp } from '../lib/heat'
import { methodLabel } from '../lib/model'
import { Skeleton, Status } from './Panel'

// Hero: a "feels-like" gauge for one forecast day + 5 selectable day cards.
// Needle = HeatShield's corrected heat index; white tick = forecast air temperature.

const MIN = 20 // °C at the left end of the dial
const MAX = 56 // °C at the right end
const SWEEP = 240 // degrees of arc
const BANDS = [
  { from: MIN, to: 26.7, color: '#2f6b4a' }, // below caution (dim green)
  { from: 26.7, to: 32.2, color: HEAT_HEX.green },
  { from: 32.2, to: 39.4, color: HEAT_HEX.yellow },
  { from: 39.4, to: 51.7, color: HEAT_HEX.orange },
  { from: 51.7, to: MAX, color: HEAT_HEX.red },
]

const clamp = (v) => Math.min(MAX, Math.max(MIN, v))
const angleOf = (v) => -SWEEP / 2 + ((clamp(v) - MIN) / (MAX - MIN)) * SWEEP // 0° = straight up
const pt = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = pt(cx, cy, r, a0)
  const [x1, y1] = pt(cx, cy, r, a1)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

export default function HeroGauge({ state }) {
  const { data, loading, slow, error, reload } = state
  const [idx, setIdx] = useState(0) // default: first forecast day = tomorrow

  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden rounded-lg text-white"
      style={{ background: 'radial-gradient(120% 90% at 50% 115%, #7a2a14 0%, #3b2030 32%, #0e2a3b 70%)' }}
    >
      <div className="relative px-4 pt-5 pb-4 sm:px-8 sm:pt-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="hero-title" className="text-lg font-bold sm:text-xl">
            How hot will it feel in Mumbai?
          </h2>
          {data && (
            <p className="text-sm text-white/70">
              Santacruz, corrected by {data.corrector ? methodLabel(data.corrector) : 'our model'}
            </p>
          )}
        </div>

        {!data ? (
          loading ? (
            <div className="grid gap-6 py-6 lg:grid-cols-2">
              <Skeleton className="mx-auto aspect-[4/3] w-full max-w-md bg-white/10" />
              <Skeleton className="h-48 w-full bg-white/10" />
            </div>
          ) : (
            <Status loading={loading} slow={slow} error={error} onRetry={reload} what="the forecast" dark />
          )
        ) : (
          <>
            <div className="mt-2 grid items-center gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10">
              <Gauge day={data.days[Math.min(idx, data.days.length - 1)]} />
              <DayFacts day={data.days[Math.min(idx, data.days.length - 1)]} />
            </div>
            <DayCards days={data.days} idx={idx} onSelect={setIdx} />
          </>
        )}
      </div>
    </section>
  )
}

function Gauge({ day }) {
  const hi = day.heat_index_corrected_c ?? day.heat_index_raw_c
  const air = day.tmax_c
  const needle = useTween(hi, 900) // animated value
  const shown = useTween(hi, 900)
  const color = HEAT_HEX[day.alert?.color ?? 'green']
  const diff = hi != null && air != null ? hi - air : null
  const cx = 160
  const cy = 165
  const R = 128

  return (
    <figure className="mx-auto w-full max-w-[26rem] min-w-0">
      <svg viewBox="0 0 320 250" className="w-full" role="img" aria-label={`Feels like ${fmtTemp(hi)}C; air temperature ${fmtTemp(air)}C; ${day.alert?.label}`}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* track + coloured NOAA bands */}
        <path d={arc(cx, cy, R, -SWEEP / 2, SWEEP / 2)} stroke="rgba(255,255,255,0.08)" strokeWidth="26" fill="none" />
        {BANDS.map((b) => (
          <path key={b.from} d={arc(cx, cy, R, angleOf(b.from), angleOf(b.to))} stroke={b.color} strokeWidth="14" fill="none" opacity="0.9" />
        ))}
        {/* glowing progress up to the current value */}
        <path d={arc(cx, cy, R + 17, -SWEEP / 2, angleOf(needle))} stroke={color} strokeWidth="5" strokeLinecap="round" fill="none" filter="url(#glow)" />
        {/* threshold labels */}
        {[26.7, 32.2, 39.4, 51.7].map((t) => {
          const [x, y] = pt(cx, cy, R - 26, angleOf(t))
          return (
            <text key={t} x={x} y={y} fill="rgba(255,255,255,0.6)" fontSize="10" textAnchor="middle" dominantBaseline="middle">
              {t}
            </text>
          )
        })}
        {/* air temperature tick */}
        {air != null && (
          <g>
            <line
              x1={pt(cx, cy, R - 12, angleOf(air))[0]}
              y1={pt(cx, cy, R - 12, angleOf(air))[1]}
              x2={pt(cx, cy, R + 12, angleOf(air))[0]}
              y2={pt(cx, cy, R + 12, angleOf(air))[1]}
              stroke="#fff"
              strokeWidth="3"
            />
          </g>
        )}
        {/* needle */}
        <g transform={`rotate(${angleOf(needle)} ${cx} ${cy})`}>
          <path d={`M ${cx - 5} ${cy} L ${cx} ${cy - R + 20} L ${cx + 5} ${cy} Z`} fill={color} />
          <circle cx={cx} cy={cy} r="9" fill="#0e2a3b" stroke={color} strokeWidth="3" />
        </g>
        <text x={cx} y={cy + 46} fill="#fff" fontSize="46" fontWeight="800" textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {shown.toFixed(1)}°
        </text>
        <text x={cx} y={cy + 70} fill="rgba(255,255,255,0.75)" fontSize="13" textAnchor="middle">
          feels like (heat index, °C)
        </text>
      </svg>
      <figcaption className="-mt-1 text-center">
        <span className="inline-block rounded-sm px-2 py-0.5 text-sm font-bold" style={{ background: color, color: HEAT_TEXT_ON[day.alert?.color ?? 'green'] }}>
          {day.alert?.label}
        </span>
        <p className="mt-2 text-base sm:text-lg">
          {diff == null ? null : Math.abs(diff) < 0.5 ? (
            <>Feels about the same as the {fmtTemp(air)}C air temperature.</>
          ) : diff > 0 ? (
            <>
              Feels <strong>{diff.toFixed(1)} °C hotter</strong> than the {fmtTemp(air)}C thermometer reading: humid air stops sweat from cooling you.
            </>
          ) : (
            <>
              Feels <strong>{Math.abs(diff).toFixed(1)} °C cooler</strong> than the {fmtTemp(air)}C thermometer reading: the air is dry, so sweat still cools you.
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-white/60">Needle = heat index. White tick = forecast air temperature.</p>
      </figcaption>
    </figure>
  )
}

function DayFacts({ day }) {
  const facts = [
    ['Air temperature (max)', fmtTemp(day.tmax_c) + 'C'],
    ['Humidity at hottest hour', day.rh_at_tmax_pct != null ? `${Math.round(day.rh_at_tmax_pct)}%` : '–'],
    ['Wind', day.wind_kmh != null ? `${day.wind_kmh.toFixed(0)} km/h` : '–'],
    ['WBGT (shade estimate)', fmtTemp(day.wbgt_c) + 'C'],
    ['Raw model forecast', fmtTemp(day.heat_index_raw_c) + 'C'],
    ['Normal for this date', fmtTemp(day.normal_heat_index_c) + 'C'],
  ]
  return (
    <div className="min-w-0">
      <p className="text-sm text-white/70">{day.lead_days === 1 ? 'Tomorrow' : `In ${day.lead_days} days`}</p>
      <p className="text-2xl font-extrabold sm:text-3xl">{fmtDay(day.date)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0 border-t border-white/15 pt-2">
            <dt className="text-xs text-white/65">{k}</dt>
            <dd className="text-lg font-bold tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {day.imd_alert && (
          <span className="rounded-sm border border-white/30 px-2 py-0.5">
            IMD band: <strong>{day.imd_alert.label}</strong>
          </span>
        )}
        {day.is_anomaly ? (
          <span className="rounded-sm bg-heat-yellow px-2 py-0.5 font-semibold text-ink">Unusually hot for the date (z {day.anomaly_z?.toFixed(1)})</span>
        ) : (
          day.anomaly_z != null && <span className="rounded-sm border border-white/30 px-2 py-0.5">z vs normal: {day.anomaly_z.toFixed(1)}</span>
        )}
      </div>
    </div>
  )
}

// The 5 forecast days as selectable cards. Plain elements: no animation needed to be visible.
function DayCards({ days, idx, onSelect }) {
  return (
    <ol className="mt-5 grid grid-cols-5 gap-1.5 sm:gap-3" aria-label="Choose a forecast day">
      {days.map((d, i) => {
        const hi = d.heat_index_corrected_c ?? d.heat_index_raw_c
        const color = d.alert?.color ?? 'green'
        const active = i === idx
        return (
          <li key={d.date} className="min-w-0">
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(i)}
              className={`group w-full rounded-md border px-1 py-2 text-center transition-all sm:px-3 sm:py-3 sm:text-left ${
                active ? 'border-white bg-white/15 shadow-[0_0_0_1px_white]' : 'border-white/15 bg-white/5 hover:-translate-y-0.5 hover:bg-white/10'
              }`}
            >
              <span className="block text-[11px] leading-tight text-white/70 sm:text-xs">{fmtDay(d.date).split(',')[0]}</span>
              <span className="block text-xs font-semibold leading-tight sm:text-sm">{fmtDay(d.date).split(', ')[1]}</span>
              <span className="mt-1 block text-lg font-extrabold leading-none tabular sm:text-2xl">{fmtTemp(hi)}</span>
              <span className="mt-2 block h-1.5 rounded-full" style={{ background: HEAT_HEX[color] }} aria-hidden="true" />
              <span className="mt-1 hidden truncate text-xs text-white/80 sm:block">{d.alert?.label}</span>
              {d.is_anomaly && <span className="mt-1 block text-[10px] font-bold text-heat-yellow">Unusual</span>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
