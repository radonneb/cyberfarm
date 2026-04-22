import { useMemo } from 'react'
import { useAppStore } from './store/appStore'
import type { FieldModel, GeoPoint, GuidanceLine } from './models/taskData'

export type OperationType = 'seeding' | 'fertilizing' | 'spraying' | 'others'

export function formatCoord(point: GeoPoint) {
  return `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`
}

export function polygonAreaSqMeters(points: GeoPoint[]) {
  if (points.length < 3) return 0
  const anchor = points[0]
  const cosLat = Math.cos((anchor.latitude * Math.PI) / 180)
  const coords = points.map((point) => ({
    x: (point.longitude - anchor.longitude) * 111320 * cosLat,
    y: (point.latitude - anchor.latitude) * 111320,
  }))

  let area = 0
  for (let i = 0; i < coords.length; i += 1) {
    const current = coords[i]
    const next = coords[(i + 1) % coords.length]
    area += current.x * next.y - next.x * current.y
  }

  return Math.abs(area) / 2
}

export function fieldAreaSqMeters(field: FieldModel | null) {
  if (!field) return 0
  return field.boundaries.reduce((sum, boundary) => sum + polygonAreaSqMeters(boundary.points), 0)
}

export function lineLengthMeters(line: GuidanceLine) {
  let total = 0
  for (let i = 1; i < line.points.length; i += 1) {
    const a = line.points[i - 1]
    const b = line.points[i]
    const latFactor = 111320
    const lonFactor = Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180) * 111320
    const dy = (b.latitude - a.latitude) * latFactor
    const dx = (b.longitude - a.longitude) * lonFactor
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}

export function FieldInfoPanel({ field }: { field: FieldModel | null }) {
  const areaSqMeters = useMemo(() => fieldAreaSqMeters(field), [field])
  const areaHa = areaSqMeters / 10000
  const areaKm2 = areaSqMeters / 1000000

  const { loadedTaskData } = useAppStore()

  if (!field) {
    return <div className="empty-panel">Select a field to view its details.</div>
  }

  const fieldClient = loadedTaskData?.client?.name ?? '—'
  const fieldFarm = loadedTaskData?.farm?.name ?? '—'

  return (
    <div className="details-stack">
      <section className="page-card">
        <div className="section-kicker compact-kicker">Field info</div>
        <h2 className="section-title compact-title">{field.name}</h2>
        <div className="meta-chip-row">
          <div className="meta-chip"><span>Client</span><strong>{fieldClient}</strong></div>
          <div className="meta-chip"><span>Farm</span><strong>{fieldFarm}</strong></div>
        </div>
        <div className="metric-grid compact-metrics">
          <div className="metric-card">
            <span>Hectares</span>
            <strong>{areaHa.toFixed(3)} ha</strong>
          </div>
          <div className="metric-card">
            <span>km²</span>
            <strong>{areaKm2.toFixed(4)} km²</strong>
          </div>
          <div className="metric-card">
            <span>Boundaries</span>
            <strong>{field.boundaries.length}</strong>
          </div>
          <div className="metric-card">
            <span>Guidance lines</span>
            <strong>{field.guidanceLines.length}</strong>
          </div>
        </div>
      </section>

      <section className="page-card grow-card">
        <div className="section-kicker compact-kicker">Guidance lines</div>
        {field.guidanceLines.length ? (
          <div className="info-list">
            {field.guidanceLines.map((line) => (
              <div key={line.id} className="info-block">
                <div className="info-block-title">
                  <strong>{line.name}</strong>
                  <span>{lineLengthMeters(line).toFixed(1)} m</span>
                </div>
                <div className="coords-list">
                  {line.points.map((point, index) => (
                    <div key={point.id} className="coord-item">
                      <span>P{index + 1}</span>
                      <code>{formatCoord(point)}</code>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-panel small">This field does not have guidance lines yet.</div>
        )}
      </section>
    </div>
  )
}

export function renderMaterialDetails(line: NonNullable<ReturnType<typeof useAppStore>['generationResult']>['lines'][number]) {
  if (typeof line.seedAmount === 'number') {
    return <div className="result-detail">Seeds: {line.seedAmount.toFixed(2)} {line.seedUnits?.replace('/ha', '') ?? ''}</div>
  }

  if (typeof line.fertilizerKg === 'number') {
    return <div className="result-detail">Fertilizer: {line.fertilizerKg.toFixed(2)} kg</div>
  }

  if (typeof line.mixtureLiters === 'number' || typeof line.chemicalGrams === 'number') {
    return (
      <>
        <div className="result-detail">Mixture: {(line.mixtureLiters ?? 0).toFixed(2)} L</div>
        <div className="result-detail">Chemical: {(line.chemicalGrams ?? 0).toFixed(2)} g</div>
      </>
    )
  }

  return <div className="result-detail">Materials: not required</div>
}

export function useMapLayers() {
  const { loadedTaskData } = useAppStore()

  const polygonLayer = useMemo(() => {
    if (!loadedTaskData) return null
    return {
      type: 'FeatureCollection' as const,
      features: loadedTaskData.fields.flatMap((field) =>
        field.boundaries
          .filter((boundary) => boundary.points.length >= 3)
          .map((boundary) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[
                ...boundary.points.map((point) => [point.longitude, point.latitude] as [number, number]),
                [boundary.points[0].longitude, boundary.points[0].latitude] as [number, number],
              ]],
            },
            properties: {
              __fieldId: field.id,
              __fieldName: field.name,
            },
          })),
      ),
    }
  }, [loadedTaskData])

  const guidanceLayer = useMemo(() => {
    if (!loadedTaskData) return null
    return {
      type: 'FeatureCollection' as const,
      features: loadedTaskData.fields.flatMap((field) =>
        field.guidanceLines
          .filter((line) => line.points.length >= 2)
          .map((line) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: line.points.map((point) => [point.longitude, point.latitude] as [number, number]),
            },
            properties: {
              __guidanceId: line.id,
              __guidanceName: line.name,
              __parentFieldName: field.name,
            },
          })),
      ),
    }
  }, [loadedTaskData])

  return { polygonLayer, guidanceLayer }
}
