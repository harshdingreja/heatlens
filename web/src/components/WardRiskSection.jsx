import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { RISK_LEVELS, fmtDay } from '../lib/heat'
import { hazardScore, wardsForDay } from '../lib/risk'
import { Skeleton } from './Panel'
import WardDetails from './WardDetails'
import WardMap from './WardMap'

// The 3D map library (~1 MB) is only downloaded when this section is shown.
const WardMap3D = lazy(() => import('./WardMap3D'))

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

// If the 3D map crashes for any reason, fall back to the flat Leaflet map instead of a blank box.
class MapBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err) {
    this.props.onFail?.(err)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function WardRiskSection({ wards, days }) {
  const [dayIdx, setDayIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState(null)
  const [use3d, setUse3d] = useState(() => webglAvailable())
  const onFail = useCallback(() => setUse3d(false), [])

  const day = days?.[dayIdx]
  const dayWards = useMemo(() => (day ? wardsForDay(wards, day) : wards), [wards, day])
  const counts = useMemo(
    () => Object.fromEntries(RISK_LEVELS.map((r) => [r.key, dayWards.features.filter((f) => f.properties.risk_level === r.key).length])),
    [dayWards],
  )

  // Play: step through the 5 days, then stop on the last one
  useEffect(() => {
    if (!playing || !days) return
    const t = setTimeout(() => {
      if (dayIdx >= days.length - 1) setPlaying(false)
      else setDayIdx((i) => i + 1)
    }, 1300)
    return () => clearTimeout(t)
  }, [playing, dayIdx, days])

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        {days && (
          <div className="mb-3 rounded-md border border-line bg-haze/50 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!playing && dayIdx >= days.length - 1) setDayIdx(0)
                  setPlaying((p) => !p)
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white hover:bg-sea"
                aria-label={playing ? 'Pause' : 'Play the 5-day forecast'}
              >
                {playing ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1l10 6-10 6z" fill="currentColor" /></svg>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <label htmlFor="ward-day" className="text-sm">
                  <strong>{fmtDay(day?.date)}</strong> <span className="text-ink-soft">({day?.lead_days === 1 ? 'tomorrow' : `day ${day?.lead_days}`})</span>:{' '}
                  {day?.alert?.label}, city hazard {hazardScore(day?.alert?.level).toFixed(2)}
                </label>
                <input
                  id="ward-day"
                  type="range"
                  min={0}
                  max={days.length - 1}
                  step={1}
                  value={dayIdx}
                  onChange={(e) => {
                    setPlaying(false)
                    setDayIdx(Number(e.target.value))
                  }}
                  className="heat-range mt-1 w-full"
                  style={{ '--pct': `${(dayIdx / (days.length - 1)) * 100}%` }}
                />
              </div>
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
              {RISK_LEVELS.map((r) => (
                <span key={r.key} className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm border border-ink/20" style={{ background: r.hex }} />
                  {r.label}: <strong className="text-ink tabular">{counts[r.key]}</strong>
                </span>
              ))}
            </p>
          </div>
        )}

        <div className="overflow-hidden rounded border border-line">
          {use3d ? (
            <MapBoundary onFail={onFail}>
              <Suspense fallback={<Skeleton className="h-[380px] w-full rounded-none sm:h-[520px]" />}>
                <WardMap3D wards={dayWards} selectedId={selected} onSelect={setSelected} onFail={onFail} />
              </Suspense>
            </MapBoundary>
          ) : (
            <WardMap wards={dayWards} selectedId={selected} onSelect={setSelected} bare />
          )}
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          {use3d ? 'Height = heat vulnerability index (HVI). Colour = risk for the chosen day. Drag to pan; right-drag or two fingers to tilt and rotate. ' : ''}
          Risk = city hazard (NOAA level ÷ 4) × ward HVI. Low below 0.15, moderate below 0.30, high below 0.50, very high above.
        </p>
      </div>
      <div className="min-w-0">
        <WardDetails wards={dayWards} selectedId={selected} onSelect={setSelected} />
      </div>
    </div>
  )
}
