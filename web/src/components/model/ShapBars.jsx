import { useRef } from 'react'
import { useInView } from '../../lib/anim'
import { featureLabel, fmt } from '../../lib/model'
import { Note } from './shared'

// SHAP: how much each feature moves the prediction on average (mean |SHAP value|).
// Plain HTML bars, so long feature names can wrap on phones.
export default function ShapBars({ corrector: c }) {
  const top = [...c.shap_top].sort((a, b) => b.value - a.value).slice(0, 10)
  const max = top[0]?.value ?? 1
  const ref = useRef(null)
  const seen = useInView(ref, '-40px')
  return (
    <div ref={ref} className="min-w-0">
      <ol className="space-y-2.5">
        {top.map((f, i) => (
          <li key={f.feature} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 sm:grid-cols-[15rem_minmax(0,1fr)]">
            <span className="text-sm leading-tight" title={f.feature}>
              {featureLabel(f.feature)}
            </span>
            {/* lollipop: stem grows on scroll, head carries the value */}
            <span className="group flex min-w-0 items-center gap-2" title={`${f.feature}: mean |SHAP| ${fmt(f.value, 3)} °C`}>
              <span
                className="relative h-0.5 transition-[width] duration-1000 ease-out"
                style={{ width: seen ? `calc(${(f.value / max) * 100}% - 3.5rem)` : '0%', background: i < 3 ? '#1d5e86' : '#7fa6c0', transitionDelay: `${i * 60}ms` }}
              >
                <span
                  className="absolute top-1/2 -right-2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white shadow transition-transform group-hover:scale-125"
                  style={{ background: i < 3 ? '#1d5e86' : '#7fa6c0' }}
                />
              </span>
              <span className="ml-2 shrink-0 text-xs text-ink-soft tabular">{fmt(f.value, 3)}</span>
            </span>
          </li>
        ))}
      </ol>
      <Note className="mt-3">
        Mean absolute SHAP value (°C of heat index) for the corrector's LightGBM model: the bigger the bar, the more that feature moves a
        prediction. The most influential input is “{featureLabel(top[0]?.feature ?? '')}”.
      </Note>
    </div>
  )
}
