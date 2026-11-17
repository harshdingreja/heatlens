import { fmtDay, fmtNum } from '../lib/heat'

// Layer 1: extra deaths per day, from published relative risks (with 95% confidence intervals).
export default function RiskCard({ risk }) {
  const heatDays = risk.days.filter((d) => d.heatwave)
  const worst = heatDays.reduce((a, d) => (a == null || d.extra_deaths > a.extra_deaths ? d : a), null)

  return (
    <div className="flex h-full flex-col gap-4">
      {/* The disclaimer comes first, so nobody reads the number without it */}
      <p className="rounded-sm border-l-4 border-heat-orange bg-heat-orange/10 px-3 py-2 text-sm font-semibold">{risk.disclaimer}</p>

      {worst ? (
        <div>
          <p className="text-sm text-ink-soft">Heatwave conditions expected. Highest estimate, {fmtDay(worst.date)}:</p>
          <p className="mt-1 text-4xl font-extrabold leading-none tabular">
            +{fmtNum(worst.extra_deaths, 1)}
            <span className="ml-2 text-base font-semibold text-ink-soft">extra deaths per day</span>
          </p>
          <p className="mt-1 text-sm tabular">
            95% confidence interval {fmtNum(worst.extra_deaths_ci?.[0], 1)} to {fmtNum(worst.extra_deaths_ci?.[1], 1)}
            {worst.relative_risk != null && <> (relative risk {fmtNum(worst.relative_risk, 3)})</>}
          </p>
        </div>
      ) : (
        <div>
          <p className="text-2xl font-extrabold leading-tight">No heatwave days in the next 5 days</p>
          <p className="mt-1 text-sm text-ink-soft">By the study's heatwave definition, no extra deaths are estimated for this period.</p>
        </div>
      )}

      <table className="w-full text-sm">
        <caption className="sr-only">Estimated extra deaths per day</caption>
        <thead>
          <tr className="border-b border-line text-left text-ink-soft">
            <th className="py-1 font-medium">Day</th>
            <th className="py-1 font-medium">Heatwave</th>
            <th className="py-1 text-right font-medium">Extra deaths (95% CI)</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {risk.days.map((d) => (
            <tr key={d.date} className="border-b border-line/70">
              <td className="py-1.5">{fmtDay(d.date)}</td>
              <td className="py-1.5">{d.heatwave ? 'Yes' : 'No'}</td>
              <td className="py-1.5 text-right">
                {fmtNum(d.extra_deaths, 1)}
                {d.heatwave && d.extra_deaths_ci && (
                  <span className="text-ink-soft"> ({fmtNum(d.extra_deaths_ci[0], 1)} to {fmtNum(d.extra_deaths_ci[1], 1)})</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="font-semibold">Heatwave definition</dt>
          <dd className="text-ink-soft">{risk.heatwave_definition}</dd>
        </div>
        <div>
          <dt className="font-semibold">Baseline</dt>
          <dd className="text-ink-soft">
            {fmtNum(risk.baseline_daily_deaths, 1)} deaths per day in Mumbai. {risk.baseline_source}
          </dd>
        </div>
        {risk.state_model_check?.summary && (
          <div>
            <dt className="font-semibold">Cross-check with state data</dt>
            <dd className="text-ink-soft">{risk.state_model_check.summary}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">Source</dt>
          <dd className="text-ink-soft">{risk.citation}</dd>
        </div>
      </dl>
    </div>
  )
}
