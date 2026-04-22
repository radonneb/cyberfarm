import JSZip from 'jszip'
import shp from 'shpjs'
import { kml as kmlToGeoJSON } from '@tmcw/togeojson'
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
  LineString,
  Position,
  Polygon,
} from 'geojson'
import type {
  AppFeature,
  AppGuidanceCollection,
  AppLineFeature,
  AppPolygonCollection,
  ImportParseResult,
} from '../types/geo'

function createFieldId(index: number) {
  return `field-${index + 1}`
}

function createGuidanceId(index: number) {
  return `guidance-${index + 1}`
}

function getFeatureName(
  properties: GeoJsonProperties | null | undefined,
  fallback: string
) {
  if (!properties) return fallback

  const candidates = [
    properties.__fieldName,
    properties.__parentFieldName,
    properties.name,
    properties.Name,
    properties.NAME,
    properties.field,
    properties.Field,
    properties.FIELD,
    properties.title,
    properties.Title,
    properties.TITLE,
    properties.layer,
    properties.Layer,
    properties.LAYER,
    properties.description,
  ]

  const found = candidates.find(
    (value) => typeof value === 'string' && value.trim().length > 0
  )

  return typeof found === 'string' ? found.trim() : fallback
}

function ensureClosedRing(coordinates: Position[]) {
  if (coordinates.length < 3) return coordinates

  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]

  if (first[0] === last[0] && first[1] === last[1]) {
    return coordinates
  }

  return [...coordinates, first]
}

function flattenFeatures(input: unknown): Feature<Geometry, GeoJsonProperties>[] {
  if (!input) return []

  if (
    typeof input === 'object' &&
    input !== null &&
    'type' in input &&
    (input as { type?: string }).type === 'FeatureCollection'
  ) {
    return ((input as FeatureCollection).features ?? []) as Feature<
      Geometry,
      GeoJsonProperties
    >[]
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => flattenFeatures(item))
  }

  return []
}

function normalizeImportResult(input: unknown, sourceName: string): ImportParseResult {
  const features = flattenFeatures(input)
  const polygonFeatures: AppFeature[] = []
  const guidanceFeatures: AppLineFeature[] = []

  const lineBuckets = new Map<string, string>()

  for (const feature of features) {
    const geometry = feature.geometry
    if (!geometry) continue

    if (geometry.type === 'Polygon') {
      const fieldId = createFieldId(polygonFeatures.length)
      const fieldName = getFeatureName(
        feature.properties,
        `${sourceName} — Field ${polygonFeatures.length + 1}`
      )

      polygonFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [(geometry.coordinates?.[0] ?? []).length ? ensureClosedRing(geometry.coordinates[0]) : []],
        } as Polygon,
        properties: {
          ...(feature.properties ?? {}),
          __fieldId: fieldId,
          __fieldName: fieldName,
        },
      })

      lineBuckets.set(fieldName.toLowerCase(), fieldId)
      continue
    }

    if (geometry.type === 'MultiPolygon') {
      const fieldName = getFeatureName(
        feature.properties,
        `${sourceName} — Field ${polygonFeatures.length + 1}`
      )

      for (const polygon of geometry.coordinates) {
        const fieldId = createFieldId(polygonFeatures.length)
        polygonFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: polygon.map((ring) => ensureClosedRing(ring)),
          } as Polygon,
          properties: {
            ...(feature.properties ?? {}),
            __fieldId: fieldId,
            __fieldName: fieldName,
          },
        })
        lineBuckets.set(fieldName.toLowerCase(), fieldId)
      }
      continue
    }

    if (geometry.type === 'LineString') {
      const lineName = getFeatureName(
        feature.properties,
        `${sourceName} — Guidance ${guidanceFeatures.length + 1}`
      )
      const normalizedParentName =
        typeof feature.properties?.__parentFieldName === 'string'
          ? feature.properties.__parentFieldName.trim()
          : ''

      guidanceFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: geometry.coordinates,
        } as LineString,
        properties: {
          ...(feature.properties ?? {}),
          __guidanceId: createGuidanceId(guidanceFeatures.length),
          __guidanceName: lineName,
          __parentFieldName: normalizedParentName || undefined,
          __parentFieldId: normalizedParentName
            ? lineBuckets.get(normalizedParentName.toLowerCase())
            : undefined,
        },
      })
      continue
    }

    if (geometry.type === 'MultiLineString') {
      const lineName = getFeatureName(
        feature.properties,
        `${sourceName} — Guidance ${guidanceFeatures.length + 1}`
      )
      const normalizedParentName =
        typeof feature.properties?.__parentFieldName === 'string'
          ? feature.properties.__parentFieldName.trim()
          : ''

      for (const segment of geometry.coordinates) {
        guidanceFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: segment,
          } as LineString,
          properties: {
            ...(feature.properties ?? {}),
            __guidanceId: createGuidanceId(guidanceFeatures.length),
            __guidanceName: lineName,
            __parentFieldName: normalizedParentName || undefined,
            __parentFieldId: normalizedParentName
              ? lineBuckets.get(normalizedParentName.toLowerCase())
              : undefined,
          },
        })
      }
    }
  }

  return {
    collection: {
      type: 'FeatureCollection',
      features: polygonFeatures as any,
    },
    guidanceCollection:
      guidanceFeatures.length > 0
        ? {
            type: 'FeatureCollection',
            features: guidanceFeatures,
          }
        : null,
    sourceName,
    sourceType: sourceName.split('.').pop()?.toUpperCase() ?? 'UNKNOWN',
  }
}

