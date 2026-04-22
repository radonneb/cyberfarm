import L from 'leaflet'
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polyline,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { useEffect, useMemo, useState } from 'react'
import type { Feature, GeoJsonObject } from 'geojson'
import type { LatLngExpression } from 'leaflet'
import type { AppGuidanceCollection, AppPolygonCollection } from '../types/geo'
import type { FieldModel, GeoPoint } from '../models/taskData'
import 'leaflet/dist/leaflet.css'

type MapViewProps = {
  importedLayer: AppPolygonCollection | null
  guidanceLayer: AppGuidanceCollection | null
  selectedFieldId: string | null
  selectedField: FieldModel | null
  editorMode: 'view' | 'drawField' | 'drawGuidance'
  draftBoundaryPoints: GeoPoint[]
  draftGuidancePoints: GeoPoint[]
  editingEnabled: boolean
  onSelectField: (fieldId: string | null) => void
  onAddDraftPoint: (lat: number, lon: number) => void
  onMoveBoundaryPoint: (boundaryId: string, pointId: string, lat: number, lon: number) => void
  onMoveGuidancePoint: (guidanceId: string, pointId: string, lat: number, lon: number) => void
  dataVersion?: number
}

const dragIcon = L.divIcon({
  className: 'map-drag-handle',
  html: '<div class="map-drag-dot"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

function FitToSelection({
  importedLayer,
  selectedFieldId,
}: {
  importedLayer: AppPolygonCollection | null
  selectedFieldId: string | null
}) {
  const map = useMap()

  const selectedCollection = useMemo(() => {
    if (!importedLayer) return null
    if (!selectedFieldId) return importedLayer

    return {
      type: 'FeatureCollection' as const,
      features: importedLayer.features.filter(
        (feature) => feature.properties?.__fieldId === selectedFieldId,
      ),
    }
  }, [importedLayer, selectedFieldId])

  useEffect(() => {
    if (!selectedCollection?.features.length) return
    const geoJsonLayer = L.geoJSON(selectedCollection as GeoJsonObject)
    const bounds = geoJsonLayer.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] })
    }
  }, [map, selectedCollection])

  return null
}

function MapDraftHandler({
  editorMode,
  onAddDraftPoint,
}: {
  editorMode: 'view' | 'drawField' | 'drawGuidance'
  onAddDraftPoint: (lat: number, lon: number) => void
}) {
  useMapEvents({
    click(event) {
      if (editorMode === 'view') return
      onAddDraftPoint(event.latlng.lat, event.latlng.lng)
    },
  })

  return null
}

function midpointLabelPosition(points: GeoPoint[]) {
  if (!points.length) return null
  if (points.length === 1) {
    return [points[0].latitude, points[0].longitude] as LatLngExpression
  }

  const mid = Math.floor((points.length - 1) / 2)
  const a = points[mid]
  const b = points[Math.min(mid + 1, points.length - 1)]

  return [
    (a.latitude + b.latitude) / 2,
    (a.longitude + b.longitude) / 2,
  ] as LatLngExpression
}

function isGeneratedLineId(value: unknown) {
  return typeof value === 'string' && value.startsWith('generated-')
}

function guidanceStyle(feature: Feature | undefined) {
  const guidanceId = feature?.properties?.__guidanceId
  const guidanceName = feature?.properties?.__guidanceName
  const generated = isGeneratedLineId(guidanceId)
  const isBaseLine =
    generated &&
    (guidanceName === '0' || guidanceName === '+0' || guidanceName === '-0')

  if (isBaseLine) {
    return {
      color: '#f7c948',
      weight: 4,
      opacity: 1,
    }
  }

  if (generated) {
    return {
      color: '#40d6c2',
      weight: 2.4,
      opacity: 0.95,
    }
  }

  return {
    color: '#4f8cff',
    weight: 2.6,
    opacity: 0.9,
  }
}

function ZoomAwareGeneratedLabels({
  selectedField,
  enabled,
}: {
  selectedField: FieldModel | null
  enabled: boolean
}) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())

  useEffect(() => {
    const update = () => setZoom(map.getZoom())
    map.on('zoomend', update)

    return () => {
      map.off('zoomend', update)
    }
  }, [map])

  if (!enabled || !selectedField) return null

  return (
    <>
      {selectedField.guidanceLines
        .filter((line) => line.id.startsWith('generated-'))
        .filter((line) => line.name === '0' || zoom >= 17)
        .filter((line, index) => line.name === '0' || zoom >= 18 || index % 4 === 0)
        .map((line) => {
          const position = midpointLabelPosition(line.points)
          if (!position) return null

          const isBaseLine =
            line.name === '0' || line.name === '+0' || line.name === '-0'
          const badgeClass = isBaseLine
            ? 'line-label-badge base-line-badge'
            : 'line-label-badge generated-line-badge'

          return (
            <Marker
              key={`label-${line.id}`}
              position={position}
              icon={L.divIcon({
                className: 'line-label-icon',
                html: `<div class="${badgeClass}">${line.name}</div>`,
              })}
              interactive={false}
            />
          )
        })}
    </>
  )
}

