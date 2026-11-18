import {
  CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { HEAT_HEX, NOAA_BANDS, fmtDay, fmtTemp } from '../lib/heat'

// Raw model forecast vs our ML-corrected forecast, with the NOAA bands shaded behind.
export default function ForecastChart({ days }) {
  const rows = days.map((d) => ({
    day: fmtDay(d.date),
    raw: d.heat_index_raw_c,
    corrected: d.heat_index_corrected_c,
    normal: d.normal_heat_index_c,
  }))

  // y-axis range: a little room around the data, always showing at least 26-42 °C
  const values = rows.flatMap((r) => [r.raw, r.corrected, r.normal]).filter((v) => typeof v === 'number')
  const lo = Math.floor(Math.min(26, ...values) - 1)
  const hi = Math.ceil(Math.max(42, ...values) + 2)

  return (
    <div className="h-72 w-full sm:h-80 lg:h-[26rem]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          {NOAA_BANDS.map((b) => (
            <ReferenceArea
              key={b.key}
              y1={Math.max(b.from, lo)}
              y2={Math.min(b.to, hi)}
              fill={HEAT_HEX[b.color]}
              fillOpacity={0.13}
              stroke="none"
              ifOverflow="hidden"
              label={b.from >= lo && b.from < hi ? { value: b.label, position: 'insideTopRight', fontSize: 11, fill: '#4a6070' } : undefined}
            />
          ))}
          <CartesianGrid stroke="#c9d4da" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="day"
            interval={0}
            tickFormatter={(v) => v.replace(',', '').replace(/ \w+$/, '')} // "Wed, 18 Nov" -> "Wed 18"
            tick={{ fontSize: 12, fill: '#4a6070' }}
            tickLine={false}
            axisLine={{ stroke: '#c9d4da' }}
          />
          <YAxis
            domain={[lo, hi]}
            tick={{ fontSize: 12, fill: '#4a6070' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}°`}
            width={48}
          />
          <Tooltip
            formatter={(value, name) => [fmtTemp(value) + 'C', name]}
            contentStyle={{ borderRadius: 4, borderColor: '#c9d4da', fontFamily: 'Mukta, sans-serif' }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Line name="Normal for the date" dataKey="normal" stroke="#8a9ba6" strokeDasharray="2 3" strokeWidth={1.5} dot={false} />
          <Line name="Raw model forecast" dataKey="raw" stroke="#4a6070" strokeDasharray="6 4" strokeWidth={2} dot={{ r: 3 }} />
          <Line name="Corrected (HeatLens)" dataKey="corrected" stroke="#1d5e86" strokeWidth={3} dot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
