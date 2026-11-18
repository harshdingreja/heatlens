import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre v6 runs map work in a module Web Worker. Vite bundles that worker and gives us its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { RISK_LEVELS, riskLabel } from '../lib/heat'

setWorkerUrl(workerUrl)

// Free basemap, no API key (OpenFreeMap, OpenStreetMap data). Attribution comes with the style.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const RISK_COLOR = ['match', ['get', 'risk_level'], ...RISK_LEVELS.flatMap((r) => [r.key, r.hex]), '#d5dde1']

// 3D map: each ward is extruded; height ∝ heat vulnerability (HVI), colour = risk level for the chosen day.
export default function WardMap3D({ wards, selectedId, onSelect, onFail }) {
  const box = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const latest = useRef({ wards, selectedId, onSelect })
  useLayoutEffect(() => {
    latest.current = { wards, selectedId, onSelect }
  })

  // Create the map once
  useEffect(() => {
    let map
    try {
      map = new MapLibreMap({
        container: box.current,
        style: STYLE_URL,
        center: [72.86, 19.08],
        zoom: 10.2,
        pitch: 52,
        bearing: -18,
        maxPitch: 70,
        cooperativeGestures: window.innerWidth < 768, // phones: two fingers to move the map, one to scroll the page
      })
    } catch (err) {
      onFail?.(err)
      return
    }
    mapRef.current = map
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 })
    let hoverId = null

    map.on('error', (e) => {
      // A failed basemap tile is not fatal; a failure before the map ever loads is.
      if (!readyRef.current) onFail?.(e.error)
    })

    map.on('load', () => {
      readyRef.current = true
      map.addSource('wards', { type: 'geojson', data: latest.current.wards, promoteId: 'ward_id' })
      map.addLayer({
        id: 'wards-3d',
        type: 'fill-extrusion',
        source: 'wards',
        paint: {
          'fill-extrusion-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#1d5e86',
            ['boolean', ['feature-state', 'hover'], false],
            '#ffcf70',
            RISK_COLOR,
          ],
          'fill-extrusion-height': ['+', 150, ['*', ['coalesce', ['get', 'hvi'], 0], 3200]],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.88,
        },
      })
      fitToWards(map, latest.current.wards)
      setSelected(map, null, latest.current.selectedId)
    })

    map.on('mousemove', 'wards-3d', (e) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'pointer'
      if (hoverId !== f.id) {
        if (hoverId != null) map.setFeatureState({ source: 'wards', id: hoverId }, { hover: false })
        hoverId = f.id
        map.setFeatureState({ source: 'wards', id: hoverId }, { hover: true })
      }
      const p = f.properties
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<strong>${p.ward_id}</strong> ${p.ward_name?.replace(/^\S+\s*/, '') ?? ''}<br/>Risk: ${riskLabel(p.risk_level)} (${Number(p.risk_today).toFixed(2)})<br/>HVI ${Number(p.hvi).toFixed(2)}, rank ${p.hvi_rank}`,
        )
        .addTo(map)
    })
    map.on('mouseleave', 'wards-3d', () => {
      map.getCanvas().style.cursor = ''
      if (hoverId != null) map.setFeatureState({ source: 'wards', id: hoverId }, { hover: false })
      hoverId = null
      popup.remove()
    })
    map.on('click', 'wards-3d', (e) => {
      const id = e.features?.[0]?.properties?.ward_id
      if (id) latest.current.onSelect(id)
    })

    return () => {
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [onFail])

  // New day -> new risk levels: swap the data, keep the camera
  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) map.getSource('wards')?.setData(wards)
  }, [wards])

  // Highlight the selected ward
  const prevSel = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) setSelected(map, prevSel.current, selectedId)
    prevSel.current = selectedId
  }, [selectedId])

  return <div ref={box} className="h-[380px] w-full sm:h-[520px]" aria-label="3D map of Mumbai wards, height shows heat vulnerability, colour shows risk" role="region" />
}

function setSelected(map, prev, next) {
  if (prev) map.setFeatureState({ source: 'wards', id: prev }, { selected: false })
  if (next) map.setFeatureState({ source: 'wards', id: next }, { selected: true })
}

function fitToWards(map, wards) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0])
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1])
    } else c.forEach(visit)
  }
  wards.features.forEach((f) => visit(f.geometry.coordinates))
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 30, pitch: 52, bearing: -18, duration: 0 })
}
