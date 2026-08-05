export type GeoPoint = {
  id: string
  latitude: number
  longitude: number
}

export type FieldBoundary = {
  id: string
  points: GeoPoint[]
}

export type GuidanceLine = {
  id: string
  name: string
  points: GeoPoint[]
  source?: 'generated' | 'route'
  sourceRouteId?: string
}

export type ClientModel = {
  id: string
  name: string
}

export type FarmModel = {
  id: string
  name: string
  clientId?: string
}

export type FieldModel = {
  id: string
  name: string
  clientId?: string
  farmId?: string
  boundaries: FieldBoundary[]
  guidanceLines: GuidanceLine[]
}


export type PivotTrackWheelConfig = {
  enabled: boolean
  widthMeters: number
}

export type PivotNozzleConfig = {
  id: string
  enabled: boolean
  distanceMeters: number
  sprayAngleDegrees: number
  throwMeters: number
}

export type PivotR55Config = {
  enabled: boolean
  throwMeters: number
  sprayAngleDegrees: number
}

export type PivotTrackConfig = {
  fieldId: string | null
  fieldMode: 'existing' | 'free'
  pivotType: 'circle' | 'sector'
  sectorAngle: number
  fieldAreaHa: number
  pivotLengthMeters: number
  positionDegrees: number
  centerOffsetXMeters: number
  centerOffsetYMeters: number
  wheels: PivotTrackWheelConfig[]
  sectorStartDegrees?: number
  nozzles?: PivotNozzleConfig[]
  targetDepthMm?: number
  rotationHours?: number
  r55?: PivotR55Config
  zoom?: number
  viewPanX?: number
  viewPanY?: number
}

export type PlantingPlanConfig = {
  fieldId: string | null
  operation: 'seeding'
  workingWidthMeters: number
  coulterCount: number
  seedSpacingCm: number
  crop: string
  yieldEnabled: boolean
  yieldUnitsPerPlant: number
  grainsPerUnit: number
  weightSampleCount: number
  weightSampleGrams: number
  targetRateEnabled?: boolean
  targetRate?: number
  targetRateUnit?: 'TK/ha' | 'kg/ha'
  thousandSeedWeightGrams?: number
}

export type MapLayerConfig = {
  id: string
  fileId: string
  name: string
  kind: 'vector' | 'raster'
  visible: boolean
  opacity: number
  createdAt?: string
  sizeBytes?: number
  contentType?: string
  crs?: string
  widthPixels?: number
  heightPixels?: number
}

export type RoutePointConfig = {
  id: string
  latitude: number
  longitude: number
  timestamp?: string
  label?: string
}

export type RoutePlanConfig = {
  id: string
  name: string
  points: RoutePointConfig[]
  gapMinutes: number
  createdAt: string
  visible?: boolean
  color?: string
  lineWidth?: number
  showPoints?: boolean
}

export type MapViewConfig = {
  showFieldLabels?: boolean
}

export type FarmToolData = {
  pivotTracks?: Record<string, PivotTrackConfig>
  plantingPlans?: Record<string, PlantingPlanConfig>
  mapLayers?: MapLayerConfig[]
  routes?: RoutePlanConfig[]
  mapView?: MapViewConfig
}

export type TaskDataModel = {
  client?: ClientModel | null
  farm?: FarmModel | null
  fields: FieldModel[]
  tools?: FarmToolData
}

export type ImportedFileRecord = {
  id: string
  originalFileName: string
  cachedFileName: string
  importDate: string
}

export type EditorMode = 'view' | 'drawField' | 'drawGuidance'

