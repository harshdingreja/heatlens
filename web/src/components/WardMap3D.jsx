import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre v6 runs map work in a module Web Worker. Vite bundles that worker and gives us its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { RISK_LEVELS, riskLabel } from '../lib/heat'

setWorkerUrl(workerUrl)

// Free basemap, no API key (OpenFreeMap, OpenStreetMap data). Attribution comes with the style.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty' // detailed street map: water, parks, roads, places
const RISK_COLOR = ['match', ['get', 'risk_level'], ...RISK_LEVELS.flatMap((r) => [r.key, r.hex]), '#d5dde1']

// Ward map: each ward is shaded by its risk level for the chosen day, semi-transparent so the real
// city (streets, parks, water, place names) shows through. Flat, north-up view fitted to Mumbai.
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
        pitch: 0,
        bearing: 0,
        maxPitch: 0,          // keep it flat: easier to read than a tilted 3D view
        dragRotate: false,
        minZoom: 9,
        cooperativeGestures: window.innerWidth < 768, // phones: two fingers to move the map, one to scroll the page
      })
    } catch (err) {
      onFail?.(err)
      return
    }
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.touchZoomRotate.disableRotation()
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 })
    let hoverId = null

    map.on('error', (e) => {
      // A failed basemap tile is not fatal; a failure before the map ever loads is.
      if (!readyRef.current) onFail?.(e.error)
    })

    map.on('load', () => {
      readyRef.current = true
      map.addSource('wards', { type: 'geojson', data: latest.current.wards, promoteId: 'ward_id' })
      // Put the ward layers under the basemap's labels so street and place names stay readable
      const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
      map.addLayer({
        id: 'wards-3d',
        type: 'fill',
        source: 'wards',
        paint: {
          'fill-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#1d5e86', RISK_COLOR],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, ['boolean', ['feature-state', 'selected'], false], 0.7, 0.55],
        },
      }, firstLabel)
      map.addLayer({
        id: 'wards-outline',
        type: 'line',
        source: 'wards',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#0e2a3b', '#ffffff'],
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, ['boolean', ['feature-state', 'hover'], false], 2.5, 1.2],
        },
      }, firstLabel)
      // Ward codes (A, F/N, K/E ...) on top
      map.addLayer({
        id: 'wards-labels',
        type: 'symbol',
        source: 'wards',
        layout: { 'text-field': ['get', 'ward_id'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': false },
        paint: { 'text-color': '#0e2a3b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
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

  return <div ref={box} className="h-[440px] w-full sm:h-[600px]" aria-label="Map of Mumbai wards, colour shows heat risk" role="region" />
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
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 20, duration: 0 })
}
