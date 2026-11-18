import { useState } from 'react'
import { useTween } from '../lib/anim'
import { NOAA_EFFECTS, heatIndexC, noaaLevel } from '../lib/heatIndex'

// "What-if" calculator: move the sliders, see the heat index (same NOAA formula as our Python code).
// Presets are ILLUSTRATIVE inputs, not measurements.
const PRESETS = [
  { name: 'Mumbai May afternoon', t: 34, rh: 70 },
  { name: 'Delhi dry heat', t: 44, rh: 15 },
  { name: 'Chennai humid evening', t: 31, rh: 85 },
  { name: 'Pleasant winter day', t: 26, rh: 50 },
]

export default function HeatCalculator() {
  const [t, setT] = useState(34)
  const [rh, setRh] = useState(70)
  const hi = heatIndexC(t, rh)
  const level = noaaLevel(hi)
  const shown = useTween(hi, 400)
  const diff = hi - t

  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <Slider label="Air temperature" unit="°C" min={20} max={50} step={0.5} value={t} onChange={setT} />
        <Slider label="Relative humidity" unit="%" min={5} max={100} step={1} value={rh} onChange={setRh} />

        <p className="mt-4 text-sm text-ink-soft">Try an example (illustrative inputs, not measured data):</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                setT(p.t)
                setRh(p.rh)
              }}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                t === p.t && rh === p.rh ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'
              }`}
            >
              {p.name}
              <span className="ml-1 text-xs opacity-70 tabular">
                ({p.t}°, {p.rh}%)
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-md border-l-4 px-4 py-3" style={{ borderColor: level.color, background: `${level.color}14` }}>
          <p className="text-sm text-ink-soft">Feels like</p>
          <p className="text-5xl font-extrabold leading-none tabular" style={{ color: level.level >= 2 ? level.color : undefined }}>
            {Number.isFinite(shown) ? shown.toFixed(1) : '–'}°C
          </p>
          <p className="mt-1 text-sm tabular">
            {Math.abs(diff) < 0.5 ? 'About the same as the air temperature.' : `${Math.abs(diff).toFixed(1)} °C ${diff > 0 ? 'hotter' : 'cooler'} than the air temperature.`}
          </p>
          <p className="mt-2 font-bold">{level.label}</p>
          <p className="text-sm">{NOAA_EFFECTS[level.key]}</p>
        </div>
        <p className="mt-2 text-xs text-ink-soft">NOAA heat index (Rothfusz regression with NOAA's adjustments), the same code as HeatLens's models.</p>
      </div>

      <Silhouette level={level} />
    </div>
  )
}

function Slider({ label, unit, min, max, step, value, onChange }) {
  const id = `slider-${label.replace(/\s/g, '-')}`
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        <span className="text-xl font-extrabold tabular">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="heat-range mt-1 w-full"
        style={{ '--pct': `${pct}%` }}
      />
    </div>
  )
}

// A person whose glow grows with the risk level
function Silhouette({ level }) {
  const glow = [0, 4, 9, 15, 22][level.level]
  return (
    <figure className="mx-auto w-40 md:w-48" aria-label={`Body heat stress: ${level.label}`}>
      <svg viewBox="0 0 120 220" className="w-full overflow-visible">
        <defs>
          <radialGradient id="body-heat" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor={level.color} stopOpacity="0.95" />
            <stop offset="100%" stopColor={level.color} stopOpacity={0.35 + level.level * 0.12} />
          </radialGradient>
          <filter id="aura" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={glow} />
          </filter>
        </defs>
        <g style={{ transition: 'opacity 400ms' }} opacity={level.level === 0 ? 0 : 0.75}>
          <Body fill={level.color} filter="url(#aura)" />
        </g>
        <Body fill="url(#body-heat)" stroke="#23150f" />
        {/* heat waves above the head at Danger and above */}
        {level.level >= 3 &&
          [40, 60, 80].map((x, i) => (
            <path key={x} className="heat-wave" style={{ animationDelay: `${i * 200}ms` }} d={`M ${x} 12 q 4 -6 0 -12 q -4 -6 0 -12`} stroke={level.color} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          ))}
      </svg>
      <figcaption className="text-center text-sm font-semibold">{level.label}</figcaption>
    </figure>
  )
}

function Body(props) {
  return (
    <g {...props} strokeWidth={props.stroke ? 2 : 0}>
      <circle cx="60" cy="42" r="17" />
      <path d="M38 66 Q60 58 82 66 L92 128 Q93 135 86 134 L80 104 L78 150 L84 206 Q84 212 77 212 L64 212 L60 160 L56 212 L43 212 Q36 212 36 206 L42 150 L40 104 L34 134 Q27 135 28 128 Z" />
    </g>
  )
}