function InteractiveLayer({
  importedLayer,
  selectedFieldId,
  onSelectField,
}: {
  importedLayer: AppPolygonCollection
  selectedFieldId: string | null
  onSelectField: (fieldId: string | null) => void
}) {
  const map = useMap()

  return (
    <GeoJSON
      data={importedLayer as GeoJsonObject}
      style={(feature) => ({
        color:
          feature?.properties?.__fieldId === selectedFieldId ? '#8db1ff' : '#6f8fff',
        weight: feature?.properties?.__fieldId === selectedFieldId ? 2.5 : 1.6,
        fillColor:
          feature?.properties?.__fieldId === selectedFieldId ? '#8db1ff' : '#6f8fff',
        fillOpacity:
          feature?.properties?.__fieldId === selectedFieldId ? 0.08 : 0.03,
      })}
      onEachFeature={(feature, layer) => {
        layer.on('click', () => {
          const fieldId =
            typeof feature.properties?.__fieldId === 'string'
              ? feature.properties.__fieldId
              : null

          onSelectField(fieldId)

          if ('getBounds' in layer && typeof layer.getBounds === 'function') {
            const bounds = layer.getBounds()
            if (bounds?.isValid?.()) {
              map.fitBounds(bounds, { padding: [24, 24] })
            }
          }
        })
      }}
    />
  )
}

export default function MapView({
  importedLayer,
  guidanceLayer,
  selectedFieldId,
  selectedField,
  editorMode,
  draftBoundaryPoints,
  draftGuidancePoints,
  editingEnabled,
  onSelectField,
  onAddDraftPoint,
  onMoveBoundaryPoint,
  onMoveGuidancePoint,
  dataVersion = 0,
}: MapViewProps) {
  const draftBoundaryPositions = draftBoundaryPoints.map(
    (point) => [point.latitude, point.longitude] as LatLngExpression,
  )
  const draftGuidancePositions = draftGuidancePoints.map(
    (point) => [point.latitude, point.longitude] as LatLngExpression,
  )

  return (
    <MapContainer
      center={[40.4093, 49.8671]}
      zoom={13}
      style={{ width: '100%', height: '100%' }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapDraftHandler editorMode={editorMode} onAddDraftPoint={onAddDraftPoint} />

      {importedLayer && (
        <InteractiveLayer
          key={`poly-${dataVersion}`}
          importedLayer={importedLayer}
          selectedFieldId={selectedFieldId}
          onSelectField={onSelectField}
        />
      )}

      {guidanceLayer && (
        <GeoJSON
          key={`guidance-${dataVersion}`}
          data={guidanceLayer as GeoJsonObject}
          style={(feature) => guidanceStyle(feature as Feature | undefined)}
        />
      )}

      {draftBoundaryPositions.length >= 2 && (
        <Polygon
          positions={draftBoundaryPositions}
          pathOptions={{ color: '#8fffd9', weight: 2, fillOpacity: 0.06 }}
        />
      )}

      {draftBoundaryPositions.map((position, index) => (
        <CircleMarker
          key={`draft-boundary-${index}`}
          center={position}
          radius={4}
          pathOptions={{ color: '#8fffd9' }}
        />
      ))}

      {draftGuidancePositions.length >= 2 && (
        <Polyline
          positions={draftGuidancePositions}
          pathOptions={{ color: '#f7c948', weight: 3 }}
        />
      )}

      {draftGuidancePositions.map((position, index) => (
        <CircleMarker
          key={`draft-guidance-${index}`}
          center={position}
          radius={4}
          pathOptions={{ color: '#f7c948' }}
        />
      ))}

      {editingEnabled &&
        selectedField?.guidanceLines.map((line) =>
          line.points.map((point) => (
            <Marker
              key={point.id}
              position={[point.latitude, point.longitude]}
              icon={dragIcon}
              draggable
              eventHandlers={{
                dragend(event) {
                  const latLng = event.target.getLatLng()
                  onMoveGuidancePoint(line.id, point.id, latLng.lat, latLng.lng)
                },
              }}
            >
              {line.name === selectedField.guidanceLines[0]?.name && (
                <Tooltip direction="top" offset={[0, -8]}>
                  {line.name}
                </Tooltip>
              )}
            </Marker>
          )),
        )}

      {editingEnabled &&
        selectedField?.boundaries.map((boundary) =>
          boundary.points.map((point) => (
            <Marker
              key={point.id}
              position={[point.latitude, point.longitude]}
              icon={dragIcon}
              draggable
              eventHandlers={{
                dragend(event) {
                  const latLng = event.target.getLatLng()
                  onMoveBoundaryPoint(boundary.id, point.id, latLng.lat, latLng.lng)
                },
              }}
            />
          )),
        )}

      {!editingEnabled && (
        <ZoomAwareGeneratedLabels selectedField={selectedField} enabled />
      )}

      <FitToSelection importedLayer={importedLayer} selectedFieldId={selectedFieldId} />
    </MapContainer>
  )
}