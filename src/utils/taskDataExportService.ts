import JSZip from 'jszip'
import shpwrite from 'shp-write'
import type {
  ClientModel,
  FarmModel,
  FieldBoundary,
  FieldModel,
  GeoPoint,
  GuidanceLine,
  TaskDataModel,
} from '../models/taskData'
import type { ExportFormat } from '../models/taskData'
import { uid } from '../models/taskData'

function parseNumber(value: string | null) {
  if (!value) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function getDirectChildrenByTagName(parent: Element, tagName: string) {
  return Array.from(parent.children).filter((child) => child.tagName === tagName)
}

function parsePoint(latValue: string | null, lonValue: string | null): GeoPoint | null {
  let latitude = parseNumber(latValue)
  let longitude = parseNumber(lonValue)

  if (latitude == null || longitude == null) return null

  const fixScale = (value: number, limit: number) => {
    if (Math.abs(value) <= limit) return value

    const divisors = [10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000]
    for (const divisor of divisors) {
      const scaled = value / divisor
      if (Math.abs(scaled) <= limit) return scaled
    }

    return value
  }

  latitude = fixScale(latitude, 90)
  longitude = fixScale(longitude, 180)

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null

  return {
    id: uid(),
    latitude,
    longitude,
  }
}

function parsePointsFromNodes(nodes: Element[]): GeoPoint[] {
  return nodes
    .map((pointNode) => parsePoint(pointNode.getAttribute('C'), pointNode.getAttribute('D')))
    .filter((point): point is GeoPoint => point !== null)
}

function parseBoundaryFromPln(pln: Element): FieldBoundary | null {
  const lsgNodes = getDirectChildrenByTagName(pln, 'LSG')

  if (lsgNodes.length > 0) {
    const outer = lsgNodes.find((lsg) => lsg.getAttribute('A') === '1') ?? lsgNodes[0]
    const points = parsePointsFromNodes(getDirectChildrenByTagName(outer, 'PNT'))

    if (points.length >= 3) {
      return {
        id: pln.getAttribute('A') || uid(),
        points,
      }
    }
  }

  const flatPoints = parsePointsFromNodes(Array.from(pln.getElementsByTagName('PNT')))
  if (flatPoints.length >= 3) {
    return {
      id: pln.getAttribute('A') || uid(),
      points: flatPoints,
    }
  }

  return null
}

function parseGuidanceLineFromLsg(
  lsg: Element,
  fallbackName: string,
  fallbackId?: string | null
): GuidanceLine | null {
  const points = parsePointsFromNodes(getDirectChildrenByTagName(lsg, 'PNT'))
  if (points.length < 2) return null

  return {
    id: fallbackId || lsg.getAttribute('B') || uid(),
    name: lsg.getAttribute('B') || fallbackName,
    points,
  }
}

export function parseTaskDataXmlString(xmlText: string): TaskDataModel {
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml')

  const parserError = xml.querySelector('parsererror')
  if (parserError) {
    throw new Error('XML parsing error.')
  }

  let client: ClientModel | null = null
  let farm: FarmModel | null = null
  const fields: FieldModel[] = []

  const ctr = xml.getElementsByTagName('CTR')[0]
  if (ctr) {
    client = {
      id: ctr.getAttribute('A') || uid(),
      name: ctr.getAttribute('B') || 'Unknown Client',
    }
  }

  const frm = xml.getElementsByTagName('FRM')[0]
  if (frm) {
    farm = {
      id: frm.getAttribute('A') || uid(),
      name: frm.getAttribute('B') || 'Unknown Farm',
      clientId: frm.getAttribute('I') || undefined,
    }
  }

  const pfdNodes = Array.from(xml.getElementsByTagName('PFD'))

  for (const pfd of pfdNodes) {
    const fieldId = pfd.getAttribute('A') || uid()
    const fieldName =
      pfd.getAttribute('C') || pfd.getAttribute('B') || `Field ${fields.length + 1}`
    const clientId = pfd.getAttribute('E') || client?.id || undefined
    const farmId = pfd.getAttribute('F') || farm?.id || undefined

    const boundaries: FieldBoundary[] = []
    const guidanceLines: GuidanceLine[] = []

    const plnNodes = getDirectChildrenByTagName(pfd, 'PLN')
    for (const pln of plnNodes) {
      const boundary = parseBoundaryFromPln(pln)
      if (boundary) boundaries.push(boundary)
    }

    const directGpnNodes = getDirectChildrenByTagName(pfd, 'GPN')
    for (const gpn of directGpnNodes) {
      const lsgChildren = getDirectChildrenByTagName(gpn, 'LSG')

      if (lsgChildren.length > 0) {
        for (const [index, lsg] of lsgChildren.entries()) {
          const line = parseGuidanceLineFromLsg(
            lsg,
            gpn.getAttribute('B') || `${fieldName} Guidance ${guidanceLines.length + index + 1}`,
            gpn.getAttribute('A') || null
          )
          if (line) guidanceLines.push(line)
        }
      } else {
        const points = parsePointsFromNodes(Array.from(gpn.getElementsByTagName('PNT')))
        if (points.length >= 2) {
          guidanceLines.push({
            id: gpn.getAttribute('A') || uid(),
            name: gpn.getAttribute('B') || `Guidance ${guidanceLines.length + 1}`,
            points,
          })
        }
      }
    }

    const directLsgNodes = getDirectChildrenByTagName(pfd, 'LSG')
    for (const lsg of directLsgNodes) {
      if (lsg.getAttribute('A') !== '5') continue

      const line = parseGuidanceLineFromLsg(
        lsg,
        `${fieldName} Guidance ${guidanceLines.length + 1}`
      )
      if (line) guidanceLines.push(line)
    }

    const ggpNodes = getDirectChildrenByTagName(pfd, 'GGP')
    for (const ggp of ggpNodes) {
      const gpnNodes = getDirectChildrenByTagName(ggp, 'GPN')

      for (const gpn of gpnNodes) {
        const patternName =
          gpn.getAttribute('B') || `Guidance ${guidanceLines.length + 1}`

        const lsgNodes = getDirectChildrenByTagName(gpn, 'LSG')
        if (lsgNodes.length > 0) {
          for (const [index, lsg] of lsgNodes.entries()) {
            const line = parseGuidanceLineFromLsg(
              lsg,
              lsg.getAttribute('B') || patternName,
              `${gpn.getAttribute('A') || uid()}-${index + 1}`
            )
            if (line) guidanceLines.push(line)
          }
        } else {
          const points = parsePointsFromNodes(Array.from(gpn.getElementsByTagName('PNT')))
          if (points.length >= 2) {
            guidanceLines.push({
              id: gpn.getAttribute('A') || uid(),
              name: patternName,
              points,
            })
          }
        }
      }
    }

    if (boundaries.length === 0 && guidanceLines.length === 0) continue

    fields.push({
      id: fieldId,
      name: fieldName,
      clientId,
      farmId,
      boundaries,
      guidanceLines,
    })
  }

  if (fields.length === 0) {
    throw new Error('XML parsed, but PFD fields were not found.')
  }

  return {
    client,
    farm,
    fields,
  }
}

export async function parseTaskDataXmlFile(file: File) {
  const text = await file.text()
  return parseTaskDataXmlString(text)
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9_\-]+/gi, '_')
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function pointXml(point: GeoPoint) {
  return `<PNT A="${point.id}" C="${point.latitude.toFixed(8)}" D="${point.longitude.toFixed(8)}" />`
}

