import { HEAT_HEX, HEAT_TEXT_ON, NOAA_BANDS, fmtDay, fmtTemp } from '../lib/heat'
import { Status } from './Panel'

// The hero: 5 "thermometers", one per day, sharing one temperature scale.
// Each fill rises to that day's corrected heat index and takes its NOAA alert colour.
// Dashed lines across all 5 days mark the NOAA thresholds, so the ribbon also reads as a chart.

const SCALE_MIN = 24 // °C at the bottom of the ribbon
const SCALE_MAX = 56 // °C at the top
const pct = (v) => Math.min(100, Math.max(0, ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100))

export default function HeatRibbon({ state }) {
  const { data, loading, slow, error, reload } = state
  return (
    <section aria-labelledby="ribbon-title" className="rounded-md bg-ink text-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
        <h2 id="ribbon-title" className="text-lg font-bold">
          Feels-like heat, next 5 days
        </h2>
        {data && (
          <p className="text-sm text-white/70">
            Heat index at Santacruz, corrected by {data.corrector ?? 'our model'}
          </p>
        )}
      </div>

      {!data ? (
        <div className="px-4 pb-4 sm:px-6">
          <Status loading={loading} slow={slow} error={error} onRetry={reload} what="the forecast" dark />
        </div>
      ) : (
        <Ribbon days={data.days} />
      )}
    </section>
  )
}

function Ribbon({ days }) {
  const thresholds = NOAA_BANDS.map((b) => ({ value: b.from, label: b.label }))
  return (
    <div className="px-2 pb-4 sm:px-6 sm:pb-6">
      {/* Plot area: threshold gutter on the left + 5 day columns */}
      <div className="relative mt-3 flex h-56 sm:h-64">
        <div className="relative w-9 shrink-0 sm:w-36" aria-hidden="true">
          {thresholds.map((t) => (
            <span
              key={t.value}
              className="absolute right-1 -translate-y-1/2 whitespace-nowrap text-[11px] leading-none text-white/60 tabular sm:right-3 sm:text-xs"
              style={{ bottom: `${pct(t.value)}%` }}
            >
              <span className="hidden sm:inline">{t.label} </span>
              {t.value}
            </span>
          ))}
        </div>

        <div className="relative flex-1">
          {/* threshold lines across all days */}
          {thresholds.map((t) => (
            <div
              key={t.value}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-dashed border-white/25"
              style={{ bottom: `${pct(t.value)}%` }}
            />
          ))}

          <ol className="relative grid h-full grid-cols-5 gap-1.5 sm:gap-4">
            {days.map((d, i) => (
              <DayColumn key={d.date} day={d} index={i} />
            ))}
          </ol>
        </div>
      </div>

      {/* Details under each column */}
      <div className="flex">
        <div className="w-9 shrink-0 sm:w-36" />
        <ol className="grid flex-1 grid-cols-5 gap-1.5 sm:gap-4">
          {days.map((d) => (
            <DayDetails key={d.date} day={d} />
          ))}
        </ol>
      </div>
    </div>
  )
}

function DayColumn({ day, index }) {
  const value = day.heat_index_corrected_c ?? day.heat_index_raw_c
  const color = day.alert?.color ?? 'green'
  const height = value == null ? 0 : pct(value)
  return (
    <li className="relative flex h-full flex-col justify-end" aria-label={`${fmtDay(day.date)}: heat index ${fmtTemp(value)}C, ${day.alert?.label ?? 'no alert'}`}>
      {/* the value sits just above the top of the fill */}
      <span
        className="absolute inset-x-0 text-center text-lg font-extrabold leading-none tabular sm:text-3xl"
        style={{ bottom: `calc(${height}% + 6px)` }}
      >
        {fmtTemp(value)}
      </span>
      <div
        className="ribbon-fill mx-auto w-full rounded-t-sm sm:w-4/5"
        style={{ height: `${height}%`, background: HEAT_HEX[color], animationDelay: `${index * 90}ms` }}
      />
    </li>
  )
}

function DayDetails({ day }) {
  const color = day.alert?.color ?? 'green'
  return (
    <li className="pt-2 text-center sm:text-left">
      <p className="text-sm font-bold leading-tight sm:text-base">{fmtDay(day.date)}</p>
      <p
        className="mt-1 inline-block rounded-sm px-1 py-0.5 text-[11px] font-semibold leading-tight sm:px-1.5 sm:text-xs"
        style={{ background: HEAT_HEX[color], color: HEAT_TEXT_ON[color] }}
      >
        {day.alert?.label ?? 'No alert'}
      </p>
      <dl className="mt-1.5 hidden space-y-0.5 text-xs text-white/75 sm:block">
        <div className="flex justify-between gap-2">
          <dt>WBGT (shade)</dt>
          <dd className="tabular text-white">{fmtTemp(day.wbgt_c)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Raw forecast</dt>
          <dd className="tabular text-white">{fmtTemp(day.heat_index_raw_c)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Normal for date</dt>
          <dd className="tabular text-white">{fmtTemp(day.normal_heat_index_c)}</dd>
        </div>
        {day.imd_alert && (
          <div className="flex justify-between gap-2">
            <dt>IMD band</dt>
            <dd className="text-white">{day.imd_alert.label}</dd>
          </div>
        )}
      </dl>
      {/* compact version for phones */}
      <p className="mt-1 text-[11px] leading-tight text-white/75 sm:hidden">
        WBGT {fmtTemp(day.wbgt_c)}
        {day.imd_alert && <span className="block">IMD {day.imd_alert.label}</span>}
      </p>
      {day.is_anomaly && (
        <p className="mt-1.5 text-[11px] font-semibold leading-tight text-heat-yellow sm:text-xs" title={`z-score ${day.anomaly_z?.toFixed(1)} versus the 1991–2020 normal`}>
          Unusually hot for the date
          <span className="hidden sm:inline"> (z {day.anomaly_z?.toFixed(1)})</span>
        </p>
      )}
    </li>
  )
}
