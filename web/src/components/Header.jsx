import { fmtLongDate } from '../lib/heat'
import Logo from './Logo'

// Top of the page: name, what it is, and how fresh the data is (in plain words).
export default function Header({ forecast }) {
  return (
    <header className="flex flex-col gap-4 pt-6 pb-6 sm:flex-row sm:items-end sm:justify-between sm:pt-8">
      <div>
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <h1 className="text-3xl font-extrabold leading-none tracking-tight sm:text-4xl">HeatLens</h1>
          <span className="rounded border border-ink/30 px-2 py-0.5 text-xs font-semibold text-ink-soft" title="Smart India Hackathon 2026 problem statement">
            SIH26083
          </span>
        </div>
        <p className="mt-2 max-w-xl text-base text-ink-soft sm:text-lg">
          Forecasting how hot Mumbai will feel, and which wards it will hit hardest.
        </p>
      </div>

      {forecast && (
        <div className="text-sm sm:text-right">
          <p>
            <span className="text-ink-soft">Forecast updated </span>
            <strong className="tabular">{fmtLongDate(forecast.issued)}</strong>
          </p>
          {forecast.obs_latest_date && (
            <p className="mt-0.5 text-ink-soft" title="Weather-station readings are published by NOAA a few days after they are taken">
              Latest weather-station reading: <span className="font-semibold text-ink tabular">{fmtLongDate(forecast.obs_latest_date)}</span>
              <span className="block text-xs">station data arrives a few days late</span>
            </p>
          )}
        </div>
      )}
    </header>
  )
}