function buildIsoXml(task: TaskDataModel) {
  const clientId = task.client?.id || uid()
  const farmId = task.farm?.id || uid()
  const clientName = xmlEscape(task.client?.name || 'Client')
  const farmName = xmlEscape(task.farm?.name || 'Farm')

  const fieldsXml = task.fields.map((field) => {
    const boundariesXml = field.boundaries.map((boundary) => `
      <PLN A="${boundary.id}">
        <LSG A="1">
          ${boundary.points.map(pointXml).join('')}
        </LSG>
      </PLN>`).join('')

    const guidanceXml = field.guidanceLines.map((line) => `
      <GPN A="${line.id}" B="${xmlEscape(line.name)}">
        ${line.points.map(pointXml).join('')}
      </GPN>`).join('')

    return `
      <PFD A="${field.id}" C="${xmlEscape(field.name)}" E="${field.clientId || clientId}" F="${field.farmId || farmId}">
        ${boundariesXml}
        ${guidanceXml}
      </PFD>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<TSK>
  <CTR A="${clientId}" B="${clientName}" />
  <FRM A="${farmId}" B="${farmName}" I="${clientId}" />
  ${fieldsXml}
</TSK>`
}

function buildKml(task: TaskDataModel) {
  const placemarks = task.fields.flatMap((field) => {
    const boundaryMarks = field.boundaries.map((boundary) => {
      const coords = [...boundary.points, boundary.points[0]]
        .map((point) => `${point.longitude},${point.latitude},0`)
        .join(' ')
      return `
        <Placemark>
          <name>${xmlEscape(field.name)}</name>
          <Polygon>
            <outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>
          </Polygon>
        </Placemark>`
    })

    const lineMarks = field.guidanceLines.map((line) => {
      const coords = line.points.map((point) => `${point.longitude},${point.latitude},0`).join(' ')
      return `
        <Placemark>
          <name>${xmlEscape(`${field.name} - ${line.name}`)}</name>
          <LineString><coordinates>${coords}</coordinates></LineString>
        </Placemark>`
    })

    return [...boundaryMarks, ...lineMarks]
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(task.farm?.name || 'TaskData')}</name>
    ${placemarks}
  </Document>
</kml>`
}

async function buildKmz(task: TaskDataModel) {
  const zip = new JSZip()
  zip.file('doc.kml', buildKml(task))
  return zip.generateAsync({ type: 'blob' })
}

function buildGeoJson(task: TaskDataModel) {
  const features = task.fields.flatMap((field) => {
    const boundaries = field.boundaries
      .filter((boundary) => boundary.points.length >= 3)
      .map((boundary) => ({
        type: 'Feature' as const,
        properties: {
          fieldId: field.id,
          fieldName: field.name,
          type: 'boundary',
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            ...boundary.points.map((point) => [point.longitude, point.latitude]),
            [boundary.points[0].longitude, boundary.points[0].latitude],
          ]],
        },
      }))

    const guidance = field.guidanceLines
      .filter((line) => line.points.length >= 2)
      .map((line) => ({
        type: 'Feature' as const,
        properties: {
          fieldId: field.id,
          fieldName: field.name,
          guidanceId: line.id,
          guidanceName: line.name,
          type: 'guidance',
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: line.points.map((point) => [point.longitude, point.latitude]),
        },
      }))

    return [...boundaries, ...guidance]
  })

  return { type: 'FeatureCollection' as const, features }
}


function buildFieldPackageIni(fieldName: string) {
  const uuid = `{${uid()}}`
  return `[General]
Md5=@ByteArray()
NAME=${fieldName}
TYPE=1
UUID=${uuid}
Version=2.0
`
}

function buildFieldPackageKml(task: TaskDataModel, docName: string) {
  const placemarks = task.fields
    .flatMap((field) => {
      const boundaryMarks = field.boundaries
        .filter((boundary) => boundary.points.length >= 3)
        .map((boundary) => {
          const coords = [...boundary.points, boundary.points[0]]
            .map((point) => `${point.longitude},${point.latitude},0`)
            .join(' ')

          return `
<Placemark>
  <name>${xmlEscape(field.name)} Boundary</name>
  <styleUrl>#BoundaryStyle</styleUrl>
  <LineString>
    <tessellate>1</tessellate>
    <altitudeMode>clampToGround</altitudeMode>
    <coordinates>${coords}</coordinates>
  </LineString>
</Placemark>`
        })

      const waylines = field.guidanceLines
        .filter((line) => line.points.length >= 2)
        .map((line) => {
          const coords = line.points
            .map((point) => `${point.longitude},${point.latitude},0`)
            .join(' ')

          return `
<Placemark>
  <name>${xmlEscape(`${field.name} - ${line.name}`)}</name>
  <styleUrl>#WaylineStyle</styleUrl>
  <ExtendedData>
    <Data name="MapType"><value>1</value></Data>
    <Data name="WaylineType"><value>3</value></Data>
    <Data name="WaylineVersion"><value>1</value></Data>
    <Data name="WaylineSource"><value>2</value></Data>
  </ExtendedData>
  <LineString>
    <tessellate>1</tessellate>
    <altitudeMode>clampToGround</altitudeMode>
    <coordinates>${coords}</coordinates>
  </LineString>
</Placemark>`
        })

      return [...boundaryMarks, ...waylines]
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(docName)}</name>
    <Style id="BoundaryStyle">
      <LineStyle><color>ffff0000</color><width>2</width></LineStyle>
      <BalloonStyle><displayMode>hide</displayMode></BalloonStyle>
    </Style>
    <Style id="WaylineStyle">
      <LineStyle><color>ff0d9eda</color><width>2</width></LineStyle>
      <BalloonStyle><displayMode>hide</displayMode></BalloonStyle>
    </Style>
    ${placemarks}
  </Document>
</kml>`
}

async function buildFieldPackage(task: TaskDataModel, baseName: string) {
  const fieldName = task.fields[0]?.name || baseName
  const zip = new JSZip()
  zip.file(`${baseName}.ini`, buildFieldPackageIni(fieldName))
  zip.file(`${baseName}.kml`, buildFieldPackageKml(task, fieldName))
  return zip.generateAsync({ type: 'blob' })
}

async function exportShp(task: TaskDataModel, baseName: string) {
  const geojson = buildGeoJson(task)
  const buffer = shpwrite.zip(geojson as never)
  const blob = new Blob([buffer], { type: 'application/zip' })
  downloadBlob(blob, `${baseName}.zip`)
}

export async function exportTaskData(task: TaskDataModel, fileName: string, format: ExportFormat) {
  const baseName = safeName(fileName.replace(/\.[^.]+$/, '') || 'TaskData')

  if (format === 'isoxml') {
    downloadBlob(new Blob([buildIsoXml(task)], { type: 'application/xml;charset=utf-8' }), `${baseName}.xml`)
    return
  }

  if (format === 'kml') {
    downloadBlob(new Blob([buildKml(task)], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' }), `${baseName}.kml`)
    return
  }

  if (format === 'kmz') {
    const kmzBlob = await buildKmz(task)
    downloadBlob(kmzBlob, `${baseName}.kmz`)
    return
  }

  if (format === 'shp') {
    await exportShp(task, baseName)
    return
  }

  if (format === 'fieldpackage') {
    const fieldPackage = await buildFieldPackage(task, baseName)
    downloadBlob(fieldPackage, `${baseName}.zip`)
    return
  }

  throw new Error('Unsupported export format')
}
