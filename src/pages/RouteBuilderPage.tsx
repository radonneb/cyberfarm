import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import type { GeoJsonObject } from 'geojson'
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet'
import { useMapLayers } from '../appHelpers'
import type { RoutePlanConfig, RoutePointConfig } from '../models/taskData'
import { uid } from '../models/taskData'
import { useAppStore } from '../store/appStore'

function delimiterFor(line: string) {
  const candidates = [',', ';', '\t']
  return candidates.sort((a, b) => line.split(b).length - line.split(a).length)[0]
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-zа-я0-9]+/gi, '')
}

function findColumn(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.some((name) => header.includes(name)))
}

function parseCoordinate(value: string) {
  const parsed = Number(value.trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseRouteFile(text: string, fileName: string): RoutePlanConfig {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('The route table is empty.')
  const delimiter = delimiterFor(lines[0])
  const rows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, '')))
  const headers = rows[0].map(normalizeHeader)
  const latitudeIndex = findColumn(headers, ['latitude', 'lat', 'широта', 'enlem'])
  const longitudeIndex = findColumn(headers, ['longitude', 'lon', 'lng', 'долгота', 'uzunluq'])
  const dateIndex = findColumn(headers, ['datetime', 'timestamp', 'date', 'time', 'дата', 'время', 'tarix', 'vaxt'])
  const labelIndex = findColumn(headers, ['name', 'machine', 'model', 'tractor', 'название', 'трактор', 'модель'])
  if (latitudeIndex < 0 || longitudeIndex < 0) {
    throw new Error('Latitude and longitude columns were not found. Use headers such as Latitude and Longitude.')
  }

  const points: RoutePointConfig[] = []
  for (const row of rows.slice(1)) {
    const latitude = parseCoordinate(row[latitudeIndex] ?? '')
    const longitude = parseCoordinate(row[longitudeIndex] ?? '')
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue
    const rawDate = dateIndex >= 0 ? row[dateIndex] : ''
    const parsedDate = rawDate ? new Date(rawDate) : null
    points.push({
      id: uid(),
      latitude,
      longitude,
      timestamp: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : rawDate || undefined,
      label: labelIndex >= 0 ? row[labelIndex] || undefined : undefined,
    })
  }
  if (points.length < 2) throw new Error('At least two valid route points are required.')
  if (points.length > 25_000) throw new Error('The route contains more than 25,000 points. Split the table into smaller files.')
  return {
    id: uid(),
    name: fileName.replace(/\.[^.]+$/, '') || 'Machine route',
    points,
    gapMinutes: 120,
    createdAt: new Date().toISOString(),
  }
}

function metersBetween(a: RoutePointConfig, b: RoutePointConfig) {
  const radius = 6_371_000
  const lat1 = (a.latitude * Math.PI) / 180
  const lat2 = (b.latitude * Math.PI) / 180
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180
  const deltaLon = ((b.longitude - a.longitude) * Math.PI) / 180
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function splitRoute(points: RoutePointConfig[], gapMinutes: number) {
  const segments: RoutePointConfig[][] = []
  for (const point of points) {
    const segment = segments[segments.length - 1]
    if (!segment) {
      segments.push([point])
      continue
    }
    const previous = segment[segment.length - 1]
    const previousTime = previous.timestamp ? new Date(previous.timestamp).getTime() : Number.NaN
    const pointTime = point.timestamp ? new Date(point.timestamp).getTime() : Number.NaN
    const gap = Number.isFinite(previousTime) && Number.isFinite(pointTime)
      ? Math.abs(pointTime - previousTime) / 60_000
      : 0
    if (gap > gapMinutes) segments.push([point])
    else segment.push(point)
  }
  return segments.filter((segment) => segment.length > 1)
}

function FitRoute({ positions }: { positions: LatLngExpression[] }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(L.latLngBounds(positions), { padding: [28, 28] })
  }, [map, positions])
  return null
}

