import { fmt, healthModelLabel } from '../../lib/model'
import { Note } from './shared'

// Layer 1 (published relative risk) and Layer 2 (our own count model on state data).
export default function HealthModels({ health }) {
  const l1 = health.layer1
  const l2 = health.layer2
  const perDay = (p) => (l1.baseline_daily_deaths * p) / 100 // extra deaths/day = baseline x (RR - 1)
  const models = Object.entries(l2?.models ?? {})
  const aic = (prefix) => models.filter(([k]) => k.startsWith(prefix)).map(([, m]) => m.aic)
  const nbBetter = aic('negbin').length > 0 && Math.min(...aic('negbin')) < Math.min(...aic('poisson'))
  const poissonDisp = models.filter(([k, m]) => k.startsWith('poisson') && m.dispersion != null).map(([, m]) => m.dispersion)

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-5">
      <div className="min-w-0 lg:col-span-2">
        <p className="font-bold">Layer 1: published effect for Mumbai</p>
        <p className="mt-2 text-4xl font-extrabold leading-none tabular text-sea">+{fmt(l1.pct_increase, 1)}%</p>
        <p className="mt-1 text-sm tabular">
          deaths on a heatwave day (95% CI {fmt(l1.ci[0], 1)} to {fmt(l1.ci[1], 1)}%)
        </p>
        <p className="mt-3 text-sm tabular">
          × baseline {fmt(l1.baseline_daily_deaths, 1)} deaths/day = <strong>{fmt(perDay(l1.pct_increase), 1)}</strong> extra deaths per heatwave
          day (CI {fmt(perDay(l1.ci[0]), 1)} to {fmt(perDay(l1.ci[1]), 1)})
        </p>
        <Note className="mt-3">Heatwave = {l1.definition}.</Note>
        <p className="mt-2 text-xs text-ink-soft">{l1.citation}</p>
      </div>

      <div className="min-w-0 lg:col-span-3">
        <p className="font-bold">Layer 2: state heat-death counts ({l2?.n_rows} state-years)</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm tabular">
            <thead>
              <tr className="border-b border-line text-left text-ink-soft">
                <th className="py-1.5 pr-2 font-medium">Model</th>
                <th className="py-1.5 pl-2 text-right font-medium">IRR per +10 days</th>
                <th className="py-1.5 pl-2 text-right font-medium">95% CI</th>
                <th className="py-1.5 pl-2 text-right font-medium">Dispersion</th>
                <th className="py-1.5 pl-2 text-right font-medium">AIC</th>
              </tr>
            </thead>
            <tbody>
              {models.map(([k, m]) => (
                <tr key={k} className={`border-b border-line/70 ${k.startsWith('negbin') ? 'bg-sea/5 font-semibold' : ''}`}>
                  <td className="py-1.5 pr-2">{healthModelLabel(k)}</td>
                  <td className="py-1.5 pl-2 text-right">{fmt(m.irr_per_10_days, 3)}</td>
                  <td className="py-1.5 pl-2 text-right">
                    {fmt(m.ci?.[0], 3)}–{fmt(m.ci?.[1], 3)}
                  </td>
                  <td className="py-1.5 pl-2 text-right">{m.dispersion == null ? '–' : fmt(m.dispersion, 1)}</td>
                  <td className="py-1.5 pl-2 text-right">{fmt(m.aic, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {poissonDisp.length > 0 && (
          <Note className="mt-3">
            Poisson assumes variance = mean (dispersion ≈ 1). Here it is {fmt(Math.min(...poissonDisp), 1)}–{fmt(Math.max(...poissonDisp), 1)}, so the
            counts are heavily overdispersed and Poisson's intervals are too narrow. The negative binomial model allows extra variance, which gives
            honest, wider intervals{nbBetter ? ' and a much lower AIC' : ''}.
          </Note>
        )}
        {l2?.summary && <p className="mt-2 text-sm">{l2.summary}</p>}
      </div>
    </div>
  )
}
