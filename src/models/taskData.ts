export type AppLanguage = 'en' | 'ru' | 'az'

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

export type TaskDataModel = {
  client?: ClientModel | null
  farm?: FarmModel | null
  fields: FieldModel[]
}

export type ImportedFileRecord = {
  id: string
  originalFileName: string
  cachedFileName: string
  importDate: string
  snapshot?: TaskDataModel
}

export type EditorMode = 'view' | 'drawField' | 'drawGuidance'

export type ExportFormat = 'isoxml' | 'kml' | 'kmz' | 'shp' | 'fieldpackage'

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
    fields: task.fields.map((field) => ({
      ...field,
      boundaries: field.boundaries.map(cloneBoundary),
      guidanceLines: field.guidanceLines.map(cloneGuidanceLine),
    })),
  }
}
