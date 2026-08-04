import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GeoJSON, ImageOverlay, MapContainer, Pane, TileLayer, useMap } from 'react-leaflet'
import type { GeoJsonObject } from 'geojson'
import type { LatLngBoundsExpression } from 'leaflet'
import { useMapLayers } from '../appHelpers'
import FieldNameLabels from '../components/FieldNameLabels'
import type { MapLayerConfig } from '../models/taskData'
import { uid } from '../models/taskData'
import { apiRequest } from '../services/api'
import { useAppStore } from '../store/appStore'
import { renderGeoTiff } from '../utils/geoTiffRenderer'
import { parseImportedFile } from '../utils/importers'

type RuntimeLayer = {
  vector?: GeoJsonObject
  guidance?: GeoJsonObject | null
  rasterUrl?: string
  rasterBounds?: LatLngBoundsExpression
  crs?: string
  widthPixels?: number
  heightPixels?: number
  createdAt?: string
  sizeBytes?: number
  error?: string
}

type Props = { projectId: string | null; farmId: string | null; canManage: boolean }

function extension(name: string) { return name.split('.').pop()?.toLowerCase() ?? '' }
function isRasterName(name: string) { return ['tif', 'tiff'].includes(extension(name)) }
function formatBytes(value?: number) {
  if (!value) return 'size unknown'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 ** 2).toFixed(1)} MB`
}
function formatDate(value?: string) {
  if (!value) return 'date unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'date unknown' : date.toLocaleDateString()
}

function FocusLayer({ bounds, request }: { bounds: LatLngBoundsExpression | null; request: number }) {
  const map = useMap()
  useEffect(() => {
    if (bounds && request > 0) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 })
  }, [bounds, map, request])
  return null
}

export default function FieldsLayersPage({ projectId, farmId, canManage }: Props) {
  const { loadedTaskData, updateTaskData, setErrorMessage } = useAppStore()
  const { polygonLayer, guidanceLayer } = useMapLayers()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const loadingIds = useRef(new Set<string>())
  const loadedIds = useRef(new Set<string>())
  const layers = useMemo(() => loadedTaskData?.tools?.mapLayers ?? [], [loadedTaskData?.tools?.mapLayers])
  const showLabels = loadedTaskData?.tools?.mapView?.showFieldLabels ?? false
  const [runtime, setRuntime] = useState<Record<string, RuntimeLayer>>({})
  const [busy, setBusy] = useState(false)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(layers.at(-1)?.id ?? null)
  const [focusRequest, setFocusRequest] = useState(1)
  const draggingId = useRef<string | null>(null)

  useEffect(() => {
    for (const layer of layers) {
      if (loadedIds.current.has(layer.id) || loadingIds.current.has(layer.id)) continue
      loadingIds.current.add(layer.id)
      void (async () => {
        try {
          const response = await fetch(`/api/files/${layer.fileId}`, { credentials: 'include' })
          if (!response.ok) throw new Error(`Unable to load ${layer.name}.`)
          const blob = await response.blob()
          const file = new File([blob], layer.name, { type: blob.type })
          const metadata = {
            sizeBytes: Number(response.headers.get('X-CyberFarm-File-Size')) || blob.size,
            createdAt: response.headers.get('X-CyberFarm-File-Created-At') ?? layer.createdAt,
          }
          const value: RuntimeLayer = layer.kind === 'raster'
            ? { ...(await renderGeoTiff(file)), ...metadata }
            : {
                ...(await parseImportedFile(file).then((parsed) => ({
                  vector: parsed.collection as unknown as GeoJsonObject,
                  guidance: parsed.guidanceCollection as unknown as GeoJsonObject | null,
                }))),
                ...metadata,
              }
          loadedIds.current.add(layer.id)
          setRuntime((current) => ({ ...current, [layer.id]: value }))
        } catch (error) {
          loadedIds.current.add(layer.id)
          setRuntime((current) => ({
            ...current,
            [layer.id]: { error: error instanceof Error ? error.message : 'Layer could not be opened.' },
          }))
        } finally { loadingIds.current.delete(layer.id) }
      })()
    }
  }, [layers])

  const selectedBounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (selectedLayerId) {
      const state = runtime[selectedLayerId]
      if (state?.rasterBounds) return state.rasterBounds
      if (state?.vector) {
        const bounds = L.geoJSON(state.vector).getBounds()
        if (bounds.isValid()) return bounds
      }
    }
    if (polygonLayer?.features.length) return L.geoJSON(polygonLayer as GeoJsonObject).getBounds()
    return null
  }, [polygonLayer, runtime, selectedLayerId])

  const patchLayer = (id: string, patch: Partial<MapLayerConfig>) => updateTaskData((task) => ({
    ...task,
    tools: { ...task.tools, mapLayers: (task.tools?.mapLayers ?? []).map((layer) => layer.id === id ? { ...layer, ...patch } : layer) },
  }))

  const addLayer = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !projectId || !farmId || !canManage) return
    setBusy(true)
    try {
      const raster = isRasterName(file.name)
      const rendered = raster ? await renderGeoTiff(file) : null
      if (!raster) await parseImportedFile(file)
      const form = new FormData()
      form.append('file', file)
      form.append('farmId', farmId)
      const uploaded = await apiRequest<{ file: { id: string; sizeBytes?: number; createdAt?: string; contentType?: string } }>('/api/files', { method: 'POST', body: form })
      await apiRequest(`/api/projects/${projectId}/files`, { method: 'POST', body: JSON.stringify({ fileId: uploaded.file.id }) })
      const layer: MapLayerConfig = {
        id: uid(), fileId: uploaded.file.id, name: file.name, kind: raster ? 'raster' : 'vector', visible: true,
        opacity: raster ? 0.78 : 0.9, createdAt: uploaded.file.createdAt ?? new Date().toISOString(),
        sizeBytes: uploaded.file.sizeBytes ?? file.size, contentType: uploaded.file.contentType ?? file.type,
        crs: rendered?.crs, widthPixels: rendered?.widthPixels, heightPixels: rendered?.heightPixels,
      }
      if (rendered) setRuntime((current) => ({ ...current, [layer.id]: { ...rendered, sizeBytes: file.size, createdAt: layer.createdAt } }))
      updateTaskData((task) => ({ ...task, tools: { ...task.tools, mapLayers: [...(task.tools?.mapLayers ?? []), layer] } }))
      setSelectedLayerId(layer.id)
      setFocusRequest((value) => value + 1)
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Unable to add the layer.') }
    finally { setBusy(false) }
  }

  const removeLayer = (id: string) => {
    updateTaskData((task) => ({ ...task, tools: { ...task.tools, mapLayers: (task.tools?.mapLayers ?? []).filter((layer) => layer.id !== id) } }))
    setRuntime((current) => { const next = { ...current }; delete next[id]; return next })
    loadedIds.current.delete(id)
    if (selectedLayerId === id) setSelectedLayerId(null)
  }

  const reorder = (targetId: string) => {
    const sourceId = draggingId.current
    draggingId.current = null
    if (!sourceId || sourceId === targetId) return
    updateTaskData((task) => {
      const current = [...(task.tools?.mapLayers ?? [])]
      const from = current.findIndex((layer) => layer.id === sourceId)
      const to = current.findIndex((layer) => layer.id === targetId)
      if (from < 0 || to < 0) return task
      const [moved] = current.splice(from, 1)
      current.splice(to, 0, moved)
      return { ...task, tools: { ...task.tools, mapLayers: current } }
    })
  }

  return (
    <div className="fields-layers-layout">
      <section className="page-card layers-panel scroll-panel">
        <div className="section-kicker">Fields & layers</div>
        <h2 className="section-title">Layer manager</h2>
        <p className="muted-copy">The top row is drawn above the rows below it. Drag rows to change the stack.</p>
        <label className="layer-label-toggle">
          <input type="checkbox" checked={showLabels} onChange={(event) => updateTaskData((task) => ({ ...task, tools: { ...task.tools, mapView: { ...task.tools?.mapView, showFieldLabels: event.target.checked } } }))} />
          Show field names
        </label>
        {canManage && <>
          <button className="primary-btn layers-add-btn" onClick={() => inputRef.current?.click()} disabled={busy || !projectId}>{busy ? 'Processing…' : 'Add layer'}</button>
          <input ref={inputRef} type="file" hidden accept=".tif,.tiff,.zip,.kmz,.kml,.geojson,.json,.shp" onChange={addLayer} />
        </>}
        <div className="layers-list">
          {[...layers].reverse().map((layer) => {
            const state = runtime[layer.id]
            return <article
              className={`layer-control-row ${state?.error ? 'error' : ''} ${selectedLayerId === layer.id ? 'selected' : ''}`}
              key={layer.id} draggable={canManage} onDragStart={() => { draggingId.current = layer.id }} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(layer.id)}
              onClick={() => setSelectedLayerId(layer.id)}
            >
              <input type="checkbox" checked={layer.visible} onClick={(event) => event.stopPropagation()} onChange={(event) => patchLayer(layer.id, { visible: event.target.checked })} />
              <span className="layer-kind-icon">{layer.kind === 'raster' ? 'T' : 'V'}</span>
              <div>
                <strong title={layer.name}>{layer.name}</strong>
                <small>{state?.error ?? `${formatDate(layer.createdAt ?? state?.createdAt)} · ${formatBytes(layer.sizeBytes ?? state?.sizeBytes)}${layer.crs ?? state?.crs ? ` · ${layer.crs ?? state?.crs}` : ''}`}</small>
                <input type="range" min="0" max="1" step="0.05" value={layer.opacity} onClick={(event) => event.stopPropagation()} onChange={(event) => patchLayer(layer.id, { opacity: Number(event.target.value) })} />
              </div>
              <button className="layer-focus-btn" onClick={(event) => { event.stopPropagation(); setSelectedLayerId(layer.id); setFocusRequest((value) => value + 1) }} aria-label={`Focus ${layer.name}`}>⌖</button>
              {canManage && <button onClick={(event) => { event.stopPropagation(); removeLayer(layer.id) }} aria-label={`Remove ${layer.name}`}>×</button>}
            </article>
          })}
          <article className="layer-control-row base-layer"><span className="layer-kind-icon">F</span><div><strong>Farm fields</strong><small>Boundaries and guidance, below added layers</small></div><b>BASE</b></article>
        </div>
      </section>

      <section className="page-card fields-layer-map-card">
        <MapContainer center={[40.4093, 49.8671]} zoom={12} style={{ width: '100%', height: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Pane name="farm-boundaries" style={{ zIndex: 410 }}>{polygonLayer && <GeoJSON data={polygonLayer as GeoJsonObject} style={{ color: '#72d69a', weight: 2, fillOpacity: 0.04 }} />}</Pane>
          <Pane name="farm-guidance" style={{ zIndex: 420 }}>{guidanceLayer && <GeoJSON data={guidanceLayer as GeoJsonObject} style={{ color: '#4f8cff', weight: 2 }} />}</Pane>
          {layers.filter((layer) => layer.visible).map((layer, index) => {
            const state = runtime[layer.id]
            const pane = `user-layer-${layer.id}`
            return <Pane key={layer.id} name={pane} style={{ zIndex: 500 + index }}>
              {state?.rasterUrl && state.rasterBounds ? <ImageOverlay url={state.rasterUrl} bounds={state.rasterBounds} opacity={layer.opacity} pane={pane} /> : null}
              {state?.vector ? <GeoJSON data={state.vector} pane={pane} style={{ color: '#f2c94c', weight: 2, fillColor: '#f2c94c', fillOpacity: layer.opacity * 0.22, opacity: layer.opacity }} /> : null}
              {state?.guidance ? <GeoJSON data={state.guidance} pane={pane} style={{ color: '#ff7ac8', weight: 2, opacity: layer.opacity }} /> : null}
            </Pane>
          })}
          <Pane name="field-name-labels" style={{ zIndex: 1000 }}><FieldNameLabels pane="field-name-labels" /></Pane>
          <FocusLayer bounds={selectedBounds} request={focusRequest} />
        </MapContainer>
      </section>
    </div>
  )
}
