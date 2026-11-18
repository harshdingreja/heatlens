import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt } from '../../lib/model'
import { CHART, dateRange, shortDate } from '../../lib/chart'
import { Note } from './shared'

const SKILL_LEADS = ['1', '3', '5']

// Real Mumbai heatwaves (station data) as case studies: what happened, and how the forecasts did.
export default function HeatwaveCases({ history: h }) {
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
  const ep = episodes[selected]

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-5">
      <div className="min-w-0 lg:col-span-2">
        <p className="text-sm text-ink-soft">
          {episodes.length} heatwaves since {episodes[0]?.start.slice(0, 4)}. Definition: {h.definition} (97th percentile ={' '}
          {fmt(h.p97_tmean_c, 1)} °C at Santacruz). Select a 2026 heatwave to see its forecasts.
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
                const canSelect = !!e.daily_lead1?.length
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

      <div className="min-w-0 lg:col-span-3">{ep ? <EpisodeDetail ep={ep} /> : <Note>No 2026 episode has forecast data yet.</Note>}</div>
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

      <div className="mt-3 h-60 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={ep.daily_lead1} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={CHART.tick} minTickGap={16} tickLine={false} axisLine={{ stroke: CHART.line }} />
            <YAxis domain={[(m) => Math.floor(Math.min(m, 38) - 2), (m) => Math.ceil(m + 2)]} tickFormatter={(v) => `${v}°`} tick={CHART.tick} width={44} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={shortDate} formatter={(v, n) => [`${fmt(v, 1)} °C`, n]} contentStyle={CHART.tooltip} />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <ReferenceLine y={39.4} stroke={CHART.danger} strokeDasharray="5 4" label={{ value: 'Danger', position: 'insideTopLeft', fontSize: 11, fill: CHART.danger }} />
            <Line name="Observed" dataKey="observed" stroke={CHART.ink} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            <Line name="Raw, 1 day ahead" dataKey="raw" stroke={CHART.grey} strokeDasharray="6 4" strokeWidth={1.8} dot={{ r: 2.5 }} isAnimationActive={false} />
            <Line name="HeatShield, 1 day ahead" dataKey="corrected" stroke={CHART.sea} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

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
      <Note className="mt-2">
        Both columns are shown as they are.
        {SKILL_LEADS.some((l) => skill[l] && skill[l].mae_heatshield > skill[l].mae_raw) &&
          ' In this heatwave HeatShield has a higher error than the raw model at some lead times, because it pushes forecasts up and can overshoot; check the Danger days it catches alongside.'}
      </Note>
    </div>
  )
}
