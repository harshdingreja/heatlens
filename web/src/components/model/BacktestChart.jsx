import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FINAL_METHOD, fmt, metric, modelName } from '../../lib/model'
import { CHART, shortDate } from '../../lib/chart'
import { Note } from './shared'

const DANGER = 39.4
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

// 2026 backtest: what was forecast N days earlier vs what the station measured.
// Shown one month at a time so individual days (and the size of each miss) are visible.
export default function BacktestChart({ corrector: c }) {
  const rawName = modelName(c.primary_raw_model)
  const [lead, setLead] = useState(1)

  // Months present in the test period, and the one with the most Danger days (shown first)
  const months = useMemo(() => {
    const byMonth = new Map()
    for (const r of c.backtest) {
      if (r.lead_days !== 1) continue
      const m = r.date.slice(0, 7)
      byMonth.set(m, (byMonth.get(m) ?? 0) + (r.observed >= DANGER ? 1 : 0))
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [c.backtest])
  const [month, setMonth] = useState(() => [...months].sort((a, b) => b[1] - a[1])[0]?.[0])

  const rows = useMemo(
    () =>
      c.backtest
        .filter((r) => r.lead_days === lead && r.date.startsWith(month))
        .sort((a, b) => a.date.localeCompare(b.date))
        // band = the gap between what HeatLens forecast and what happened
        .map((r) => ({ ...r, band: [Math.min(r.observed, r.corrected), Math.max(r.observed, r.corrected)] })),
    [c.backtest, lead, month],
  )

  // This month's numbers, computed from the rows shown
  const stats = useMemo(() => {
    const danger = rows.filter((r) => r.observed >= DANGER)
    return {
      n: rows.length,
      maeFinal: mean(rows.map((r) => Math.abs(r.corrected - r.observed))),
      maeRaw: mean(rows.map((r) => Math.abs(r.raw - r.observed))),
      danger: danger.length,
      caughtFinal: danger.filter((r) => r.corrected >= DANGER).length,
      caughtRaw: danger.filter((r) => r.raw >= DANGER).length,
    }
  }, [rows])

  const monthName = month ? `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` : ''
  const first = metric(c.metrics, FINAL_METHOD, 1)
  const last = metric(c.metrics, FINAL_METHOD, 5)

  return (
    <div className="min-w-0">
      {/* Step 1: how far ahead? Each card already shows the whole-year result for that lead. */}
      <p className="text-sm font-semibold">1. How far ahead was the forecast made?</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[1, 2, 3, 4, 5].map((n) => {
          const fin = metric(c.metrics, FINAL_METHOD, n)
          const raw = metric(c.metrics, 'A_raw_forecast', n)
          const on = n === lead
          return (
            <button
              key={n}
              type="button"
              aria-pressed={on}
              onClick={() => setLead(n)}
              className={`rounded-md border p-3 text-left transition-colors ${on ? 'border-sea bg-sea text-white' : 'border-line bg-white hover:border-sea'}`}
            >
              <span className="block text-sm font-bold">{n} day{n > 1 ? 's' : ''} ahead</span>
              <span className="mt-1 block text-xl font-extrabold tabular">±{fmt(fin?.mae, 2)} °C</span>
              <span className={`block text-xs tabular ${on ? 'text-white/80' : 'text-ink-soft'}`}>raw model ±{fmt(raw?.mae, 2)} °C</span>
            </button>
          )
        })}
      </div>
      <Note className="mt-2">
        Average miss over all of 2026. HeatLens gets only a little worse the further ahead it looks (±{fmt(first?.mae)} °C at 1 day, ±{fmt(last?.mae)} °C at 5
        days), so the lines below change only slightly between leads. The big gap is between HeatLens and the raw model.
      </Note>

      {/* Step 2: which month? */}
      <p className="mt-5 text-sm font-semibold">2. Pick a month to look at day by day</p>
      <div role="tablist" aria-label="Month" className="mt-2 flex flex-wrap gap-1.5">
        {months.map(([m, d]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === month}
            onClick={() => setMonth(m)}
            className={`rounded-sm border px-2.5 py-1 text-sm font-semibold ${m === month ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-soft hover:text-ink'}`}
            title={`${d} Danger days`}
          >
            {MONTHS[Number(m.slice(5, 7)) - 1]}
            {d > 0 && <span className={`ml-1 text-xs ${m === month ? 'text-heat-orange' : 'text-heat-red'}`}>●</span>}
          </button>
        ))}
      </div>

      {/* Plain-language summary of what the chart shows */}
      <p className="mt-4 rounded-md border border-line bg-haze/60 p-3 text-sm">
        In <strong>{monthName}</strong>, forecasting <strong>{lead} day{lead > 1 ? 's' : ''} ahead</strong>, HeatLens missed by{' '}
        <strong className="text-sea tabular">{fmt(stats.maeFinal)} °C</strong> on average; the raw {rawName} forecast missed by{' '}
        <strong className="tabular">{fmt(stats.maeRaw)} °C</strong>.
        {stats.danger > 0 ? (
          <>
            {' '}Of <strong className="tabular">{stats.danger}</strong> Danger days, HeatLens warned on <strong className="tabular">{stats.caughtFinal}</strong> and the raw
            model on <strong className="tabular">{stats.caughtRaw}</strong>.
          </>
        ) : (
          ' No day reached the Danger level this month.'
        )}
      </p>

      <div className="mt-3 h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => Number(d.slice(8, 10))} tick={CHART.tick} interval="preserveStartEnd" minTickGap={12} tickLine={false} axisLine={{ stroke: CHART.line }} />
            <YAxis domain={['dataMin - 1.5', 'dataMax + 1.5']} tickFormatter={(v) => `${Math.round(v)}°`} tick={CHART.tick} width={44} tickLine={false} axisLine={false} />
            <Tooltip
              labelFormatter={shortDate}
              formatter={(v, n) => (Array.isArray(v) ? [`${fmt(v[1] - v[0], 1)} °C`, 'HeatLens miss'] : [`${fmt(v, 1)} °C`, n])}
              contentStyle={CHART.tooltip}
            />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <ReferenceLine y={DANGER} stroke={CHART.danger} strokeDasharray="5 4" label={{ value: 'Danger 39.4 °C', position: 'insideTopLeft', fontSize: 11, fill: CHART.danger }} />
            <Area name="HeatLens miss" dataKey="band" fill={CHART.sea} fillOpacity={0.15} stroke="none" isAnimationActive={false} />
            <Line name={`Raw ${rawName}`} dataKey="raw" stroke={CHART.grey} strokeWidth={1.4} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line name="Observed" dataKey="observed" stroke={CHART.ink} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
            <Line name="HeatLens" dataKey="corrected" stroke={CHART.sea} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Note className="mt-2">
        Each point is a real forecast made {lead} day{lead > 1 ? 's' : ''} before that date, compared with the daily maximum heat index measured at
        Santacruz. The shaded band is the size of HeatLens's miss. The model was trained only on 2024–2025.
      </Note>
    </div>
  )
}
