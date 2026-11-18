import { FINAL_METHOD, alertCounts, fmt, metric, modelName, pctOf } from '../../lib/model'
import { dateRange } from '../../lib/chart'
import CountUp from '../CountUp'

// The headline numbers: everything is computed from the /model report, nothing typed in.
export default function KpiTiles({ corrector: c }) {
  const raw = metric(c.metrics, 'A_raw_forecast')
  const fin = metric(c.metrics, FINAL_METHOD)
  const reduction = (1 - fin.mae / raw.mae) * 100
  const ar = alertCounts(c.alerts, 'A_raw_forecast')
  const af = alertCounts(c.alerts, FINAL_METHOD)
  const observed = c.alerts.observed_danger_days
  const rawName = modelName(c.primary_raw_model)

  const tiles = [
    {
      label: 'Forecast error (MAE)',
      before: `${fmt(raw.mae)} °C`,
      after: <CountUp value={fin.mae} digits={2} suffix=" °C" />,
      note: <><CountUp value={Math.round(reduction)} suffix="%" className="font-bold" /> lower than the raw {rawName} forecast</>,
    },
    {
      label: 'Danger days caught (recall)',
      before: pctOf(ar.recall),
      after: <CountUp value={Math.round(af.recall * 100)} suffix="%" />,
      note: `Misses ${af.missed} of ${observed} Danger days, instead of ${ar.missed}`,
    },
    {
      label: 'Danger alert F1 score',
      before: fmt(ar.f1),
      after: <CountUp value={af.f1} digits={2} />,
      note: 'Balances caught days against false alarms',
    },
    {
      label: 'Unseen test set',
      after: <CountUp value={c.n_test_rows} />,
      note: `Forecasts for ${dateRange(c.test_period[0], c.test_period[1])}, leads 1–5 days`,
    },
  ]

  return (
    <div>
      <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {tiles.map((t, i) => (
          <div key={t.label} className={`min-w-0 py-4 sm:px-5 ${i % 2 === 1 ? 'sm:border-l sm:border-line lg:border-l-0' : ''} ${i > 1 ? 'sm:border-t sm:border-line lg:border-t-0' : ''} lg:first:pl-0`}>
            <dt className="text-sm text-ink-soft">{t.label}</dt>
            <dd className="mt-1">
              {t.before && (
                <span className="mr-2 text-lg font-semibold text-ink-soft tabular line-through decoration-1" title="Raw forecast">
                  {t.before}
                </span>
              )}
              <span className="text-3xl font-extrabold leading-none tabular text-sea sm:text-4xl">{t.after}</span>
              <span className="mt-1.5 block text-sm leading-snug">{t.note}</span>
            </dd>
          </div>
        ))}
      </dl>

      {/* The honest part: precision gets worse */}
      <p className="mt-4 max-w-[80ch] border-l-4 border-heat-yellow bg-heat-yellow/10 px-3 py-2 text-sm">
        <strong>The trade-off:</strong> precision drops from {pctOf(ar.precision)} to {pctOf(af.precision)}. HeatShield issues{' '}
        {af.predicted_danger_days} Danger alerts where the raw forecast issued {ar.predicted_danger_days}, so it raises more false alarms (
        {af.falseAlarms} vs {ar.falseAlarms}). In exchange it misses far fewer dangerous days ({af.missed} vs {ar.missed} of {observed}), because
        the raw model runs about {fmt(Math.abs(raw.bias), 1)} °C too cool. For a heat warning, a missed dangerous day costs more than a false alarm.
      </p>
      <p className="mt-2 text-xs text-ink-soft">
        Strikethrough = raw {rawName} forecast; blue = HeatShield. Trained on {dateRange(c.train_period[0], c.train_period[1])} (
        {c.n_train_rows.toLocaleString('en-IN')} rows); tested on 2026 only, never shuffled.
      </p>
    </div>
  )
}
