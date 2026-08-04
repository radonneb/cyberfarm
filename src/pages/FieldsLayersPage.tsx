import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GeoJSON, ImageOverlay, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { fromArrayBuffer } from 'geotiff'
import type { GeoJsonObject } from 'geojson'
import type { LatLngBoundsExpression } from 'leaflet'
import { useMapLayers } from '../appHelpers'
import type { MapLayerConfig } from '../models/taskData'
import { uid } from '../models/taskData'
import { apiRequest } from '../services/api'
import { useAppStore } from '../store/appStore'
import { parseImportedFile } from '../utils/importers'

type RuntimeLayer = {
  vector?: GeoJsonObject
  guidance?: GeoJsonObject | null
  rasterUrl?: string
  rasterBounds?: LatLngBoundsExpression
  error?: string
  loading?: boolean
}

type Props = {
  projectId: string | null
  farmId: string | null
  canManage: boolean
}

function extension(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function isRasterName(name: string) {
  return ['tif', 'tiff'].includes(extension(name))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function webMercatorToWgs84(x: number, y: number) {
  return {
    longitude: (x / 20_037_508.34) * 180,
    latitude: (Math.atan(Math.exp((y / 20_037_508.34) * Math.PI)) * 360) / Math.PI - 90,
  }
}

function utmToWgs84(easting: number, northing: number, zone: number, north = true) {
  const a = 6_378_137
  const eccentricity = 0.08181919084262149
  const e1sq = 0.006739496742276434
  const k0 = 0.9996
  const x = easting - 500_000
  const y = north ? northing : northing - 10_000_000
  const arc = y / k0
  const mu = arc / (a * (1 - eccentricity ** 2 / 4 - 3 * eccentricity ** 4 / 64 - 5 * eccentricity ** 6 / 256))
  const e1 = (1 - Math.sqrt(1 - eccentricity ** 2)) / (1 + Math.sqrt(1 - eccentricity ** 2))
  const footprint = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
  const sin = Math.sin(footprint)
  const cos = Math.cos(footprint)
  const tan = Math.tan(footprint)
  const c1 = e1sq * cos ** 2
  const t1 = tan ** 2
  const n1 = a / Math.sqrt(1 - eccentricity ** 2 * sin ** 2)
  const r1 = a * (1 - eccentricity ** 2) / (1 - eccentricity ** 2 * sin ** 2) ** 1.5
  const d = x / (n1 * k0)
  const latitude = footprint - (n1 * tan / r1) * (
    d ** 2 / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * e1sq) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * e1sq - 3 * c1 ** 2) * d ** 6 / 720
  )
  const longitude = (
    d
    - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * e1sq + 24 * t1 ** 2) * d ** 5 / 120
  ) / cos
  return {
    latitude: (latitude * 180) / Math.PI,
    longitude: zone * 6 - 183 + (longitude * 180) / Math.PI,
  }
}

function transformCoordinate(x: number, y: number, epsg: number | undefined) {
  if (!epsg || epsg === 4326 || epsg === 4258) return { longitude: x, latitude: y }
  if (epsg === 3857) return webMercatorToWgs84(x, y)
  if (epsg >= 32601 && epsg <= 32660) return utmToWgs84(x, y, epsg - 32600, true)
  if (epsg >= 32701 && epsg <= 32760) return utmToWgs84(x, y, epsg - 32700, false)
  throw new Error(`GeoTIFF CRS EPSG:${epsg} is not supported yet.`)
}

