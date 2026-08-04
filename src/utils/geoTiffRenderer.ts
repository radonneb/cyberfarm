import { fromArrayBuffer } from 'geotiff'
import type { LatLngBoundsExpression } from 'leaflet'
import proj4 from 'proj4'

export type RenderedGeoTiff = {
  rasterUrl: string
  rasterBounds: LatLngBoundsExpression
  crs: string
  widthPixels: number
  heightPixels: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0
  values.sort((a, b) => a - b)
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]
}

function sourceProjection(epsg: number | undefined, citation: string) {
  if (epsg === 4326 || epsg === 4258) return 'EPSG:4326'
  if (epsg === 3857) return 'EPSG:3857'
  if (epsg >= 32601 && epsg <= 32660) {
    return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`
  }
  if (epsg >= 32701 && epsg <= 32760) {
    return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`
  }
  const match = citation.match(/UTM\s+zone\s+(\d{1,2})([NS])?/i)
  if (match) {
    return `+proj=utm +zone=${Number(match[1])}${match[2]?.toUpperCase() === 'S' ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`
  }
  throw new Error(`GeoTIFF CRS ${epsg ? `EPSG:${epsg}` : 'metadata'} is not supported. Export the layer with an EPSG code or WGS84/UTM definition.`)
}

export async function renderGeoTiff(file: File): Promise<RenderedGeoTiff> {
  const tiff = await fromArrayBuffer(await file.arrayBuffer())
  const image = await tiff.getImage()
  const sourceWidth = image.getWidth()
  const sourceHeight = image.getHeight()
  const ratio = Math.min(1, 1400 / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * ratio))
  const height = Math.max(1, Math.round(sourceHeight * ratio))
  const samples = Math.max(1, image.getSamplesPerPixel())
  const raster = await image.readRasters({ width, height, interleave: true }) as unknown as ArrayLike<number>
  const noDataText = image.getGDALNoData()
  const noData = noDataText === null ? null : Number(noDataText)
  const [minX, minY, maxX, maxY] = image.getBoundingBox()
  const keys = image.getGeoKeys() as {
    ProjectedCSTypeGeoKey?: number
    GeographicTypeGeoKey?: number
    PCSCitationGeoKey?: string
    GTCitationGeoKey?: string
    GeogCitationGeoKey?: string
  }
  const rawEpsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey
  const citation = `${keys.PCSCitationGeoKey ?? ''} ${keys.GTCitationGeoKey ?? ''} ${keys.GeogCitationGeoKey ?? ''}`.trim()
  const inferredEpsg = rawEpsg ?? (
    Math.abs(minX) <= 180 && Math.abs(maxX) <= 180 && Math.abs(minY) <= 90 && Math.abs(maxY) <= 90
      ? 4326
      : undefined
  )
  const crs = rawEpsg && rawEpsg !== 32767 ? `EPSG:${rawEpsg}` : (citation || (inferredEpsg ? `EPSG:${inferredEpsg}` : 'Unknown CRS'))
  const projection = sourceProjection(inferredEpsg, citation)

  const transformToWgs = (x: number, y: number) => proj4(projection, 'EPSG:4326', [x, y])
  const edgePoints: [number, number][] = []
  for (let step = 0; step <= 8; step += 1) {
    const t = step / 8
    edgePoints.push(
      [minX + (maxX - minX) * t, minY],
      [minX + (maxX - minX) * t, maxY],
      [minX, minY + (maxY - minY) * t],
      [maxX, minY + (maxY - minY) * t],
    )
  }
  const geographic = edgePoints.map(([x, y]) => transformToWgs(x, y))
  const west = Math.min(...geographic.map(([lon]) => lon))
  const east = Math.max(...geographic.map(([lon]) => lon))
  const south = Math.min(...geographic.map(([, lat]) => lat))
  const north = Math.max(...geographic.map(([, lat]) => lat))

  const bands = Math.min(samples, 3)
  const sampled: number[][] = Array.from({ length: bands }, () => [])
  const sampleStep = Math.max(1, Math.floor((width * height) / 100_000))
  for (let pixel = 0; pixel < width * height; pixel += sampleStep) {
    for (let band = 0; band < bands; band += 1) {
      const value = Number(raster[pixel * samples + band])
      if (!Number.isFinite(value) || (noData !== null && value === noData)) continue
      sampled[band].push(value)
    }
  }
  const low = sampled.map((values) => percentile(values, 0.02))
  const high = sampled.map((values) => percentile(values, 0.98))
  const nativeRgb = bands >= 3 && low.every((value) => value >= 0) && high.every((value) => value <= 255)
  const normalize = (value: number, band: number) => {
    if (nativeRgb) return clamp(value / 255, 0, 1)
    const range = high[band] - low[band]
    return range > 0 ? clamp((value - low[band]) / range, 0, 1) : 0.5
  }

  const sourcePixels = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const values = Array.from({ length: bands }, (_, band) => Number(raster[pixel * samples + band]))
    const invalid = values.some((value) => !Number.isFinite(value) || (noData !== null && value === noData))
    const emptyRgb = bands >= 3 && values.every((value) => value === 0)
    const target = pixel * 4
    if (invalid || emptyRgb) continue
    if (bands >= 3) {
      sourcePixels[target] = Math.round(normalize(values[0], 0) * 255)
      sourcePixels[target + 1] = Math.round(normalize(values[1], 1) * 255)
      sourcePixels[target + 2] = Math.round(normalize(values[2], 2) * 255)
    } else {
      const value = normalize(values[0], 0)
      sourcePixels[target] = Math.round(255 * clamp(1.75 - value * 1.8, 0, 1))
      sourcePixels[target + 1] = Math.round(255 * clamp(value * 1.45, 0, 1))
      sourcePixels[target + 2] = Math.round(120 * clamp(0.8 - Math.abs(value - 0.5), 0, 1))
    }
    sourcePixels[target + 3] = 255
  }

  // Leaflet image overlays are north-up rectangles. Reproject every output pixel
  // instead of transforming only two corners, which visibly shifts UTM rasters.
  const output = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const latitude = north - ((row + 0.5) / height) * (north - south)
    for (let column = 0; column < width; column += 1) {
      const longitude = west + ((column + 0.5) / width) * (east - west)
      const [x, y] = proj4('EPSG:4326', projection, [longitude, latitude])
      const sourceColumn = Math.round(((x - minX) / (maxX - minX)) * width - 0.5)
      const sourceRow = Math.round(((maxY - y) / (maxY - minY)) * height - 0.5)
      if (sourceColumn < 0 || sourceColumn >= width || sourceRow < 0 || sourceRow >= height) continue
      const source = (sourceRow * width + sourceColumn) * 4
      const target = (row * width + column) * 4
      output[target] = sourcePixels[source]
      output[target + 1] = sourcePixels[source + 1]
      output[target + 2] = sourcePixels[source + 2]
      output[target + 3] = sourcePixels[source + 3]
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create GeoTIFF canvas.')
  context.putImageData(new ImageData(output, width, height), 0, 0)
  return {
    rasterUrl: canvas.toDataURL('image/png'),
    rasterBounds: [[south, west], [north, east]],
    crs,
    widthPixels: sourceWidth,
    heightPixels: sourceHeight,
  }
}