function parseGeoJSONText(text: string, sourceName: string): ImportParseResult {
  return normalizeImportResult(JSON.parse(text), sourceName)
}

function parseCoordinatesText(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .map((chunk) => chunk.split(',').map(Number))
    .filter((coords) => Number.isFinite(coords[0]) && Number.isFinite(coords[1]))
    .map(([longitude, latitude]) => [longitude, latitude] as Position)
}

function parseKMLText(text: string, sourceName: string): ImportParseResult {
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'text/xml')
  const converted = kmlToGeoJSON(xml)
  const normalized = normalizeImportResult(converted, sourceName)

  const placemarks = Array.from(xml.getElementsByTagName('Placemark'))
  const extraPolygons: AppFeature[] = []
  const extraLines: AppLineFeature[] = []

  for (const placemark of placemarks) {
    const lineNode = placemark.getElementsByTagName('LineString')[0]
    if (!lineNode) continue

    const coordinatesNode = lineNode.getElementsByTagName('coordinates')[0]
    if (!coordinatesNode?.textContent) continue

    const coordinates = parseCoordinatesText(coordinatesNode.textContent)
    if (coordinates.length < 2) continue

    const nameNode = placemark.getElementsByTagName('name')[0]
    const styleUrlNode = placemark.getElementsByTagName('styleUrl')[0]
    const rawName = nameNode?.textContent?.trim() || ''
    const styleUrl = styleUrlNode?.textContent?.trim() || ''
    const parentName = placemark.parentElement?.getElementsByTagName('name')[0]?.textContent?.trim() || ''
    const parsedLineParent = rawName.includes(' - ') ? rawName.split(' - ')[0].trim() : ''

    const first = coordinates[0]
    const last = coordinates[coordinates.length - 1]
    const isClosed = Math.abs(first[0] - last[0]) < 0.0001 && Math.abs(first[1] - last[1]) < 0.0001
    const looksLikeBoundary = /boundary|contour/i.test(styleUrl) || /boundary|contour/i.test(rawName)

    if ((looksLikeBoundary || isClosed) && coordinates.length >= 4) {
      const fieldName = rawName.replace(/\s*(boundary|contour)$/i, '').trim() || parentName || `${sourceName} — Field ${normalized.collection.features.length + extraPolygons.length + 1}`
      const fieldId = createFieldId(normalized.collection.features.length + extraPolygons.length)
      extraPolygons.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [ensureClosedRing(coordinates)],
        } as Polygon,
        properties: {
          __fieldId: fieldId,
          __fieldName: fieldName,
          source: 'KML',
        },
      })
      continue
    }

    extraLines.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: {
        __guidanceId: createGuidanceId((normalized.guidanceCollection?.features.length ?? 0) + extraLines.length),
        __guidanceName: rawName || `${sourceName} — Guidance ${extraLines.length + 1}`,
        __parentFieldName: parsedLineParent || parentName || undefined,
        source: 'KML',
      },
    })
  }

  if (extraPolygons.length > 0) {
    normalized.collection = {
      type: 'FeatureCollection',
      features: [...normalized.collection.features, ...extraPolygons] as any,
    }
  }

  if (extraLines.length > 0) {
    normalized.guidanceCollection = {
      type: 'FeatureCollection',
      features: [...(normalized.guidanceCollection?.features ?? []), ...extraLines],
    }
  }

  return normalized
}

