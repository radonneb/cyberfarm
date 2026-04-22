import type {
  TaskDataModel,
  FieldModel,
  FieldBoundary,
  GuidanceLine,
  GeoPoint,
} from '../models/taskData'
import { uid } from '../models/taskData'
import type { ImportParseResult } from '../types/geo'

function makePoint(longitude: number, latitude: number): GeoPoint {
  return {
    id: uid(),
    latitude,
    longitude,
  }
}

function getBoundaryCenter(boundary: FieldBoundary) {
  const pts = boundary.points
  if (!pts.length) return null

  const sum = pts.reduce(
    (acc, point) => {
      acc.latitude += point.latitude
      acc.longitude += point.longitude
      return acc
    },
    { latitude: 0, longitude: 0 }
  )

  return {
    latitude: sum.latitude / pts.length,
    longitude: sum.longitude / pts.length,
  }
}

function getLineCenter(line: GuidanceLine) {
  const pts = line.points
  if (!pts.length) return null

  const sum = pts.reduce(
    (acc, point) => {
      acc.latitude += point.latitude
      acc.longitude += point.longitude
      return acc
    },
    { latitude: 0, longitude: 0 }
  )

  return {
    latitude: sum.latitude / pts.length,
    longitude: sum.longitude / pts.length,
  }
}

function distanceSquared(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) {
  const lat = a.latitude - b.latitude
  const lon = a.longitude - b.longitude
  return lat * lat + lon * lon
}

export function importResultToTaskData(
  result: ImportParseResult,
  originalFileName: string
): TaskDataModel {
  const fieldsMap = new Map<string, FieldModel>()

  for (const feature of result.collection.features) {
    const fieldId = String(feature.properties?.__fieldId ?? uid())
    const fieldName = String(feature.properties?.__fieldName ?? 'Imported Field')

    if (feature.geometry.type !== 'Polygon') continue

    const coordinates = feature.geometry.coordinates?.[0] ?? []
    const points = coordinates.map(([longitude, latitude]) =>
      makePoint(Number(longitude), Number(latitude))
    )

    const boundary: FieldBoundary = {
      id: uid(),
      points,
    }

    if (!fieldsMap.has(fieldId)) {
      fieldsMap.set(fieldId, {
        id: fieldId,
        name: fieldName,
        clientId: undefined,
        farmId: undefined,
        boundaries: [],
        guidanceLines: [],
      })
    }

    fieldsMap.get(fieldId)!.boundaries.push(boundary)
  }

  if (result.guidanceCollection) {
    for (const feature of result.guidanceCollection.features) {
      if (feature.geometry.type !== 'LineString') continue

      const guidanceName = String(feature.properties?.__guidanceName ?? 'Guidance Line')
      const parentFieldId =
        typeof feature.properties?.__parentFieldId === 'string'
          ? feature.properties.__parentFieldId
          : null
      const parentFieldName = String(feature.properties?.__parentFieldName ?? '').trim()

      const points = feature.geometry.coordinates.map(([longitude, latitude]) =>
        makePoint(Number(longitude), Number(latitude))
      )

      const line: GuidanceLine = {
        id: String(feature.properties?.__guidanceId ?? uid()),
        name: guidanceName,
        points,
      }

      let matchedField: FieldModel | undefined

      if (parentFieldId && fieldsMap.has(parentFieldId)) {
        matchedField = fieldsMap.get(parentFieldId)
      }

      if (!matchedField && parentFieldName) {
        matchedField = Array.from(fieldsMap.values()).find(
          (field) => field.name.trim().toLowerCase() === parentFieldName.toLowerCase()
        )
      }

      if (!matchedField && fieldsMap.size > 0) {
        const lineCenter = getLineCenter(line)
        if (lineCenter) {
          matchedField = Array.from(fieldsMap.values())
            .map((field) => ({
              field,
              center: field.boundaries[0] ? getBoundaryCenter(field.boundaries[0]) : null,
            }))
            .filter(
              (
                item
              ): item is { field: FieldModel; center: { latitude: number; longitude: number } } =>
                item.center !== null
            )
            .sort(
              (left, right) =>
                distanceSquared(left.center, lineCenter) -
                distanceSquared(right.center, lineCenter)
            )[0]?.field
        }
      }

      if (!matchedField) {
        const fallbackFieldId = parentFieldId || uid()
        const fallbackFieldName =
          parentFieldName || originalFileName.replace(/\.[^/.]+$/, '') || 'Imported Field'

        matchedField = {
          id: fallbackFieldId,
          name: fallbackFieldName,
          clientId: undefined,
          farmId: undefined,
          boundaries: [],
          guidanceLines: [],
        }
        fieldsMap.set(matchedField.id, matchedField)
      }

      matchedField.guidanceLines.push(line)
    }
  }

  return {
    client: {
      id: uid(),
      name: 'Client',
    },
    farm: {
      id: uid(),
      name: originalFileName.replace(/\.[^/.]+$/, '') || 'Farm',
    },
    fields: Array.from(fieldsMap.values()),
  }
}