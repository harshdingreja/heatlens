import { useRef, useState } from 'react'
import { useInView, useTween } from '../../lib/anim'
import { FINAL_METHOD, METHODS, fmt, metric, methodLabel } from '../../lib/model'
import { CHART } from '../../lib/chart'
import { Note } from './shared'

const LEADS = [1, 2, 3, 4, 5]

// Error by lead time for every method: baselines vs linear vs LightGBM vs the final model.
export default function LeadMaeChart({ corrector: c }) {
  const methods = METHODS.filter((m) => c.metrics.some((x) => x.method === m.key))

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
      <Dumbbell corrector={c} methods={methods} />

      <Note className="mt-2">
        {losses.length === 0
          ? `At every lead time from 1 to 5 days, HeatLens has a lower error than all ${baselines.length} baselines.`
          : `HeatLens does not beat every baseline at lead ${losses.join(', ')} day(s); see the table.`}
        {linGap < 0.05 && ` Linear regression and HeatLens differ by at most ${fmt(linGap)} °C, so their lines overlap.`}
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

// Dumbbell chart: for each lead time, the raw forecast's error (grey) and HeatLens's (blue),
// joined by an arrow. "Show other methods" adds the baselines and single models as small marks.
function Dumbbell({ corrector: c, methods }) {
  const ref = useRef(null)
  const seen = useInView(ref, '-60px')
  const t = useTween(seen ? 1 : 0, 1200) // 0 -> 1: the blue dot slides from raw to HeatLens
  const [others, setOthers] = useState(false)
  const [hover, setHover] = useState(null)
  const rows = LEADS.map((lead) => ({
    lead,
    vals: Object.fromEntries(methods.map((m) => [m.key, metric(c.metrics, m.key, lead)?.mae])),
  }))
  const maxV = Math.ceil(Math.max(...rows.flatMap((r) => Object.values(r.vals)).filter(Number.isFinite)) + 0.3)
  const W = 640
  const L = 70
  const RGT = 20
  const ROW = 46
  const x = (v) => L + (v / maxV) * (W - L - RGT)
  const H = 30 + rows.length * ROW
  const extra = methods.filter((m) => m.key !== 'A_raw_forecast' && m.key !== FINAL_METHOD)

  return (
    <div ref={ref} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-[#8a9ba6]" /> Raw forecast</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-sea" /> HeatLens</span>
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} className="h-4 w-4 accent-[#b4441b]" />
          Show other methods
        </label>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Error by lead time, raw forecast versus HeatLens">
          {/* grid */}
          {Array.from({ length: maxV + 1 }, (_, i) => (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={14} y2={H - 6} stroke="#c9d4da" strokeDasharray="2 4" />
              <text x={x(i)} y={10} fontSize="11" fill="#4a6070" textAnchor="middle">{i} °C</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = 34 + i * ROW
            const raw = r.vals.A_raw_forecast
            const fin = r.vals[FINAL_METHOD]
            const now = raw + (fin - raw) * t
            return (
              <g key={r.lead} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} className="outline-none">
                <rect x={0} y={y - ROW / 2 + 2} width={W} height={ROW - 4} fill={hover === i ? '#e8edef' : 'transparent'} rx="4" />
                <text x={8} y={y} fontSize="13" fontWeight="700" fill="#23150f" dominantBaseline="middle">{r.lead} day{r.lead > 1 ? 's' : ''}</text>
                {others &&
                  extra.map((m) =>
                    Number.isFinite(r.vals[m.key]) ? (
                      <g key={m.key}>
                        <line x1={x(r.vals[m.key])} x2={x(r.vals[m.key])} y1={y - 11} y2={y + 11} stroke={m.color} strokeWidth="3" strokeLinecap="round" />
                      </g>
                    ) : null,
                  )}
                <line x1={x(raw)} x2={x(now) + 7} y1={y} y2={y} stroke="#b4441b" strokeOpacity="0.35" strokeWidth="6" strokeLinecap="round" />
                <circle cx={x(raw)} cy={y} r="8" fill="#8a9ba6" />
                <circle cx={x(now)} cy={y} r="9" fill="#b4441b" stroke="#fff" strokeWidth="2" />
                <text x={x(raw) + 12} y={y - 13} fontSize="11" fill="#4a6070" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(raw)}</text>
                <text x={x(now)} y={y + 22} fontSize="12" fontWeight="700" fill="#b4441b" textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(fin)}</text>
              </g>
            )
          })}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute right-2 z-10 w-60 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg" style={{ top: `${((34 + hover * ROW) / H) * 100}%` }}>
            <p className="mb-1 font-bold">{rows[hover].lead}-day-ahead error (MAE)</p>
            {methods.map((m) => (
              <p key={m.key} className={`flex justify-between gap-2 tabular ${m.key === FINAL_METHOD ? 'font-bold text-sea' : ''}`}>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: m.color }} />{methodLabel(m.key, c.primary_raw_model)}</span>
                <span>{fmt(rows[hover].vals[m.key])}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {others && (
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {extra.map((m) => (
            <span key={m.key} className="flex items-center gap-1.5"><span className="inline-block h-3 w-1 rounded" style={{ background: m.color }} />{methodLabel(m.key)}</span>
          ))}
        </p>
      )}
    </div>
  )
}
