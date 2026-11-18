import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt } from '../../lib/model'
import { CHART, dateRange, shortDate } from '../../lib/chart'
import { Note } from './shared'

const SKILL_LEADS = ['1', '3', '5']

// Real Mumbai heatwaves (station data) as case studies: what happened, and how the forecasts did.
export default function HeatwaveCases({ history: h, selectedStart }) {
  const episodes = h.episodes
  // Default: the longest 2026 episode that has day-by-day forecasts
  const defaultIdx = useMemo(() => {
    let best = -1
    episodes.forEach((e, i) => {
      if (e.daily_lead1?.length && (best < 0 || e.days > episodes[best].days)) best = i
    })
    return best
  }, [episodes])
  const [selected, setSelected] = useState(defaultIdx)
  // The heat calendar can pick an episode (by its start date)
  useEffect(() => {
    if (!selectedStart) return
    const i = episodes.findIndex((e) => e.start === selectedStart)
    if (i >= 0) setSelected(i)
  }, [selectedStart, episodes])
  const ep = episodes[selected]

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-5">
      <div className="min-w-0 lg:col-span-2">
        <p className="text-sm text-ink-soft">
          {episodes.length} heatwaves since {episodes[0]?.start.slice(0, 4)}. Definition: {h.definition} (97th percentile ={' '}
          {fmt(h.p97_tmean_c, 1)} °C at Santacruz). Select one to open it; 2026 heatwaves also show how the forecasts did.
        </p>
        <div className="mt-3 max-h-[26rem] overflow-y-auto rounded border border-line">
          <table className="w-full text-sm tabular">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-ink-soft">
                <th className="px-2 py-1.5 font-medium">Dates</th>
                <th className="px-2 py-1.5 text-right font-medium">Days</th>
                <th className="px-2 py-1.5 text-right font-medium">Peak HI</th>
                <th className="px-2 py-1.5 text-right font-medium">Est. extra deaths</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((e, i) => {
                const canSelect = true
                const active = i === selected
                return (
                  <tr
                    key={e.start}
                    className={`border-b border-line/70 ${active ? 'bg-sea/10 font-semibold' : canSelect ? 'cursor-pointer hover:bg-haze/70' : ''}`}
                    onClick={canSelect ? () => setSelected(i) : undefined}
                  >
                    <td className="px-2 py-1.5">
                      {canSelect ? (
                        <button type="button" className="text-left text-sea underline-offset-2 hover:underline" aria-pressed={active} onClick={() => setSelected(i)}>
                          {dateRange(e.start, e.end)}
                        </button>
                      ) : (
                        dateRange(e.start, e.end)
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">{e.days}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(e.max_heat_index_c, 1)}°</td>
                    <td className="px-2 py-1.5 text-right">
                      {e.extra_deaths_est}
                      <span className="text-ink-soft">
                        {' '}
                        ({e.extra_deaths_ci?.[0]}–{e.extra_deaths_ci?.[1]})
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          <strong className="text-ink">Estimated (Layer 1), not counted.</strong> {h.note} Effect +{fmt(h.effect?.pct_increase, 1)}% per day (CI {fmt(h.effect?.ci?.[0], 1)}–
          {fmt(h.effect?.ci?.[1], 1)}%) × {fmt(h.baseline_daily_deaths, 1)} baseline deaths/day, summed over the episode.
        </p>
      </div>

      <div className="min-w-0 lg:col-span-3">{ep ? <EpisodeDetail key={ep.start} ep={ep} /> : <Note>No 2026 episode has forecast data yet.</Note>}</div>
    </div>
  )
}

function EpisodeDetail({ ep }) {
  const skill = ep.forecast_skill ?? {}
  return (
    <div className="min-w-0">
      <p className="font-bold">
        {dateRange(ep.start, ep.end)}: {ep.days}-day heatwave
      </p>
      <p className="text-sm text-ink-soft tabular">
        Peak heat index {fmt(ep.max_heat_index_c, 1)} °C, peak temperature {fmt(ep.max_tmax_c, 1)} °C. Estimated {ep.extra_deaths_est} extra deaths
        (CI {ep.extra_deaths_ci?.[0]}–{ep.extra_deaths_ci?.[1]}).
      </p>

      {ep.daily_lead1?.length ? (
        <Replay rows={ep.daily_lead1} />
      ) : (
        <p className="mt-3 rounded border border-dashed border-line px-3 py-4 text-sm text-ink-soft">
          This heatwave happened before the 2026 test period. Its days were part of the model's training or validation data, so we don't score
          forecasts on it.
        </p>
      )}

      {Object.keys(skill).length > 0 && (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm tabular">
          <caption className="sr-only">Forecast skill during this heatwave</caption>
          <thead>
            <tr className="border-b border-line text-left text-ink-soft">
              <th className="py-1.5 pr-2 font-medium">Lead</th>
              <th className="py-1.5 pl-2 text-right font-medium">MAE raw</th>
              <th className="py-1.5 pl-2 text-right font-medium">MAE HeatShield</th>
              <th className="py-1.5 pl-2 text-right font-medium">Danger days</th>
              <th className="py-1.5 pl-2 text-right font-medium">Caught raw</th>
              <th className="py-1.5 pl-2 text-right font-medium">Caught HeatShield</th>
            </tr>
          </thead>
          <tbody>
            {SKILL_LEADS.filter((l) => skill[l]).map((l) => {
              const s = skill[l]
              const worse = s.mae_heatshield > s.mae_raw
              return (
                <tr key={l} className="border-b border-line/70">
                  <td className="py-1.5 pr-2">{l} day{l !== '1' ? 's' : ''}</td>
                  <td className="py-1.5 pl-2 text-right">{fmt(s.mae_raw)}</td>
                  <td className={`py-1.5 pl-2 text-right font-semibold ${worse ? 'text-heat-red' : 'text-sea'}`}>
                    {fmt(s.mae_heatshield)}
                    {worse && ' (worse)'}
                  </td>
                  <td className="py-1.5 pl-2 text-right">{s.danger_days}</td>
                  <td className="py-1.5 pl-2 text-right">{s.caught_raw}</td>
                  <td className="py-1.5 pl-2 text-right font-semibold">{s.caught_heatshield}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}
      <Note className="mt-2">
        Both columns are shown as they are.
        {SKILL_LEADS.some((l) => skill[l] && skill[l].mae_heatshield > skill[l].mae_raw) &&
          ' In this heatwave HeatShield has a higher error than the raw model at some lead times, because it pushes forecasts up and can overshoot; check the Danger days it catches alongside.'}
      </Note>
    </div>
  )
}

// Animated replay: the lines draw day by day; the current day is highlighted and the
// Danger-days counter ticks up. Lead = 1 day (forecast made the day before).
function Replay({ rows }) {
  const [step, setStep] = useState(rows.length - 1) // start fully drawn
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    if (step >= rows.length - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setStep((s) => s + 1), 650)
    return () => clearTimeout(t)
  }, [playing, step, rows.length])

  const data = rows.map((r, i) => (i <= step ? r : { date: r.date }))
  const seen = rows.slice(0, step + 1)
  const isDanger = (v) => v != null && v >= 39.4
  const danger = seen.filter((r) => isDanger(r.observed))
  const caughtHS = danger.filter((r) => isDanger(r.corrected)).length
  const caughtRaw = danger.filter((r) => isDanger(r.raw)).length
  const cur = rows[step]

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!playing && step >= rows.length - 1) setStep(0)
            setPlaying((p) => !p)
          }}
          className="flex items-center gap-2 rounded-full bg-ink py-1.5 pr-4 pl-3 text-sm font-semibold text-white hover:bg-sea"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1l10 6-10 6z" fill="currentColor" /></svg>
          )}
          {playing ? 'Pause' : 'Replay this heatwave'}
        </button>
        <p className="text-sm tabular" aria-live="polite">
          Day {step + 1} of {rows.length}, {shortDate(cur.date)}: Danger days so far <strong>{danger.length}</strong>, caught by HeatShield{' '}
          <strong className="text-sea">{caughtHS}</strong>, by raw <strong>{caughtRaw}</strong>
        </p>
      </div>
      <div className="mt-2 h-60 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={CHART.tick} minTickGap={16} tickLine={false} axisLine={{ stroke: CHART.line }} />
            <YAxis
              domain={[Math.floor(Math.min(38, ...rows.flatMap((r) => [r.observed, r.raw, r.corrected]).filter(Number.isFinite)) - 2), Math.ceil(Math.max(...rows.flatMap((r) => [r.observed, r.raw, r.corrected]).filter(Number.isFinite)) + 2)]}
              tickFormatter={(v) => `${v}°`}
              tick={CHART.tick}
              width={44}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip labelFormatter={shortDate} formatter={(v, n) => [`${fmt(v, 1)} °C`, n]} contentStyle={CHART.tooltip} />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <ReferenceLine y={39.4} stroke={CHART.danger} strokeDasharray="5 4" label={{ value: 'Danger', position: 'insideTopLeft', fontSize: 11, fill: CHART.danger }} />
            <ReferenceLine x={cur.date} stroke={CHART.ink} strokeOpacity={0.25} strokeWidth={10} />
            <Line name="Observed" dataKey="observed" stroke={CHART.ink} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls={false} />
            <Line name="Raw, 1 day ahead" dataKey="raw" stroke={CHART.grey} strokeDasharray="6 4" strokeWidth={1.8} dot={{ r: 2.5 }} isAnimationActive={false} />
            <Line name="HeatShield, 1 day ahead" dataKey="corrected" stroke={CHART.sea} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
            {cur.observed != null && <ReferenceDot x={cur.date} y={cur.observed} r={6} fill={CHART.ink} stroke="#fff" strokeWidth={2} />}
            {cur.corrected != null && <ReferenceDot x={cur.date} y={cur.corrected} r={6} fill={CHART.sea} stroke="#fff" strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