function getDirectChildrenByTagName(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.tagName === tagName)
}

function parseIsoPointStrict(pnt: Element): Position | null {
  const rawLat = pnt.getAttribute('C')
  const rawLon = pnt.getAttribute('D')

  if (!rawLat || !rawLon) return null

  let lat = Number(rawLat)
  let lon = Number(rawLon)

  if (Number.isNaN(lat) || Number.isNaN(lon)) return null

  const scaleDown = (value: number, limit: number) => {
    if (Math.abs(value) <= limit) return value

    const divisors = [10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000]

    for (const divisor of divisors) {
      const scaled = value / divisor
      if (Math.abs(scaled) <= limit) return scaled
    }

    return value
  }

  lat = scaleDown(lat, 90)
  lon = scaleDown(lon, 180)

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null

  return [lon, lat]
}

function buildPolygonFromPln(pln: Element): Position[][] | null {
  const lsgNodes = getDirectChildrenByTagName(pln, 'LSG')
  if (lsgNodes.length === 0) return null

  const outerRings: Position[][] = []
  const innerRings: Position[][] = []

  for (const lsg of lsgNodes) {
    const lsgType = lsg.getAttribute('A')
    const pntNodes = getDirectChildrenByTagName(lsg, 'PNT')

    const ring = pntNodes
      .map((pnt) => parseIsoPointStrict(pnt))
      .filter((value): value is Position => value !== null)

    const closedRing = ensureClosedRing(ring)
    if (closedRing.length < 4) continue

    if (lsgType === '1') outerRings.push(closedRing)
    else if (lsgType === '2') innerRings.push(closedRing)
  }

  if (outerRings.length === 0) return null
  return [outerRings[0], ...innerRings]
}

function buildLineFromLsg(lsg: Element): Position[] | null {
  const pntNodes = getDirectChildrenByTagName(lsg, 'PNT')
  const line = pntNodes
    .map((pnt) => parseIsoPointStrict(pnt))
    .filter((value): value is Position => value !== null)

  return line.length >= 2 ? line : null
}

function parseIsoXmlText(text: string): {
  collection: AppPolygonCollection
  guidanceCollection: AppGuidanceCollection | null
} {
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'text/xml')

  const pfdNodes = Array.from(xml.getElementsByTagName('PFD'))
  const polygonFeatures: AppFeature[] = []
  const guidanceFeatures: AppLineFeature[] = []

  pfdNodes.forEach((pfdNode) => {
    const fieldId = pfdNode.getAttribute('A') || createFieldId(polygonFeatures.length)
    const fieldName =
      pfdNode.getAttribute('C') ||
      pfdNode.getAttribute('B') ||
      pfdNode.getAttribute('A') ||
      `ISOXML Field ${polygonFeatures.length + 1}`

    const plnNodes = getDirectChildrenByTagName(pfdNode, 'PLN')

    for (const pln of plnNodes) {
      const coordinates = buildPolygonFromPln(pln)
      if (!coordinates) continue

      polygonFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates,
        },
        properties: {
          __fieldId: fieldId,
          __fieldName: fieldName,
          source: 'ISOXML',
        },
      })
    }

    const pfdLsgNodes = getDirectChildrenByTagName(pfdNode, 'LSG')
    for (const lsg of pfdLsgNodes) {
      if (lsg.getAttribute('A') !== '5') continue
      const coordinates = buildLineFromLsg(lsg)
      if (!coordinates) continue

      guidanceFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {
          __guidanceId: createGuidanceId(guidanceFeatures.length),
          __guidanceName:
            lsg.getAttribute('B') || `${fieldName} — Guidance ${guidanceFeatures.length + 1}`,
          __parentFieldId: fieldId,
          __parentFieldName: fieldName,
          source: 'ISOXML',
          guidanceSource: 'PFD.LSG',
        },
      })
    }

    const ggpNodes = getDirectChildrenByTagName(pfdNode, 'GGP')
    for (const ggp of ggpNodes) {
      const gpnNodes = getDirectChildrenByTagName(ggp, 'GPN')
      for (const gpn of gpnNodes) {
        const gpnName =
          gpn.getAttribute('B') || `${fieldName} — Pattern ${guidanceFeatures.length + 1}`
        const gpnLsgNodes = getDirectChildrenByTagName(gpn, 'LSG')

        for (const lsg of gpnLsgNodes) {
          const coordinates = buildLineFromLsg(lsg)
          if (!coordinates) continue

          guidanceFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {
              __guidanceId: createGuidanceId(guidanceFeatures.length),
              __guidanceName: gpnName,
              __parentFieldId: fieldId,
              __parentFieldName: fieldName,
              source: 'ISOXML',
              guidanceSource: 'GGP.GPN.LSG',
              patternType: gpn.getAttribute('C') ?? null,
            },
          })
        }
      }
    }
  })

  if (polygonFeatures.length === 0 && guidanceFeatures.length === 0) {
    throw new Error('ISOXML polygons or guidance lines were not found in this file.')
  }

  return {
    collection: { type: 'FeatureCollection', features: polygonFeatures as any },
    guidanceCollection:
      guidanceFeatures.length > 0
        ? { type: 'FeatureCollection', features: guidanceFeatures }
        : null,
  }
}

