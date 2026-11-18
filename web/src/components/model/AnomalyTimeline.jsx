import { useMemo } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt } from '../../lib/model'
import { CHART, monthTick, monthTicks, shortDate } from '../../lib/chart'
import { Note } from './shared'

// Observed daily max heat index vs the 1991-2020 normal, with the two anomaly detectors marked.
export default function AnomalyTimeline({ anomalies: a }) {
  const rows = useMemo(
    () =>
      a.series.map((d) => ({
        ...d,
        zPoint: d.is_anomaly ? d.hi_max : null, // z-score detector
        ifPoint: d.if_anomaly ? d.hi_max : null, // IsolationForest detector
      })),
    [a.series],
  )
  const s = a.summary
  const years = Object.entries(a.per_year ?? {})
  const yMax = Math.max(...years.map(([, v]) => v))

  const stats = [
    ['Days checked (2026)', s.days],
    [`z ≥ ${a.z_threshold} (statistics)`, s.z_anomalies],
    ['IsolationForest, hot side (ML)', s.if_hot_anomalies],
    ['Flagged by both', s.both],
    ['Overlap (Jaccard)', fmt(s.jaccard)],
    ["Agreement (Cohen's κ)", fmt(s.cohen_kappa)],
  ]

  return (
    <div className="min-w-0">
      <div className="h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" ticks={monthTicks(rows)} tickFormatter={monthTick} tick={CHART.tick} minTickGap={8} tickLine={false} axisLine={{ stroke: CHART.line }} />
            <YAxis domain={['dataMin - 2', 'dataMax + 2']} tickFormatter={(v) => `${Math.round(v)}°`} tick={CHART.tick} width={44} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={shortDate} formatter={(v, n) => [`${fmt(v, 1)} °C`, n]} contentStyle={CHART.tooltip} />
            <Line name="Normal for the date (1991–2020)" dataKey="normal_hi" stroke={CHART.grey} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line name="Observed max heat index" dataKey="hi_max" stroke={CHART.ink} strokeWidth={1.3} dot={false} isAnimationActive={false} />
            <Scatter name={`z ≥ ${a.z_threshold}`} dataKey="zPoint" fill={CHART.red} shape="circle" isAnimationActive={false} />
            <Scatter name="IsolationForest" dataKey="ifPoint" fill="none" stroke={CHART.sea} strokeWidth={2} shape={<Ring />} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Own legend: Recharts can't draw the hollow-ring marker in its legend */}
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-ink" aria-hidden="true" /> Observed max heat index
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed border-[#8a9ba6]" aria-hidden="true" /> Normal for the date (1991–2020)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-heat-red" aria-hidden="true" /> z ≥ {a.z_threshold}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-sea" aria-hidden="true" /> IsolationForest
        </li>
      </ul>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs leading-tight text-ink-soft">{k}</dt>
            <dd className="text-xl font-bold tabular">{v}</dd>
          </div>
        ))}
      </dl>

      {years.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold">Days at z ≥ {a.z_threshold}, per year</p>
          <div className="mt-2 flex h-20 items-end gap-2">
            {years.map(([y, v]) => (
              <div key={y} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-xs tabular">{v}</span>
                <span className="w-full max-w-10 rounded-t-sm bg-heat-red/80" style={{ height: `${(v / yMax) * 48}px` }} />
                <span className="text-xs text-ink-soft tabular">{y}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Note className="mt-3">
        Two detectors look for days that are unusually hot for their date. The z-score rule is simple statistics: (observed − normal) ÷ the usual
        spread for that date. IsolationForest is an unsupervised ML model that isolates unusual days. A κ of {fmt(s.cohen_kappa)} means they
        partly agree; the days both flag are the strongest anomalies.
      </Note>
    </div>
  )
}

// Hollow ring marker so the two detectors can overlap visibly
function Ring({ cx, cy }) {
  if (cx == null || cy == null) return null
  return <circle cx={cx} cy={cy} r={6} fill="none" stroke="#1d5e86" strokeWidth={2} />
}