export default function RouteBuilderPage() {
  const { loadedTaskData, selectedFieldId, setSelectedFieldId, updateTaskData, setErrorMessage } = useAppStore()
  const { polygonLayer, guidanceLayer } = useMapLayers()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const routes = loadedTaskData?.tools?.routes ?? []
  const fields = loadedTaskData?.fields ?? []
  const [activeRouteId, setActiveRouteId] = useState<string | null>(routes[0]?.id ?? null)
  const activeRoute = routes.find((route) => route.id === activeRouteId) ?? routes[0] ?? null
  const segments = useMemo(() => activeRoute ? splitRoute(activeRoute.points, activeRoute.gapMinutes) : [], [activeRoute])
  const positions = useMemo<LatLngExpression[]>(() => activeRoute?.points.map((point) => [point.latitude, point.longitude]) ?? [], [activeRoute])
  const totalMeters = useMemo(() => activeRoute?.points.reduce((sum, point, index, points) => index ? sum + metersBetween(points[index - 1], point) : 0, 0) ?? 0, [activeRoute])

  const importRoute = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const route = parseRouteFile(await file.text(), file.name)
      updateTaskData((task) => ({
        ...task,
        tools: { ...task.tools, routes: [...(task.tools?.routes ?? []), route] },
      }))
      setActiveRouteId(route.id)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to read route table.')
    }
  }

  const patchRoute = (patch: Partial<RoutePlanConfig>) => {
    if (!activeRoute) return
    updateTaskData((task) => ({
      ...task,
      tools: {
        ...task.tools,
        routes: (task.tools?.routes ?? []).map((route) => route.id === activeRoute.id ? { ...route, ...patch } : route),
      },
    }))
  }

  const convertToGuidance = () => {
    if (!activeRoute || !selectedFieldId) {
      setErrorMessage('Select a route and a destination field first.')
      return
    }
    updateTaskData((task) => ({
      ...task,
      fields: task.fields.map((field) => field.id === selectedFieldId
        ? {
            ...field,
            guidanceLines: [...field.guidanceLines, {
              id: uid(),
              name: activeRoute.name,
              points: activeRoute.points.map((point) => ({
                id: uid(),
                latitude: point.latitude,
                longitude: point.longitude,
              })),
            }],
          }
        : field),
    }))
  }

  const removeRoute = () => {
    if (!activeRoute) return
    updateTaskData((task) => ({
      ...task,
      tools: { ...task.tools, routes: (task.tools?.routes ?? []).filter((route) => route.id !== activeRoute.id) },
    }))
    setActiveRouteId(routes.find((route) => route.id !== activeRoute.id)?.id ?? null)
  }

  const fitBounds: LatLngBoundsExpression | null = positions.length > 1 ? L.latLngBounds(positions) : null

  return (
    <div className="route-builder-layout">
      <section className="page-card route-controls-panel scroll-panel">
        <div className="section-kicker">Map overview</div>
        <h2 className="section-title">Machine route builder</h2>
        <p className="muted-copy">Load a CSV/TXT position table. The route is drawn in time order and can be converted into a guidance line.</p>
        <button className="primary-btn" onClick={() => fileRef.current?.click()}>Import CSV / TXT</button>
        <input ref={fileRef} type="file" hidden accept=".csv,.txt,text/csv,text/plain" onChange={importRoute} />

        {routes.length > 0 && (
          <>
            <label className="form-label">Saved route</label>
            <select className="text-input" value={activeRoute?.id ?? ''} onChange={(event) => setActiveRouteId(event.target.value)}>
              {routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
            </select>
          </>
        )}

        {activeRoute ? (
          <div className="route-settings">
            <label className="form-label">Route name</label>
            <input className="text-input" value={activeRoute.name} onChange={(event) => patchRoute({ name: event.target.value })} />
            <label className="form-label">Split after time gap</label>
            <select className="text-input" value={activeRoute.gapMinutes} onChange={(event) => patchRoute({ gapMinutes: Number(event.target.value) })}>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="360">6 hours</option>
            </select>
            <div className="route-summary-grid">
              <span>Points<strong>{activeRoute.points.length.toLocaleString()}</strong></span>
              <span>Segments<strong>{segments.length}</strong></span>
              <span>Distance<strong>{(totalMeters / 1000).toFixed(2)} km</strong></span>
            </div>
            <label className="form-label">Destination field</label>
            <select className="text-input" value={selectedFieldId ?? ''} onChange={(event) => setSelectedFieldId(event.target.value || null)}>
              <option value="">Select field</option>
              {fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
            </select>
            <button className="ghost-btn" onClick={convertToGuidance} disabled={!selectedFieldId}>Route → guidance line</button>
            <button className="danger-btn" onClick={removeRoute}>Delete route</button>
          </div>
        ) : <div className="empty-panel small">No machine route loaded.</div>}
      </section>

      <section className="page-card route-map-card">
        <MapContainer center={[40.4093, 49.8671]} zoom={12} style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {polygonLayer && <GeoJSON data={polygonLayer as GeoJsonObject} style={{ color: '#72d69a', weight: 2, fillOpacity: 0.04 }} />}
          {guidanceLayer && <GeoJSON data={guidanceLayer as GeoJsonObject} style={{ color: '#4f8cff', weight: 2 }} />}
          {segments.map((segment, index) => (
            <Polyline key={index} positions={segment.map((point) => [point.latitude, point.longitude])} pathOptions={{ color: index % 2 ? '#9a7cff' : '#2f7df6', weight: 3, opacity: 0.9 }} />
          ))}
          {activeRoute?.points.filter((_, index) => index % Math.max(1, Math.ceil(activeRoute.points.length / 350)) === 0).map((point) => (
            <CircleMarker key={point.id} center={[point.latitude, point.longitude]} radius={2.5} pathOptions={{ color: '#ff7ac8', fillOpacity: 0.9 }} />
          ))}
          {fitBounds && <FitRoute positions={positions} />}
        </MapContainer>
      </section>
    </div>
  )
}
