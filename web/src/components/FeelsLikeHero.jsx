import { heatIndexC } from '../lib/heatIndex'

// The core idea of the project, shown first: the thermometer vs what your body feels.
// Sweat cools you only if it can evaporate; humid air slows that down, so you feel hotter.
export default function FeelsLikeHero({ forecast }) {
  const d = forecast?.days?.[0]
  if (!d || d.tmax_c == null || d.rh_at_tmax_pct == null) return null
  const air = d.tmax_c
  const rh = d.rh_at_tmax_pct
  // HeatLens's corrected heat index (same number as the Forecast page); fall back to the formula
  const feels = d.heat_index_corrected_c ?? heatIndexC(air, rh)
  const gap = feels - air
  const example = heatIndexC(34, 70) // fixed illustration, computed, not typed

  return (
    <section aria-label="Feels-like temperature" className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">
      <div className="overflow-hidden rounded-xl bg-gradient-to-br from-[#2a1610] via-[#5a2412] to-[#b4441b] text-white shadow-lg">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-wide text-white/70 uppercase">Tomorrow in Mumbai · {new Date(d.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
            <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
              <Big label="Thermometer says" value={air} />
              <span className="pb-3 text-3xl text-white/60" aria-hidden="true">→</span>
              <Big label="Your body feels" value={feels} strong />
            </div>
            <p className="mt-4 max-w-[52ch] text-white/85">
              {Math.abs(gap) < 0.5
                ? `At ${Math.round(rh)} % humidity, it feels about the same as the thermometer reading.`
                : gap > 0
                  ? `Feels ${gap.toFixed(1)} °C hotter, because humidity is ${Math.round(rh)} %: damp air stops sweat evaporating, so your body can't cool itself.`
                  : `Feels ${Math.abs(gap).toFixed(1)} °C cooler, because the air is dry (${Math.round(rh)} % humidity): sweat evaporates easily and cools you.`}
            </p>
          </div>

          <div className="rounded-lg bg-white/10 p-5 backdrop-blur-sm">
            <p className="font-bold">Why "feels like" matters</p>
            <p className="mt-1 text-sm text-white/85">
              Heat warnings usually look only at temperature. HeatLens uses the <strong>Heat Index</strong> (NOAA), which adds humidity: the same air temperature is far more
              dangerous when the air is humid.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-black/20 px-4 py-3 text-sm tabular">
              <span className="whitespace-nowrap">34 °C + 70 % humidity</span>
              <span aria-hidden="true">=</span>
              <strong className="whitespace-nowrap text-lg text-[#ffc27a]">feels {example.toFixed(0)} °C</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Big({ label, value, strong }) {
  return (
    <div>
      <p className="text-sm text-white/70">{label}</p>
      <p className={`font-extrabold leading-none tabular ${strong ? 'text-6xl text-[#ffc27a] sm:text-7xl' : 'text-5xl sm:text-6xl'}`}>{value.toFixed(1)}°</p>
    </div>
  )
}
