import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, fmtP, mcapLabel, pctOf } from '../../lib/model'
import { CHART } from '../../lib/chart'
import { Note } from './shared'

// Choosing k for k-means (elbow + silhouette), and checking our ward ranking against BMC's MCAP report.
export default function ClusterChart({ wards: w }) {
  const mcap = Object.entries(w.mcap ?? {})
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="font-bold">Choosing the number of clusters</p>
        <div className="mt-2 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={w.k_scan} margin={{ top: 22, right: 0, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={CHART.line} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="k" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.line }} label={{ value: 'k', position: 'insideBottomRight', offset: -2, fontSize: 12, fill: CHART.soft }} />
              <YAxis yAxisId="inertia" tick={CHART.tick} width={44} tickLine={false} axisLine={false} />
              <YAxis yAxisId="sil" orientation="right" domain={[0, 'auto']} tick={CHART.tick} width={40} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(2)} />
              <Tooltip formatter={(v, n) => [fmt(v, 3), n]} labelFormatter={(k) => `k = ${k}`} contentStyle={CHART.tooltip} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              <ReferenceLine yAxisId="inertia" x={w.chosen_k} stroke={CHART.ink} strokeDasharray="4 3" label={{ value: `chosen k = ${w.chosen_k}`, position: 'top', fontSize: 11, fill: CHART.ink }} />
              <Line yAxisId="inertia" name="Inertia (elbow)" dataKey="inertia" stroke={CHART.grey} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line yAxisId="sil" name="Silhouette (higher = better)" dataKey="silhouette" stroke={CHART.sea} strokeWidth={2.5} dot={{ r: 3.5 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Stat k="Wards clustered" v={w.n_wards} />
          <Stat k={`Silhouette at k = ${w.chosen_k}`} v={fmt(w.silhouette, 3)} />
          <Stat k="PC1 explains" v={w.explained_variance_ratio?.[0] != null ? pctOf(w.explained_variance_ratio[0]) : '–'} />
          <Stat k="Equal vs PCA weights, ranking ρ" v={fmt(w.spearman_equal_vs_pca, 3)} />
        </dl>
        {w.cluster_sizes && (
          <p className="mt-3 text-sm text-ink-soft">
            Cluster sizes:{' '}
            {Object.entries(w.cluster_sizes)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ')}
            .
          </p>
        )}
      </div>

      <div className="min-w-0">
        <p className="font-bold">Cross-check with BMC's Climate Action Plan</p>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {mcap.map(([k, r]) => {
            const agrees = r.spearman_rho > 0 && r.spearman_p < 0.05
            return (
              <li key={k} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0 text-sm">
                  {mcapLabel(k)}
                  <span className="block text-xs text-ink-soft tabular">
                    Spearman ρ = {fmt(r.spearman_rho)}, {fmtP(r.spearman_p)}, n = {r.n}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-semibold ${
                    agrees ? 'bg-heat-green/15 text-heat-green' : 'bg-heat-red/10 text-heat-red'
                  }`}
                >
                  {agrees ? 'Agrees' : 'Does not agree'}
                </span>
              </li>
            )
          })}
        </ul>
        <Note className="mt-3">
          Our satellite heat ranking matches MCAP's closely. MCAP's roofing-material ranking does not match our overall vulnerability index, but it
          does track our slum-share indicator: roofing measures housing material, while our index also weighs heat, greenery and density. We show
          the mismatch rather than hide it.
        </Note>
        <p className="mt-2 text-xs text-ink-soft">Source: {w.mcap_reference}</p>
      </div>
    </div>
  )
}

function Stat({ k, v }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs leading-tight text-ink-soft">{k}</dt>
      <dd className="text-lg font-bold tabular">{v}</dd>
    </div>
  )
}