async function parseKMZFile(file: File): Promise<ImportParseResult> {
  const arrayBuffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)

  const kmlEntry = Object.values(zip.files).find(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.kml')
  )

  if (!kmlEntry) {
    throw new Error('KMZ does not contain a KML file.')
  }

  const kmlText = await kmlEntry.async('string')
  return parseKMLText(kmlText, file.name)
}

async function parseZIPFile(file: File): Promise<ImportParseResult> {
  const arrayBuffer = await file.arrayBuffer()

  try {
    const shpResult = await shp(arrayBuffer)
    const normalized = normalizeImportResult(shpResult, file.name)

    if (
      normalized.collection.features.length > 0 ||
      (normalized.guidanceCollection?.features.length ?? 0) > 0
    ) {
      return {
        ...normalized,
        sourceName: file.name,
        sourceType: 'ZIP',
      }
    }
  } catch {
    // continue to other zip formats
  }

  const zip = await JSZip.loadAsync(arrayBuffer)
  const files = Object.values(zip.files).filter((entry) => !entry.dir)

  const taskDataEntry = files.find((entry) =>
    entry.name.toLowerCase().endsWith('taskdata.xml')
  )
  if (taskDataEntry) {
    const text = await taskDataEntry.async('string')
    const iso = parseIsoXmlText(text)
    return {
      collection: iso.collection,
      guidanceCollection: iso.guidanceCollection,
      sourceName: file.name,
      sourceType: 'ZIP',
    }
  }

  const iniEntry = files.find((entry) => entry.name.toLowerCase().endsWith('.ini'))
  const kmlEntry = files.find((entry) => entry.name.toLowerCase().endsWith('.kml'))
  if (kmlEntry) {
    const text = await kmlEntry.async('string')
    return {
      ...parseKMLText(text, kmlEntry.name.split('/').pop() || file.name),
      sourceName: file.name,
      sourceType: iniEntry ? 'FIELD_PACKAGE' : 'ZIP',
    }
  }

  const xmlEntry = files.find((entry) => entry.name.toLowerCase().endsWith('.xml'))
  if (xmlEntry) {
    const text = await xmlEntry.async('string')
    const iso = parseIsoXmlText(text)
    return {
      collection: iso.collection,
      guidanceCollection: iso.guidanceCollection,
      sourceName: file.name,
      sourceType: 'ZIP',
    }
  }

  throw new Error('ZIP file format is not supported or no valid GIS data was found.')
}

export async function parseImportedFile(file: File): Promise<ImportParseResult> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (extension === 'geojson' || extension === 'json') {
    const parsed = parseGeoJSONText(await file.text(), file.name)
    return { ...parsed, sourceType: extension.toUpperCase() }
  }

  if (extension === 'kml') {
    return {
      ...parseKMLText(await file.text(), file.name),
      sourceType: 'KML',
    }
  }

  if (extension === 'kmz') {
    const result = await parseKMZFile(file)
    return { ...result, sourceType: 'KMZ' }
  }

  if (extension === 'zip') {
    return parseZIPFile(file)
  }

  if (extension === 'xml' || extension === 'isoxml') {
    const iso = parseIsoXmlText(await file.text())
    return {
      collection: iso.collection,
      guidanceCollection: iso.guidanceCollection,
      sourceName: file.name,
      sourceType: extension.toUpperCase(),
    }
  }

  if (extension === 'shp') {
    throw new Error(
      'Single .shp file is not enough. Import ZIP with .shp + .shx + .dbf, or drag all shapefile parts into one ZIP.'
    )
  }

  throw new Error('Unsupported format.')
}
