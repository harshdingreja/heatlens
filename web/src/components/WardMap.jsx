import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { RISK_LEVELS, riskHex } from '../lib/heat'

const MUMBAI_CENTER = [19.07, 72.87]

// Choropleth of Mumbai's BMC wards, coloured by today's ward risk level.
// Clicking a ward selects it; the details appear in <WardDetails>.
export default function WardMap({ wards, selectedId, onSelect, bare = false }) {
  // Leaflet's style function: called once per ward polygon.
  const style = useMemo(
    () => (feature) => {
      const selected = feature.properties.ward_id === selectedId
      return {
        fillColor: riskHex(feature.properties.risk_level),
        fillOpacity: 0.82,
        color: selected ? '#0e2a3b' : '#ffffff',
        weight: selected ? 3 : 1.2,
      }
    },
    [selectedId],
  )

  // Runs once per ward when the layer is created: hover label + click handler.
  const onEachFeature = (feature, layer) => {
    const p = feature.properties
    layer.bindTooltip(p.ward_name || p.ward_id, { sticky: true, className: 'ward-tooltip' })
    layer.on('click', () => onSelect(p.ward_id))
  }

  return (
    <div>
      <div className={bare ? 'h-[380px] sm:h-[520px]' : 'h-[360px] overflow-hidden rounded border border-line sm:h-[520px]'}>
        <MapContainer center={MUMBAI_CENTER} zoom={11} zoomSnap={0.25} scrollWheelZoom={false} className="h-full w-full">
          {/* OpenStreetMap tiles (free, no key). index.css greys them out so the ward colours stand out. */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          {/* key makes React rebuild the layer if new data arrives */}
          <GeoJSON key={wards.features.map((f) => f.properties.risk_level[0]).join('')} data={wards} style={style} onEachFeature={onEachFeature} />
          <FitToWards wards={wards} />
        </MapContainer>
      </div>
      {!bare && <Legend />}
    </div>
  )
}

// Zooms the map so all wards fit. Needs to live inside <MapContainer> to use useMap().
function FitToWards({ wards }) {
  const map = useMap()
  useEffect(() => {
    const bounds = L.geoJSON(wards).getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [8, 8] })
  }, [map, wards])
  return null
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="text-ink-soft">Ward risk today</span>
      {RISK_LEVELS.map((r) => (
        <span key={r.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-sm border border-ink/20" style={{ background: r.hex }} aria-hidden="true" />
          {r.label}
        </span>
      ))}
    </div>
  )
}