export type ExportFormat = 'isoxml' | 'kml' | 'kmz' | 'shp' | 'fieldpackage'

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function textValue(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizePoint(value: unknown, fallbackId: string): GeoPoint | null {
  const point = recordValue(value)
  const latitude = Number(point.latitude)
  const longitude = Number(point.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return {
    id: textValue(point.id, fallbackId),
    latitude,
    longitude,
  }
}

/**
 * Project snapshots can outlive the client version that created them. Keep the
 * UI tolerant of old or partially recovered snapshots instead of letting one
 * missing collection crash the whole React tree.
 */
export function normalizeTaskData(value: unknown): TaskDataModel {
  const task = recordValue(value)
  const rawFields = Array.isArray(task.fields) ? task.fields : []
  const fields = rawFields.map((fieldValue, fieldIndex): FieldModel => {
    const field = recordValue(fieldValue)
    const fieldId = textValue(field.id, `legacy-field-${fieldIndex}`)
    const rawBoundaries = Array.isArray(field.boundaries) ? field.boundaries : []
    const boundaries = rawBoundaries.map((boundaryValue, boundaryIndex): FieldBoundary => {
      const boundary = recordValue(boundaryValue)
      const rawPoints = Array.isArray(boundary.points) ? boundary.points : []
      return {
        id: textValue(boundary.id, `${fieldId}-boundary-${boundaryIndex}`),
        points: rawPoints
          .map((point, pointIndex) => normalizePoint(
            point,
            `${fieldId}-boundary-${boundaryIndex}-point-${pointIndex}`,
          ))
          .filter((point): point is GeoPoint => Boolean(point)),
      }
    })
    const rawGuidance = Array.isArray(field.guidanceLines) ? field.guidanceLines : []
    const guidanceLines = rawGuidance.map((lineValue, lineIndex): GuidanceLine => {
      const line = recordValue(lineValue)
      const lineId = textValue(line.id, `${fieldId}-guidance-${lineIndex}`)
      const rawPoints = Array.isArray(line.points) ? line.points : []
      const source = line.source === 'generated' || line.source === 'route' ? line.source : undefined
      return {
        id: lineId,
        name: textValue(line.name, `Guidance ${lineIndex + 1}`),
        points: rawPoints
          .map((point, pointIndex) => normalizePoint(point, `${lineId}-point-${pointIndex}`))
          .filter((point): point is GeoPoint => Boolean(point)),
        source,
        sourceRouteId: optionalText(line.sourceRouteId),
      }
    })

    return {
      id: fieldId,
      name: textValue(field.name, `Field ${fieldIndex + 1}`),
      clientId: optionalText(field.clientId),
      farmId: optionalText(field.farmId),
      boundaries,
      guidanceLines,
    }
  })

  return {
    client: task.client && typeof task.client === 'object' ? task.client as ClientModel : null,
    farm: task.farm && typeof task.farm === 'object' ? task.farm as FarmModel : null,
    fields,
    tools: task.tools && typeof task.tools === 'object' ? task.tools as FarmToolData : undefined,
  }
}

export function uid() {
  return crypto.randomUUID()
}

export function clonePoint(point: GeoPoint): GeoPoint {
  return {
    id: uid(),
    latitude: point.latitude,
    longitude: point.longitude,
  }
}

export function cloneBoundary(boundary: FieldBoundary): FieldBoundary {
  return {
    id: uid(),
    points: boundary.points.map(clonePoint),
  }
}

export function cloneGuidanceLine(line: GuidanceLine, index = 0): GuidanceLine {
  return {
    id: uid(),
    name: line.name.trim() || `Guidance ${index + 1}`,
    points: line.points.map(clonePoint),
    source: line.source,
    sourceRouteId: line.sourceRouteId,
  }
}

export function cloneField(field: FieldModel, existingNames?: Set<string>): FieldModel {
  let nextName = field.name.trim() || 'Imported Field'

  if (existingNames) {
    if (existingNames.has(nextName.toLowerCase())) {
      let suffix = 1
      while (existingNames.has(`${nextName} Imported ${suffix}`.toLowerCase())) {
        suffix += 1
      }
      nextName = `${nextName} Imported ${suffix}`
    }
    existingNames.add(nextName.toLowerCase())
  }

  return {
    id: uid(),
    name: nextName,
    clientId: field.clientId,
    farmId: field.farmId,
    boundaries: field.boundaries.map(cloneBoundary),
    guidanceLines: field.guidanceLines.map(cloneGuidanceLine),
  }
}

export function cloneTaskData(task: TaskDataModel): TaskDataModel {
  return {
    client: task.client ? { ...task.client } : task.client,
    farm: task.farm ? { ...task.farm } : task.farm,
    tools: task.tools ? structuredClone(task.tools) : undefined,
    fields: task.fields.map((field) => ({
      ...field,
      boundaries: field.boundaries.map(cloneBoundary),
      guidanceLines: field.guidanceLines.map(cloneGuidanceLine),
    })),
  }
}
