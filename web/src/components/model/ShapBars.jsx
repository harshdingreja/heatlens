import { featureLabel, fmt } from '../../lib/model'
import { Note } from './shared'

// SHAP: how much each feature moves the prediction on average (mean |SHAP value|).
// Plain HTML bars, so long feature names can wrap on phones.
export default function ShapBars({ corrector: c }) {
  const top = [...c.shap_top].sort((a, b) => b.value - a.value).slice(0, 10)
  const max = top[0]?.value ?? 1
  return (
    <div className="min-w-0">
      <ol className="space-y-2.5">
        {top.map((f, i) => (
          <li key={f.feature} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 sm:grid-cols-[15rem_minmax(0,1fr)]">
            <span className="text-sm leading-tight" title={f.feature}>
              {featureLabel(f.feature)}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-4 rounded-sm" style={{ width: `${(f.value / max) * 100}%`, background: i < 3 ? '#1d5e86' : '#7fa6c0' }} />
              <span className="shrink-0 text-xs text-ink-soft tabular">{fmt(f.value, 3)}</span>
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
