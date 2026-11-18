import WardRadar from './WardRadar'
import { fmtNum, fmtPct, fmtTemp, riskHex, riskLabel } from '../lib/heat'

// Right-hand side of the map: either the selected ward's numbers,
// or (when nothing is selected) the wards with the highest risk today.
export default function WardDetails({ wards, selectedId, onSelect }) {
  const features = wards.features.map((f) => f.properties)
  const selected = features.find((p) => p.ward_id === selectedId)
  const total = features.length

  if (!selected) {
    const top = [...features].sort((a, b) => (b.risk_today ?? 0) - (a.risk_today ?? 0)).slice(0, 6)
    return (
      <div>
        <h3 className="font-bold">Highest risk today</h3>
        <p className="mt-1 text-sm text-ink-soft">Risk = today's city-wide heat hazard × the ward's vulnerability. Select a ward on the map, or below.</p>
        <ol className="mt-3 divide-y divide-line border-y border-line">
          {top.map((p) => (
            <li key={p.ward_id}>
              <button
                type="button"
                onClick={() => onSelect(p.ward_id)}
                className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-haze/60"
              >
                <span className="h-4 w-4 shrink-0 rounded-sm border border-ink/20" style={{ background: riskHex(p.risk_level) }} aria-hidden="true" />
                <span className="flex-1">
                  <span className="font-semibold">{p.ward_id}</span>
                  {/* ward_name may already start with the code ("C (Kalbadevi)"), so don't repeat it */}
                  {p.ward_name && <span className="text-ink-soft"> {p.ward_name.startsWith(p.ward_id) ? p.ward_name.slice(p.ward_id.length).trim() : p.ward_name}</span>}
                </span>
                <span className="text-sm text-ink-soft">{riskLabel(p.risk_level)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  const rows = [
    ['Heat vulnerability index', fmtNum(selected.hvi, 2), `rank ${selected.hvi_rank} of ${total}`],
    ['Vulnerability group', selected.cluster_label || '–', 'k-means cluster'],
    ['Summer land surface temp.', fmtTemp(selected.lst_summer_c) + 'C', 'Landsat, median'],
    ['Green cover (NDVI)', fmtNum(selected.ndvi_summer, 2), 'higher = greener'],
    ['Population density', fmtNum(selected.pop_density), 'people per km²'],
    ['Slum population', fmtPct(selected.slum_share), 'Census 2011'],
    ['Workers', fmtPct(selected.worker_share), 'share of population'],
    ['Risk score today', fmtNum(selected.risk_today, 2), riskLabel(selected.risk_level)],
  ]

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-extrabold leading-tight">Ward {selected.ward_id}</h3>
          {selected.ward_name && <p className="text-ink-soft">{selected.ward_name}</p>}
        </div>
        <span
          className="mt-1 rounded-sm px-2 py-0.5 text-sm font-semibold"
          style={{
            background: riskHex(selected.risk_level),
            color: ['high', 'very_high'].includes(selected.risk_level) ? '#fff' : '#0e2a3b',
          }}
        >
          {riskLabel(selected.risk_level)} risk
        </span>
      </div>

      <WardRadar wards={wards} ward={selected} />

      <dl className="mt-3 divide-y divide-line border-y border-line text-sm">
        {rows.map(([label, value, hint]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-2">
            <dt>
              {label}
              <span className="block text-xs text-ink-soft">{hint}</span>
            </dt>
            <dd className="text-base font-bold tabular">{value}</dd>
          </div>
        ))}
      </dl>

      <button type="button" onClick={() => onSelect(null)} className="mt-3 text-sm font-semibold text-sea hover:underline">
        Show highest-risk wards
      </button>
    </div>
  )
}
