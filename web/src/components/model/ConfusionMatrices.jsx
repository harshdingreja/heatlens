import { levelLabel, modelName, pctOf } from '../../lib/model'
import { Note } from './shared'

// Observed NOAA level (rows) vs predicted level (columns), raw forecast vs HeatLens.
export default function ConfusionMatrices({ corrector: c }) {
  const { labels, raw, corrected } = c.confusion
  const max = Math.max(...raw.flat(), ...corrected.flat())
  // Days forecast at a LOWER level than observed (cells left of the diagonal) = under-warnings
  const under = (m) => m.reduce((a, row, i) => a + row.slice(0, i).reduce((x, y) => x + y, 0), 0)
  return (
    <div className="min-w-0">
      <div className="grid gap-6 lg:grid-cols-2">
        <Matrix title={`Raw ${modelName(c.primary_raw_model)} forecast`} labels={labels} m={raw} max={max} />
        <Matrix title="HeatLens" labels={labels} m={corrected} max={max} />
      </div>
      <Note className="mt-3">
        Rows are what was observed, columns what was forecast; outlined cells on the diagonal are a correct level. Cells left of the diagonal are
        under-warnings: {under(raw)} for the raw forecast, {under(corrected)} for HeatLens.
      </Note>
    </div>
  )
}

function Matrix({ title, labels, m, max }) {
  const total = m.flat().reduce((a, b) => a + b, 0)
  const correct = m.reduce((a, row, i) => a + row[i], 0)
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold">{title}</span>
        <span className="text-sm text-ink-soft tabular">
          Exact level right: <strong className="text-ink">{pctOf(correct / total)}</strong> of {total.toLocaleString('en-IN')}
        </span>
      </figcaption>
      <div className="grid gap-px text-center text-xs tabular sm:text-sm" style={{ gridTemplateColumns: 'minmax(4.5rem, auto) repeat(5, minmax(0, 1fr))' }}>
        <div className="flex items-end p-1 text-left text-[11px] leading-tight text-ink-soft">Observed ↓ Forecast →</div>
        {labels.map((l) => (
          <div key={l} className="flex items-end justify-center p-1 text-[11px] leading-tight text-ink-soft sm:text-xs">
            {levelLabel(l)}
          </div>
        ))}
        {m.map((row, i) => (
          <Row key={labels[i]} label={levelLabel(labels[i])} row={row} i={i} max={max} />
        ))}
      </div>
    </figure>
  )
}

function Row({ label, row, i, max }) {
  return (
    <>
      <div className="flex items-center p-1 text-left text-[11px] leading-tight text-ink-soft sm:text-xs">{label}</div>
      {row.map((v, j) => {
        const a = v === 0 ? 0 : 0.12 + (v / max) * 0.83 // shade by count
        return (
          <div
            key={j}
            className={`flex h-11 items-center justify-center rounded-[2px] ${i === j ? 'ring-2 ring-inset ring-ink' : ''}`}
            style={{ background: v === 0 ? '#f2f5f6' : `rgba(29, 94, 134, ${a})`, color: a > 0.5 ? '#fff' : '#23150f' }}
            title={`Observed ${label}, forecast column ${j + 1}: ${v}`}
          >
            {v === 0 ? <span className="text-ink-soft/50">0</span> : v}
          </div>
        )
      })}
    </>
  )
}
