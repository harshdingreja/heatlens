import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FINAL_METHOD, fmt, metric, modelName } from '../../lib/model'
import { CHART, monthTick, monthTicks, shortDate } from '../../lib/chart'
import { Note, Segmented } from './shared'

const LEADS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} day${n > 1 ? 's' : ''}` }))

// 2026 backtest: what actually happened vs what was forecast N days earlier.
export default function BacktestChart({ corrector: c }) {
  const [lead, setLead] = useState(1)
  const rows = useMemo(
    () => c.backtest.filter((r) => r.lead_days === lead).sort((a, b) => a.date.localeCompare(b.date)),
    [c.backtest, lead],
  )
  const raw = metric(c.metrics, 'A_raw_forecast', lead)
  const fin = metric(c.metrics, FINAL_METHOD, lead)
  const rawName = modelName(c.primary_raw_model)

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Forecast lead time" options={LEADS} value={lead} onChange={setLead} />
        {raw && fin && (
          <p className="text-sm tabular">
            {lead}-day-ahead MAE: <span className="text-ink-soft line-through">{fmt(raw.mae)}</span>{' '}
            <strong className="text-sea">{fmt(fin.mae)} °C</strong> <span className="text-ink-soft">({fin.n} days)</span>
          </p>
        )}
      </div>

      <div className="mt-4 h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" ticks={monthTicks(rows)} tickFormatter={monthTick} tick={CHART.tick} minTickGap={8} tickLine={false} axisLine={{ stroke: CHART.line }} />
            <YAxis domain={['dataMin - 2', 'dataMax + 2']} tickFormatter={(v) => `${Math.round(v)}°`} tick={CHART.tick} width={44} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={shortDate} formatter={(v, n) => [`${fmt(v, 1)} °C`, n]} contentStyle={CHART.tooltip} />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <ReferenceLine y={39.4} stroke={CHART.danger} strokeDasharray="5 4" label={{ value: 'Danger 39.4 °C', position: 'insideTopLeft', fontSize: 11, fill: CHART.danger }} />
            <Line name="Observed (Santacruz)" dataKey="observed" stroke={CHART.ink} strokeWidth={1.6} dot={false} isAnimationActive={false} />
            <Line name={`Raw ${rawName} forecast`} dataKey="raw" stroke={CHART.grey} strokeWidth={1.2} dot={false} isAnimationActive={false} />
            <Line name="HeatShield" dataKey="corrected" stroke={CHART.sea} strokeWidth={1.8} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Note className="mt-2">
        Every point is a real forecast made {lead} day{lead > 1 ? 's' : ''} ahead for a 2026 day, compared with the daily maximum heat index
        measured at Santacruz. The model was trained only on 2024–2025.
      </Note>
    </div>
  )
}
