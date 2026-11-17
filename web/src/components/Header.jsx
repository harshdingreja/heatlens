import { fmtLongDate } from '../lib/heat'

// Top of the page: name, what it is, and how fresh the data is.
export default function Header({ forecast }) {
  return (
    <header className="flex flex-col gap-4 pt-6 pb-5 sm:flex-row sm:items-end sm:justify-between sm:pt-10">
      <div>
        <div className="flex items-center gap-3">
          <Thermometer />
          <h1 className="text-3xl font-extrabold leading-none tracking-tight sm:text-4xl">HeatShield</h1>
          <span className="rounded border border-ink/30 px-2 py-0.5 text-xs font-semibold text-ink-soft" title="Smart India Hackathon 2026 problem statement">
            SIH26083
          </span>
        </div>
        <p className="mt-2 max-w-xl text-base text-ink-soft sm:text-lg">
          Mumbai heat-stress early warning: how hot it will <em className="not-italic font-semibold text-ink">feel</em> over the next 5 days, and which wards are most at risk.
        </p>
      </div>

      {forecast && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:text-right">
          <dt className="text-ink-soft">Forecast issued</dt>
          <dd className="font-semibold tabular">{fmtLongDate(forecast.issued)}</dd>
          <dt className="text-ink-soft">Station data up to</dt>
          <dd className="font-semibold tabular">{fmtLongDate(forecast.obs_latest_date)}</dd>
        </dl>
      )}
    </header>
  )
}

function Thermometer() {
  return (
    <svg width="28" height="40" viewBox="0 0 28 40" aria-hidden="true" className="shrink-0">
      <rect x="9" y="2" width="10" height="26" rx="5" fill="none" stroke="#0e2a3b" strokeWidth="2.5" />
      <rect x="12" y="12" width="4" height="16" fill="#e06c1f" />
      <circle cx="14" cy="31" r="7" fill="#e06c1f" stroke="#0e2a3b" strokeWidth="2.5" />
    </svg>
  )
}
