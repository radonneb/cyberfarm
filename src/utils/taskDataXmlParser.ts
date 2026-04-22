import type {
  ClientModel,
  FarmModel,
  FieldBoundary,
  FieldModel,
  GeoPoint,
  GuidanceLine,
  TaskDataModel,
} from '../models/taskData'
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