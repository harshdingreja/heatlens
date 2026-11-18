import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FINAL_METHOD, METHODS, fmt, metric, methodLabel } from '../../lib/model'
import { CHART } from '../../lib/chart'
import { Note } from './shared'

const LEADS = [1, 2, 3, 4, 5]

// Error by lead time for every method: baselines vs linear vs LightGBM vs the final model.
export default function LeadMaeChart({ corrector: c }) {
  const methods = METHODS.filter((m) => c.metrics.some((x) => x.method === m.key))
  const rows = LEADS.map((lead) => {
    const row = { lead: `${lead} d` }
    for (const m of methods) row[m.key] = metric(c.metrics, m.key, lead)?.mae
    return row
  })

  // Does the final model beat every baseline at every lead? Computed, not assumed.
  const baselines = methods.filter((m) => m.kind === 'baseline')
  const losses = LEADS.filter((lead) => {
    const fin = metric(c.metrics, FINAL_METHOD, lead)?.mae
    return baselines.some((b) => metric(c.metrics, b.key, lead)?.mae <= fin)
  })
  const lin = metric(c.metrics, 'linear_regression')
  const lgb = metric(c.metrics, 'lightgbm')
  const linGap = Math.max(...LEADS.map((l) => Math.abs((metric(c.metrics, FINAL_METHOD, l)?.mae ?? 0) - (metric(c.metrics, 'linear_regression', l)?.mae ?? 0))))
  const val = Object.entries(c.validation_mae ?? {})
  const bestVal = val.reduce((a, b) => (b[1] < a[1] ? b : a), val[0] ?? [null, Infinity])
  const valMax = Math.max(...val.map(([, v]) => v))

  return (
    <div className="min-w-0">
      <div className="h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="lead" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.line }} />
            <YAxis domain={[0, 'auto']} tickFormatter={(v) => `${v}°`} tick={CHART.tick} width={44} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v, n) => [`${fmt(v)} °C`, n]} contentStyle={CHART.tooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {methods.map((m) => (
              <Line
                key={m.key}
                name={methodLabel(m.key, c.primary_raw_model)}
                dataKey={m.key}
                stroke={m.color}
                strokeDasharray={m.dash}
                strokeWidth={m.kind === 'final' ? 3.5 : m.kind === 'ml' ? 2 : 1.5}
                dot={{ r: m.kind === 'final' ? 4 : 2.5 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <Note className="mt-2">
        {losses.length === 0
          ? `At every lead time from 1 to 5 days, HeatShield has a lower error than all ${baselines.length} baselines.`
          : `HeatShield does not beat every baseline at lead ${losses.join(', ')} day(s); see the table.`}
        {linGap < 0.05 && ` Linear regression and HeatShield differ by at most ${fmt(linGap)} °C, so their lines overlap.`}
      </Note>

      <MaeTable corrector={c} methods={methods} />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Note>
          LightGBM on its own (MAE {fmt(lgb?.mae)} °C) lost to plain linear regression ({fmt(lin?.mae)} °C). Tree models can only predict values
          inside the range they saw in training, so they can't extrapolate a forecast bias that keeps drifting. The final model was chosen on 2025
          validation data, before 2026 was ever scored:
        </Note>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Validation MAE, 2025</p>
          <ul className="mt-2 space-y-1.5">
            {val.map(([k, v]) => (
              <li key={k} className="grid grid-cols-[minmax(0,15rem)_1fr_auto] items-center gap-2 text-sm">
                <span className="truncate">{methodLabel(k)}</span>
                <span className="h-3 rounded-sm" style={{ width: `${(v / valMax) * 100}%`, background: k === bestVal[0] ? CHART.sea : '#b7c4cc' }} />
                <span className={`tabular ${k === bestVal[0] ? 'font-bold' : ''}`}>
                  {fmt(v, 3)}
                  {k === bestVal[0] && ' chosen'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function MaeTable({ corrector: c, methods }) {
  const cols = [...LEADS, 'all']
  const best = Object.fromEntries(cols.map((l) => [l, Math.min(...methods.map((m) => metric(c.metrics, m.key, l)?.mae ?? Infinity))]))
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm tabular">
        <caption className="sr-only">Test MAE in °C by method and lead time</caption>
        <thead>
          <tr className="border-b border-line text-left text-ink-soft">
            <th className="py-1.5 pr-3 font-medium">MAE, °C (2026 test)</th>
            {cols.map((l) => (
              <th key={l} className="py-1.5 pl-2 text-right font-medium">
                {l === 'all' ? 'All' : `${l} d`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m.key} className={`border-b border-line/70 ${m.kind === 'final' ? 'bg-sea/5 font-semibold' : ''}`}>
              <td className="py-1.5 pr-3">{methodLabel(m.key, c.primary_raw_model)}</td>
              {cols.map((l) => {
                const v = metric(c.metrics, m.key, l)?.mae
                return (
                  <td key={l} className={`py-1.5 pl-2 text-right ${v === best[l] ? 'font-bold text-sea' : ''}`}>
                    {fmt(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-ink-soft">Bold blue = lowest error in that column.</p>
    </div>
  )
}