async function renderGeoTiff(file: File) {
  const tiff = await fromArrayBuffer(await file.arrayBuffer())
  const image = await tiff.getImage()
  const sourceWidth = image.getWidth()
  const sourceHeight = image.getHeight()
  const ratio = Math.min(1, 1200 / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * ratio))
  const height = Math.max(1, Math.round(sourceHeight * ratio))
  const samples = Math.max(1, image.getSamplesPerPixel())
  const raster = await image.readRasters({ width, height, interleave: true }) as unknown as ArrayLike<number>
  const bands = Math.min(samples, 3)
  const minima = Array.from({ length: bands }, () => Number.POSITIVE_INFINITY)
  const maxima = Array.from({ length: bands }, () => Number.NEGATIVE_INFINITY)
  const sampleStep = Math.max(1, Math.floor((width * height) / 80_000))
  for (let pixel = 0; pixel < width * height; pixel += sampleStep) {
    for (let band = 0; band < bands; band += 1) {
      const value = Number(raster[pixel * samples + band])
      if (!Number.isFinite(value)) continue
      minima[band] = Math.min(minima[band], value)
      maxima[band] = Math.max(maxima[band], value)
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create GeoTIFF canvas.')
  const pixels = context.createImageData(width, height)
  const normalize = (value: number, band: number) => {
    const range = maxima[band] - minima[band]
    return range > 0 ? clamp((value - minima[band]) / range, 0, 1) : 0.5
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const target = pixel * 4
    if (bands >= 3) {
      pixels.data[target] = Math.round(normalize(Number(raster[pixel * samples]), 0) * 255)
      pixels.data[target + 1] = Math.round(normalize(Number(raster[pixel * samples + 1]), 1) * 255)
      pixels.data[target + 2] = Math.round(normalize(Number(raster[pixel * samples + 2]), 2) * 255)
    } else {
      const value = normalize(Number(raster[pixel * samples]), 0)
      pixels.data[target] = Math.round(255 * clamp(1.7 - value * 1.8, 0, 1))
      pixels.data[target + 1] = Math.round(255 * clamp(value * 1.45, 0, 1))
      pixels.data[target + 2] = Math.round(105 * clamp(0.7 - Math.abs(value - 0.5), 0, 1))
    }
    pixels.data[target + 3] = 255
  }
  context.putImageData(pixels, 0, 0)

  const [minX, minY, maxX, maxY] = image.getBoundingBox()
  const geoKeys = image.getGeoKeys() as { ProjectedCSTypeGeoKey?: number; GeographicTypeGeoKey?: number }
  const epsg = geoKeys.ProjectedCSTypeGeoKey ?? geoKeys.GeographicTypeGeoKey
  const southWest = transformCoordinate(minX, minY, epsg)
  const northEast = transformCoordinate(maxX, maxY, epsg)
  const bounds: LatLngBoundsExpression = [
    [Math.min(southWest.latitude, northEast.latitude), Math.min(southWest.longitude, northEast.longitude)],
    [Math.max(southWest.latitude, northEast.latitude), Math.max(southWest.longitude, northEast.longitude)],
  ]
  return { rasterUrl: canvas.toDataURL('image/png'), rasterBounds: bounds }
}

function FitLayers({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [28, 28] })
  }, [bounds, map])
  return null
}

export default function FieldsLayersPage({ projectId, farmId, canManage }: Props) {
  const { loadedTaskData, updateTaskData, setErrorMessage } = useAppStore()
  const { polygonLayer, guidanceLayer } = useMapLayers()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const loadingLayerIdsRef = useRef(new Set<string>())
  const layers = useMemo(
    () => loadedTaskData?.tools?.mapLayers ?? [],
    [loadedTaskData?.tools?.mapLayers],
  )
  const [runtime, setRuntime] = useState<Record<string, RuntimeLayer>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    for (const layer of layers) {
      if (loadingLayerIdsRef.current.has(layer.id)) continue
      loadingLayerIdsRef.current.add(layer.id)
      void (async () => {
        try {
          const response = await fetch(`/api/files/${layer.fileId}`, { credentials: 'include' })
          if (!response.ok) throw new Error(`Unable to load ${layer.name}.`)
          const blob = await response.blob()
          const file = new File([blob], layer.name, { type: blob.type })
          const value = layer.kind === 'raster'
            ? await renderGeoTiff(file)
            : await parseImportedFile(file).then((parsed) => ({
                vector: parsed.collection as unknown as GeoJsonObject,
                guidance: parsed.guidanceCollection as unknown as GeoJsonObject | null,
              }))
          if (!cancelled) setRuntime((current) => ({ ...current, [layer.id]: value }))
        } catch (error) {
          if (!cancelled) {
            setRuntime((current) => ({
              ...current,
              [layer.id]: { error: error instanceof Error ? error.message : 'Layer could not be opened.' },
            }))
          }
        } finally {
          loadingLayerIdsRef.current.delete(layer.id)
        }
      })()
    }
    return () => { cancelled = true }
  }, [layers])

  const fitBounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (polygonLayer?.features.length) return L.geoJSON(polygonLayer as GeoJsonObject).getBounds()
    const raster = layers.map((layer) => runtime[layer.id]?.rasterBounds).find(Boolean)
    return raster ?? null
  }, [polygonLayer, layers, runtime])

  const patchLayer = (id: string, patch: Partial<MapLayerConfig>) => {
    updateTaskData((task) => ({
      ...task,
      tools: {
        ...task.tools,
        mapLayers: (task.tools?.mapLayers ?? []).map((layer) =>
          layer.id === id ? { ...layer, ...patch } : layer,
        ),
      },
    }))
  }

  const addLayer = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !projectId || !farmId || !canManage) return
    setBusy(true)
    try {
      const raster = isRasterName(file.name)
      if (raster) await renderGeoTiff(file)
      else await parseImportedFile(file)

      const form = new FormData()
      form.append('file', file)
      form.append('farmId', farmId)
      const uploaded = await apiRequest<{ file: { id: string } }>('/api/files', { method: 'POST', body: form })
      await apiRequest(`/api/projects/${projectId}/files`, {
        method: 'POST',
        body: JSON.stringify({ fileId: uploaded.file.id }),
      })
      const layer: MapLayerConfig = {
        id: uid(),
        fileId: uploaded.file.id,
        name: file.name,
        kind: raster ? 'raster' : 'vector',
        visible: true,
        opacity: raster ? 0.78 : 0.9,
      }
      updateTaskData((task) => ({
        ...task,
        tools: { ...task.tools, mapLayers: [...(task.tools?.mapLayers ?? []), layer] },
      }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to add the layer.')
    } finally {
      setBusy(false)
    }
  }

  const removeLayer = (id: string) => {
    updateTaskData((task) => ({
      ...task,
      tools: {
        ...task.tools,
        mapLayers: (task.tools?.mapLayers ?? []).filter((layer) => layer.id !== id),
      },
    }))
    setRuntime((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  return (
    <div className="fields-layers-layout">
      <section className="page-card layers-panel scroll-panel">
        <div className="section-kicker">Fields & layers</div>
        <h2 className="section-title">Layer manager</h2>
        <p className="muted-copy">Add GeoTIFF/TIFF, KMZ, KML, GeoJSON or a complete SHP ZIP such as the attached differential application map.</p>
        {canManage && (
          <>
            <button className="primary-btn layers-add-btn" onClick={() => inputRef.current?.click()} disabled={busy || !projectId}>
              {busy ? 'Processing…' : 'Add layer'}
            </button>
            <input ref={inputRef} type="file" hidden accept=".tif,.tiff,.zip,.kmz,.kml,.geojson,.json,.shp" onChange={addLayer} />
          </>
        )}

        <div className="layers-list">
          <article className="layer-control-row base-layer">
            <span className="layer-kind-icon">F</span>
            <div><strong>Farm fields</strong><small>Base field boundaries and guidance</small></div>
            <b>BASE</b>
          </article>
          {layers.map((layer) => {
            const state = runtime[layer.id]
            return (
              <article className={`layer-control-row ${state?.error ? 'error' : ''}`} key={layer.id}>
                <input type="checkbox" checked={layer.visible} onChange={(event) => patchLayer(layer.id, { visible: event.target.checked })} />
                <span className="layer-kind-icon">{layer.kind === 'raster' ? 'T' : 'V'}</span>
                <div>
                  <strong title={layer.name}>{layer.name}</strong>
                  <small>{state?.error ?? (state ? `${layer.kind} layer` : 'Loading…')}</small>
                  <input type="range" min="0" max="1" step="0.05" value={layer.opacity} onChange={(event) => patchLayer(layer.id, { opacity: Number(event.target.value) })} />
                </div>
                {canManage && <button onClick={() => removeLayer(layer.id)} aria-label={`Remove ${layer.name}`}>×</button>}
              </article>
            )
          })}
        </div>
      </section>

      <section className="page-card fields-layer-map-card">
        <MapContainer center={[40.4093, 49.8671]} zoom={12} style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {polygonLayer && <GeoJSON data={polygonLayer as GeoJsonObject} style={{ color: '#72d69a', weight: 2, fillOpacity: 0.04 }} />}
          {guidanceLayer && <GeoJSON data={guidanceLayer as GeoJsonObject} style={{ color: '#4f8cff', weight: 2 }} />}
          {layers.filter((layer) => layer.visible).map((layer) => {
            const state = runtime[layer.id]
            return state?.rasterUrl && state.rasterBounds
              ? <ImageOverlay key={layer.id} url={state.rasterUrl} bounds={state.rasterBounds} opacity={layer.opacity} />
              : state?.vector
                ? <GeoJSON key={`${layer.id}-${layer.opacity}`} data={state.vector} style={{ color: '#f2c94c', weight: 2, fillColor: '#f2c94c', fillOpacity: layer.opacity * 0.22, opacity: layer.opacity }} />
                : null
          })}
          {layers.filter((layer) => layer.visible && runtime[layer.id]?.guidance).map((layer) => (
            <GeoJSON key={`${layer.id}-guidance`} data={runtime[layer.id].guidance as GeoJsonObject} style={{ color: '#ff7ac8', weight: 2, opacity: layer.opacity }} />
          ))}
          <FitLayers bounds={fitBounds} />
        </MapContainer>
      </section>
    </div>
  )
}
