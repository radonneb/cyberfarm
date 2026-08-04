import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldAreaSqMeters } from '../appHelpers'
import type { FieldModel, GeoPoint } from '../models/taskData'
import { useAppStore } from '../store/appStore'

type LocalPoint = { x: number; y: number }

type CropId = 'corn' | 'wheat' | 'barley' | 'sunflower' | 'soybean' | 'custom'

type CropProfile = {
  id: CropId
  label: string
  unitLabel: string
  grainLabel: string
  unitsPerPlant: number
  grainsPerUnit: number
  sampleCount: number
  sampleWeightGrams: number
}

type PlantingGeometry = {
  polygons: LocalPoint[][]
  minX: number
  maxX: number
  minY: number
  maxY: number
  directionLabel: string
}

const cropProfiles: CropProfile[] = [
  {
    id: 'corn',
    label: 'Corn',
    unitLabel: 'Ears per plant',
    grainLabel: 'Kernels per ear',
    unitsPerPlant: 1,
    grainsPerUnit: 600,
    sampleCount: 100,
    sampleWeightGrams: 32,
  },
  {
    id: 'wheat',
    label: 'Wheat',
    unitLabel: 'Productive heads per plant',
    grainLabel: 'Grains per head',
    unitsPerPlant: 1.4,
    grainsPerUnit: 36,
    sampleCount: 100,
    sampleWeightGrams: 4.5,
  },
  {
    id: 'barley',
    label: 'Barley',
    unitLabel: 'Productive heads per plant',
    grainLabel: 'Grains per head',
    unitsPerPlant: 1.3,
    grainsPerUnit: 28,
    sampleCount: 100,
    sampleWeightGrams: 4.4,
  },
  {
    id: 'sunflower',
    label: 'Sunflower',
    unitLabel: 'Heads per plant',
    grainLabel: 'Seeds per head',
    unitsPerPlant: 1,
    grainsPerUnit: 900,
    sampleCount: 100,
    sampleWeightGrams: 6,
  },
  {
    id: 'soybean',
    label: 'Soybean',
    unitLabel: 'Pods per plant',
    grainLabel: 'Seeds per pod',
    unitsPerPlant: 35,
    grainsPerUnit: 2.5,
    sampleCount: 100,
    sampleWeightGrams: 18,
  },
  {
    id: 'custom',
    label: 'Custom crop',
    unitLabel: 'Yield units per plant',
    grainLabel: 'Grains per unit',
    unitsPerPlant: 1,
    grainsPerUnit: 100,
    sampleCount: 100,
    sampleWeightGrams: 10,
  },
]

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100_000 ? 2 : 0,
  }).format(Number.isFinite(value) ? value : 0)
}

function toLocal(point: GeoPoint, latitude: number, longitude: number): LocalPoint {
  const metersPerLongitude = 111_320 * Math.cos((latitude * Math.PI) / 180)
  return {
    x: (point.longitude - longitude) * metersPerLongitude,
    y: (point.latitude - latitude) * 111_320,
  }
}

function rotate(point: LocalPoint, angle: number): LocalPoint {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  }
}

function longestBoundaryDirection(polygons: LocalPoint[][]) {
  let best = { length: 0, angle: 0 }
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]
      const end = polygon[(index + 1) % polygon.length]
      const dx = end.x - start.x
      const dy = end.y - start.y
      const length = Math.hypot(dx, dy)
      if (length > best.length) best = { length, angle: Math.atan2(dy, dx) }
    }
  }
  return best.angle
}

function buildGeometry(field: FieldModel | null): PlantingGeometry | null {
  const allPoints = field?.boundaries.flatMap((boundary) => boundary.points) ?? []
  if (!field || allPoints.length < 3) return null

  const latitude = allPoints.reduce((sum, point) => sum + point.latitude, 0) / allPoints.length
  const longitude = allPoints.reduce((sum, point) => sum + point.longitude, 0) / allPoints.length
  const localPolygons = field.boundaries
    .filter((boundary) => boundary.points.length >= 3)
    .map((boundary) => boundary.points.map((point) => toLocal(point, latitude, longitude)))

  const guidance = field.guidanceLines.find((line) => line.points.length >= 2)
  let direction = longestBoundaryDirection(localPolygons)
  let directionLabel = 'Longest field edge'

  if (guidance) {
    const start = toLocal(guidance.points[0], latitude, longitude)
    const end = toLocal(guidance.points[guidance.points.length - 1], latitude, longitude)
    direction = Math.atan2(end.y - start.y, end.x - start.x)
    directionLabel = `Guidance: ${guidance.name}`
  }

  const polygons = localPolygons.map((polygon) =>
    polygon.map((point) => rotate(point, -direction)),
  )
  const rotatedPoints = polygons.flat()
  const minX = Math.min(...rotatedPoints.map((point) => point.x))
  const maxX = Math.max(...rotatedPoints.map((point) => point.x))
  const minY = Math.min(...rotatedPoints.map((point) => point.y))
  const maxY = Math.max(...rotatedPoints.map((point) => point.y))

  return { polygons, minX, maxX, minY, maxY, directionLabel }
}

function tracePolygons(
  context: CanvasRenderingContext2D,
  polygons: LocalPoint[][],
  project: (point: LocalPoint) => LocalPoint,
) {
  context.beginPath()
  for (const polygon of polygons) {
    polygon.forEach((point, index) => {
      const projected = project(point)
      if (index === 0) context.moveTo(projected.x, projected.y)
      else context.lineTo(projected.x, projected.y)
    })
    context.closePath()
  }
}

function drawLegendDot(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
) {
  context.fillStyle = color
  context.beginPath()
  context.arc(x, y, 4, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#dce9e1'
  context.font = '600 11px ui-sans-serif, system-ui, sans-serif'
  context.fillText(label, x + 10, y + 4)
}

function drawOneSquareMeter(
  context: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  rowSpacingMeters: number,
  seedSpacingMeters: number,
  seedsPerSquareMeter: number,
) {
  const insetWidth = clamp(canvasWidth * 0.29, 190, 250)
  const insetHeight = 184
  const left = canvasWidth - insetWidth - 18
  const top = canvasWidth < 600 ? 18 : canvasHeight - insetHeight - 18
  const gridSize = 118
  const gridLeft = left + 18
  const gridTop = top + 42

  context.save()
  context.fillStyle = 'rgba(3, 17, 11, 0.94)'
  context.strokeStyle = 'rgba(105, 220, 255, 0.38)'
  context.lineWidth = 1
  context.beginPath()
  context.roundRect(left, top, insetWidth, insetHeight, 16)
  context.fill()
  context.stroke()

  context.fillStyle = '#f4f8f5'
  context.font = '800 12px ui-sans-serif, system-ui, sans-serif'
  context.fillText('1 m² DETAIL', left + 18, top + 23)
  context.fillStyle = '#8fa79a'
  context.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  context.textAlign = 'right'
  context.fillText(`${formatNumber(seedsPerSquareMeter, 2)} planted seeds / m²`, left + insetWidth - 18, top + 23)
  context.textAlign = 'left'

  context.fillStyle = 'rgba(105, 220, 255, 0.055)'
  context.fillRect(gridLeft, gridTop, gridSize, gridSize)
  context.strokeStyle = 'rgba(105, 220, 255, 0.55)'
  context.strokeRect(gridLeft, gridTop, gridSize, gridSize)

  const safeRowSpacing = Math.max(0.01, rowSpacingMeters)
  const safeSeedSpacing = Math.max(0.01, seedSpacingMeters)
  const rowCount = Math.ceil(1 / safeRowSpacing) + 2
  const seedCount = Math.ceil(1 / safeSeedSpacing) + 2
  const dotScale = Math.max(1.8, Math.min(3.5, 18 / Math.sqrt(Math.max(1, seedsPerSquareMeter))))
  let rendered = 0

  context.fillStyle = '#69dcff'
  for (let row = -1; row <= rowCount && rendered < 450; row += 1) {
    const yMeters = row * safeRowSpacing + safeRowSpacing / 2
    if (yMeters < 0 || yMeters > 1) continue
    for (let seed = -1; seed <= seedCount && rendered < 450; seed += 1) {
      const xMeters = seed * safeSeedSpacing + safeSeedSpacing / 2
      if (xMeters < 0 || xMeters > 1) continue
      context.beginPath()
      context.arc(
        gridLeft + xMeters * gridSize,
        gridTop + (1 - yMeters) * gridSize,
        dotScale,
        0,
        Math.PI * 2,
      )
      context.fill()
      rendered += 1
    }
  }

  context.fillStyle = '#8fa79a'
  context.font = '600 9px ui-sans-serif, system-ui, sans-serif'
  context.fillText('1 metre', gridLeft + 42, gridTop + gridSize + 15)
  context.save()
  context.translate(gridLeft - 9, gridTop + 78)
  context.rotate(-Math.PI / 2)
  context.fillText('1 metre', 0, 0)
  context.restore()
  context.restore()
}

function drawPlantingCanvas(
  canvas: HTMLCanvasElement,
  geometry: PlantingGeometry,
  workingWidthMeters: number,
  openerCount: number,
  seedSpacingMeters: number,
  seedsPerSquareMeter: number,
) {
  const parent = canvas.parentElement
  if (!parent) return

  const width = Math.max(320, parent.clientWidth)
  const height = Math.max(420, parent.clientHeight)
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(width * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)

  const background = context.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, '#07170f')
  background.addColorStop(0.55, '#0a2117')
  background.addColorStop(1, '#06110c')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)

  const padding = width < 720 ? 28 : 48
  const footerSpace = 52
  const extentWidth = Math.max(1, geometry.maxX - geometry.minX)
  const extentHeight = Math.max(1, geometry.maxY - geometry.minY)
  const scale = Math.min(
    (width - padding * 2) / extentWidth,
    (height - padding * 2 - footerSpace) / extentHeight,
  )
  const drawWidth = extentWidth * scale
  const drawHeight = extentHeight * scale
  const originX = (width - drawWidth) / 2
  const originY = (height - footerSpace - drawHeight) / 2

  const project = (point: LocalPoint): LocalPoint => ({
    x: originX + (point.x - geometry.minX) * scale,
    y: originY + (geometry.maxY - point.y) * scale,
  })

  tracePolygons(context, geometry.polygons, project)
  context.fillStyle = 'rgba(77, 187, 120, 0.11)'
  context.fill('evenodd')
  context.strokeStyle = 'rgba(154, 236, 181, 0.84)'
  context.lineWidth = 2
  context.stroke()

  context.save()
  tracePolygons(context, geometry.polygons, project)
  context.clip('evenodd')

  const safeWidth = Math.max(0.1, workingWidthMeters)
  const rows = Math.max(1, Math.round(openerCount))
  const rowSpacing = safeWidth / rows

  context.strokeStyle = 'rgba(242, 201, 76, 0.54)'
  context.lineWidth = 1.25
  const firstPass = Math.floor(geometry.minY / safeWidth) * safeWidth
  for (let y = firstPass; y <= geometry.maxY + safeWidth; y += safeWidth) {
    const start = project({ x: geometry.minX, y })
    const end = project({ x: geometry.maxX, y })
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
    context.stroke()
  }

  const minimumDotPixels = 7
  const rowStride = Math.max(1, Math.ceil(minimumDotPixels / Math.max(0.01, rowSpacing * scale)))
  const seedStride = Math.max(1, Math.ceil(minimumDotPixels / Math.max(0.01, seedSpacingMeters * scale)))
  const visualRowStep = rowSpacing * rowStride
  const visualSeedStep = seedSpacingMeters * seedStride
  const firstRow = Math.floor(geometry.minY / visualRowStep) * visualRowStep
  const firstSeed = Math.floor(geometry.minX / visualSeedStep) * visualSeedStep

  context.fillStyle = 'rgba(91, 220, 137, 0.82)'
  for (let y = firstRow; y <= geometry.maxY; y += visualRowStep) {
    for (let x = firstSeed; x <= geometry.maxX; x += visualSeedStep) {
      const dot = project({ x, y })
      context.beginPath()
      context.arc(dot.x, dot.y, 1.55, 0, Math.PI * 2)
      context.fill()
    }
  }

  const centerX = (geometry.minX + geometry.maxX) / 2
  const centerY = (geometry.minY + geometry.maxY) / 2
  const hectareSize = Math.min(100, extentWidth, extentHeight)
  const hectare = {
    left: centerX - hectareSize / 2,
    right: centerX + hectareSize / 2,
    bottom: centerY - hectareSize / 2,
    top: centerY + hectareSize / 2,
  }

  context.save()
  const hectareTopLeft = project({ x: hectare.left, y: hectare.top })
  const hectareBottomRight = project({ x: hectare.right, y: hectare.bottom })
  context.beginPath()
  context.rect(
    hectareTopLeft.x,
    hectareTopLeft.y,
    hectareBottomRight.x - hectareTopLeft.x,
    hectareBottomRight.y - hectareTopLeft.y,
  )
  context.clip()
  context.fillStyle = 'rgba(242, 201, 76, 0.9)'
  const hectareDotPixels = 4
  const hectareRowStride = Math.max(1, Math.ceil(hectareDotPixels / Math.max(0.01, rowSpacing * scale)))
  const hectareSeedStride = Math.max(1, Math.ceil(hectareDotPixels / Math.max(0.01, seedSpacingMeters * scale)))
  for (let y = hectare.bottom; y <= hectare.top; y += rowSpacing * hectareRowStride) {
    for (let x = hectare.left; x <= hectare.right; x += seedSpacingMeters * hectareSeedStride) {
      const dot = project({ x, y })
      context.beginPath()
      context.arc(dot.x, dot.y, 1.45, 0, Math.PI * 2)
      context.fill()
    }
  }
  context.restore()
  context.restore()

  const hectareOutlineTopLeft = project({
    x: (geometry.minX + geometry.maxX) / 2 - Math.min(100, extentWidth, extentHeight) / 2,
    y: (geometry.minY + geometry.maxY) / 2 + Math.min(100, extentWidth, extentHeight) / 2,
  })
  const hectareOutlineBottomRight = project({
    x: (geometry.minX + geometry.maxX) / 2 + Math.min(100, extentWidth, extentHeight) / 2,
    y: (geometry.minY + geometry.maxY) / 2 - Math.min(100, extentWidth, extentHeight) / 2,
  })
  context.strokeStyle = '#f2c94c'
  context.lineWidth = 2
  context.strokeRect(
    hectareOutlineTopLeft.x,
    hectareOutlineTopLeft.y,
    hectareOutlineBottomRight.x - hectareOutlineTopLeft.x,
    hectareOutlineBottomRight.y - hectareOutlineTopLeft.y,
  )
  context.fillStyle = '#f2c94c'
  context.font = '800 10px ui-sans-serif, system-ui, sans-serif'
  context.fillText('1 HA SAMPLE', hectareOutlineTopLeft.x + 7, hectareOutlineTopLeft.y + 15)

  const center = project({
    x: (geometry.minX + geometry.maxX) / 2,
    y: (geometry.minY + geometry.maxY) / 2,
  })
  context.strokeStyle = '#69dcff'
  context.lineWidth = 2
  context.beginPath()
  context.arc(center.x, center.y, 7, 0, Math.PI * 2)
  context.stroke()
  context.beginPath()
  context.moveTo(center.x - 11, center.y)
  context.lineTo(center.x + 11, center.y)
  context.moveTo(center.x, center.y - 11)
  context.lineTo(center.x, center.y + 11)
  context.stroke()

  context.fillStyle = 'rgba(2, 14, 8, 0.76)'
  context.beginPath()
  context.roundRect(14, height - 42, Math.min(460, width - 28), 30, 12)
  context.fill()
  drawLegendDot(context, 30, height - 27, '#5bdc89', 'Whole field')
  drawLegendDot(context, 135, height - 27, '#f2c94c', '1 ha sample')
  drawLegendDot(context, 242, height - 27, '#69dcff', '1 m² detail')

  drawOneSquareMeter(
    context,
    width,
    height,
    rowSpacing,
    seedSpacingMeters,
    seedsPerSquareMeter,
  )
}

export default function PlantingPage() {
  const { loadedTaskData, selectedFieldId, setSelectedFieldId } = useAppStore()
  const fields = useMemo(() => loadedTaskData?.fields ?? [], [loadedTaskData?.fields])
  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? fields[0] ?? null
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)

  const [workingWidth, setWorkingWidth] = useState(6)
  const [openerCount, setOpenerCount] = useState(8)
  const [seedSpacingCm, setSeedSpacingCm] = useState(16)
  const [yieldEnabled, setYieldEnabled] = useState(false)
  const [cropId, setCropId] = useState<CropId>('corn')
  const [establishmentPercent, setEstablishmentPercent] = useState(100)
  const [unitsPerPlant, setUnitsPerPlant] = useState(1)
  const [grainsPerUnit, setGrainsPerUnit] = useState(600)
  const [sampleCount, setSampleCount] = useState(100)
  const [sampleWeightGrams, setSampleWeightGrams] = useState(32)
  const [sizeVersion, setSizeVersion] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const profile = cropProfiles.find((item) => item.id === cropId) ?? cropProfiles[0]
  const areaSqMeters = useMemo(() => fieldAreaSqMeters(selectedField), [selectedField])
  const geometry = useMemo(() => buildGeometry(selectedField), [selectedField])

  const result = useMemo(() => {
    const safeWidth = Math.max(0.1, workingWidth)
    const safeOpeners = Math.max(1, Math.round(openerCount))
    const spacingMeters = Math.max(0.005, seedSpacingCm / 100)
    const rowSpacingMeters = safeWidth / safeOpeners
    const seedsPerSquareMeter = 1 / (rowSpacingMeters * spacingMeters)
    const seedsPerHectare = seedsPerSquareMeter * 10_000
    const totalSeeds = seedsPerSquareMeter * areaSqMeters
    const totalTravelMeters = areaSqMeters / safeWidth
    const crossFieldMeters = geometry ? geometry.maxY - geometry.minY : 0
    const passCount = Math.max(0, Math.ceil(crossFieldMeters / safeWidth))
    const establishedPlantsPerSquareMeter = seedsPerSquareMeter * clamp(establishmentPercent, 0, 100) / 100
    const harvestGrainsPerSquareMeter =
      establishedPlantsPerSquareMeter * Math.max(0, unitsPerPlant) * Math.max(0, grainsPerUnit)
    const yieldKgPerSquareMeter =
      harvestGrainsPerSquareMeter * (Math.max(0, sampleWeightGrams) / Math.max(1, sampleCount)) / 1000
    const yieldTonnesPerHectare = yieldKgPerSquareMeter * 10
    const totalYieldTonnes = yieldKgPerSquareMeter * areaSqMeters / 1000

    return {
      spacingMeters,
      rowSpacingMeters,
      seedsPerSquareMeter,
      seedsPerHectare,
      totalSeeds,
      totalTravelMeters,
      passCount,
      establishedPlantsPerSquareMeter,
      harvestGrainsPerSquareMeter,
      yieldKgPerSquareMeter,
      yieldTonnesPerHectare,
      totalYieldTonnes,
    }
  }, [
    areaSqMeters,
    establishmentPercent,
    geometry,
    grainsPerUnit,
    openerCount,
    sampleCount,
    sampleWeightGrams,
    seedSpacingCm,
    unitsPerPlant,
    workingWidth,
  ])

  useEffect(() => {
    if (!selectedFieldId && fields[0]) setSelectedFieldId(fields[0].id)
  }, [fields, selectedFieldId, setSelectedFieldId])

  useEffect(() => {
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => setSizeVersion((version) => version + 1))
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!canvasRef.current || !geometry) return
    drawPlantingCanvas(
      canvasRef.current,
      geometry,
      workingWidth,
      openerCount,
      result.spacingMeters,
      result.seedsPerSquareMeter,
    )
  }, [geometry, openerCount, result.seedsPerSquareMeter, result.spacingMeters, sizeVersion, workingWidth])

  const selectCrop = (nextCropId: CropId) => {
    const next = cropProfiles.find((item) => item.id === nextCropId) ?? cropProfiles[0]
    setCropId(nextCropId)
    setUnitsPerPlant(next.unitsPerPlant)
    setGrainsPerUnit(next.grainsPerUnit)
    setSampleCount(next.sampleCount)
    setSampleWeightGrams(next.sampleWeightGrams)
  }

  const exportPdf = async () => {
    if (!selectedField || !canvasRef.current) return
    setExporting(true)
    setMessage(null)
    try {
      const { jsPDF } = await import('jspdf')
      const document = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pageWidth = document.internal.pageSize.getWidth()

      document.setFillColor(7, 31, 21)
      document.rect(0, 0, pageWidth, 30, 'F')
      document.setFillColor(242, 201, 76)
      document.roundedRect(14, 8, 14, 14, 3, 3, 'F')
      document.setTextColor(37, 48, 31)
      document.setFont('helvetica', 'bold')
      document.setFontSize(9)
      document.text('CF', 21, 17, { align: 'center' })
      document.setTextColor(245, 249, 246)
      document.setFontSize(18)
      document.text('CyberFarm Planting Report', 34, 15)
      document.setTextColor(153, 177, 164)
      document.setFontSize(8.5)
      document.text(`${selectedField.name} · ${new Date().toLocaleString('en-GB')}`, 34, 21)

      document.setTextColor(34, 48, 40)
      document.setFontSize(9)
      document.setFont('helvetica', 'bold')
      document.text('OPERATION SETUP', 14, 40)
      document.setFont('helvetica', 'normal')
      const setupLines = [
        `Operation: Seeding`,
        `Field area: ${formatNumber(areaSqMeters / 10_000, 3)} ha`,
        `Working width: ${formatNumber(workingWidth, 2)} m`,
        `Row openers: ${Math.max(1, Math.round(openerCount))}`,
        `Row spacing: ${formatNumber(result.rowSpacingMeters * 100, 2)} cm`,
        `Seed spacing: ${formatNumber(seedSpacingCm, 2)} cm`,
        `Direction: ${geometry?.directionLabel ?? 'Automatic'}`,
      ]
      setupLines.forEach((line, index) => document.text(line, 14 + (index >= 4 ? 92 : 0), 48 + (index % 4) * 6))

      document.setFillColor(239, 247, 241)
      document.roundedRect(14, 73, 56, 24, 3, 3, 'F')
      document.roundedRect(77, 73, 56, 24, 3, 3, 'F')
      document.roundedRect(140, 73, 56, 24, 3, 3, 'F')
      document.setTextColor(67, 91, 77)
      document.setFontSize(7.5)
      document.text('PLANTINGS / M²', 19, 81)
      document.text('PLANTINGS / HA', 82, 81)
      document.text('WHOLE FIELD', 145, 81)
      document.setTextColor(26, 68, 43)
      document.setFont('helvetica', 'bold')
      document.setFontSize(13)
      document.text(formatNumber(result.seedsPerSquareMeter, 2), 19, 91)
      document.text(formatCompact(result.seedsPerHectare), 82, 91)
      document.text(formatCompact(result.totalSeeds), 145, 91)

      const imageData = canvasRef.current.toDataURL('image/png', 1)
      document.addImage(imageData, 'PNG', 14, 104, 182, 91, undefined, 'FAST')

      let summaryY = 207
      document.setTextColor(34, 48, 40)
      document.setFont('helvetica', 'bold')
      document.setFontSize(9)
      document.text('FIELD SUMMARY', 14, summaryY)
      document.setFont('helvetica', 'normal')
      document.setFontSize(8.5)
      document.text(`Estimated passes: ${formatNumber(result.passCount, 0)}`, 14, summaryY + 8)
      document.text(`Estimated travel: ${formatNumber(result.totalTravelMeters / 1000, 2)} km`, 78, summaryY + 8)
      document.text('On-screen dots are scale-adaptive; calculations use the complete field geometry.', 14, summaryY + 15)

      if (yieldEnabled) {
        summaryY += 28
        document.setFont('helvetica', 'bold')
        document.setFontSize(9)
        document.text('OPTIONAL YIELD ESTIMATE', 14, summaryY)
        document.setFont('helvetica', 'normal')
        document.setFontSize(8.5)
        const yieldLines = [
          `Crop: ${profile.label}`,
          `Established plants: ${formatNumber(establishmentPercent, 1)}%`,
          `${profile.unitLabel}: ${formatNumber(unitsPerPlant, 2)}`,
          `${profile.grainLabel}: ${formatNumber(grainsPerUnit, 2)}`,
          `Sample weight: ${formatNumber(sampleWeightGrams, 2)} g / ${formatNumber(sampleCount, 0)} grains`,
          `Yield: ${formatNumber(result.yieldKgPerSquareMeter, 3)} kg/m² · ${formatNumber(result.yieldTonnesPerHectare, 2)} t/ha · ${formatNumber(result.totalYieldTonnes, 2)} t total`,
        ]
        yieldLines.forEach((line, index) => document.text(line, 14, summaryY + 8 + index * 6))
      }

      document.setDrawColor(220, 228, 222)
      document.line(14, 285, 196, 285)
      document.setTextColor(112, 126, 118)
      document.setFontSize(7)
      document.text('Planning estimate. Actual emergence, field losses and harvested moisture can change final yield.', 14, 290)

      const safeName = selectedField.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'field'
      document.save(`CyberFarm-Planting-${safeName}.pdf`)
      setMessage('PDF report exported with visualization and calculations.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export the PDF report.')
    } finally {
      setExporting(false)
    }
  }

  if (!selectedField || !geometry) {
    return (
      <section className="empty-workspace-state glass-panel">
        <div className="empty-workspace-symbol">•••</div>
        <span className="section-kicker">Planting</span>
        <h2>Select a field with a valid boundary</h2>
        <p>The planting plan needs at least one field polygon to calculate density and draw passes.</p>
      </section>
    )
  }

  return (
    <div className="planting-layout">
      <section className="page-card planting-controls">
        <div className="section-kicker">Planting setup</div>
        <h2 className="section-title">Machine pass</h2>
        <p className="planting-intro">Configure the seeder. Passes follow the first guidance line, or the longest field edge when no guidance exists.</p>

        <label className="form-label" htmlFor="planting-field">Field</label>
        <select
          id="planting-field"
          className="text-input"
          value={selectedField.id}
          onChange={(event) => setSelectedFieldId(event.target.value)}
        >
          {fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select>

        <label className="form-label" htmlFor="planting-operation">Operation</label>
        <select id="planting-operation" className="text-input" value="seeding" disabled>
          <option value="seeding">Seeding</option>
        </select>

        <div className="planting-input-grid">
          <label>
            <span className="form-label">Working width, m</span>
            <input className="text-input" type="number" min="0.1" step="0.1" value={workingWidth} onChange={(event) => setWorkingWidth(Math.max(0.1, Number(event.target.value) || 0.1))} />
          </label>
          <label>
            <span className="form-label">Row openers</span>
            <input className="text-input" type="number" min="1" step="1" value={openerCount} onChange={(event) => setOpenerCount(Math.max(1, Math.round(Number(event.target.value) || 1)))} />
          </label>
        </div>

        <label className="form-label" htmlFor="seed-spacing">Seed spacing in row, cm</label>
        <input id="seed-spacing" className="text-input" type="number" min="0.5" step="0.5" value={seedSpacingCm} onChange={(event) => setSeedSpacingCm(Math.max(0.5, Number(event.target.value) || 0.5))} />

        <div className="planting-derived-strip">
          <span>Automatic row spacing</span>
          <strong>{formatNumber(result.rowSpacingMeters * 100, 2)} cm</strong>
        </div>
        <div className="planting-direction-note">↗ {geometry.directionLabel}</div>

        <label className="yield-toggle">
          <input type="checkbox" checked={yieldEnabled} onChange={(event) => setYieldEnabled(event.target.checked)} />
          <span>
            <strong>Estimate yield</strong>
            <small>Optional crop and grain-weight model</small>
          </span>
        </label>

        {yieldEnabled && (
          <div className="yield-controls">
            <label className="form-label" htmlFor="crop-profile">Crop</label>
            <select id="crop-profile" className="text-input" value={cropId} onChange={(event) => selectCrop(event.target.value as CropId)}>
              {cropProfiles.map((crop) => <option key={crop.id} value={crop.id}>{crop.label}</option>)}
            </select>

            <label className="form-label" htmlFor="establishment">Established plants, %</label>
            <input id="establishment" className="text-input" type="number" min="0" max="100" step="1" value={establishmentPercent} onChange={(event) => setEstablishmentPercent(clamp(Number(event.target.value) || 0, 0, 100))} />

            <label className="form-label" htmlFor="units-per-plant">{profile.unitLabel}</label>
            <input id="units-per-plant" className="text-input" type="number" min="0" step="0.1" value={unitsPerPlant} onChange={(event) => setUnitsPerPlant(Math.max(0, Number(event.target.value) || 0))} />

            <label className="form-label" htmlFor="grains-per-unit">{profile.grainLabel}</label>
            <input id="grains-per-unit" className="text-input" type="number" min="0" step="1" value={grainsPerUnit} onChange={(event) => setGrainsPerUnit(Math.max(0, Number(event.target.value) || 0))} />

            <div className="planting-input-grid">
              <label>
                <span className="form-label">Sample grains</span>
                <input className="text-input" type="number" min="1" step="1" value={sampleCount} onChange={(event) => setSampleCount(Math.max(1, Math.round(Number(event.target.value) || 1)))} />
              </label>
              <label>
                <span className="form-label">Sample weight, g</span>
                <input className="text-input" type="number" min="0.01" step="0.1" value={sampleWeightGrams} onChange={(event) => setSampleWeightGrams(Math.max(0.01, Number(event.target.value) || 0.01))} />
              </label>
            </div>
          </div>
        )}
      </section>

      <section className="page-card planting-visual-card">
        <div className="planting-visual-head">
          <div>
            <span className="section-kicker">Scale-aware visualization</span>
            <h2>{selectedField.name}</h2>
          </div>
          <span className="status-chip">{formatNumber(areaSqMeters / 10_000, 3)} ha</span>
        </div>
        <div className="planting-canvas-wrap" ref={canvasWrapRef}>
          <canvas ref={canvasRef} aria-label="Planting point visualization" />
        </div>
        <p className="planting-canvas-note">Dots are sampled only for display performance. Density and yield use the complete field area and exact row geometry.</p>
      </section>

      <section className="page-card planting-results">
        <div className="section-kicker">Calculated output</div>
        <h2 className="section-title">Plant population</h2>

        <div className="planting-result-stack">
          <article className="planting-result-card cyan">
            <span>One square metre</span>
            <strong>{formatNumber(result.seedsPerSquareMeter, 2)}</strong>
            <small>plantings / m²</small>
          </article>
          <article className="planting-result-card yellow">
            <span>One hectare</span>
            <strong>{formatCompact(result.seedsPerHectare)}</strong>
            <small>plantings / ha</small>
          </article>
          <article className="planting-result-card green">
            <span>Whole field</span>
            <strong>{formatCompact(result.totalSeeds)}</strong>
            <small>{formatNumber(result.totalSeeds, 0)} plantings</small>
          </article>
        </div>

        <div className="planting-operation-summary">
          <div><span>Estimated passes</span><strong>{formatNumber(result.passCount, 0)}</strong></div>
          <div><span>Machine travel</span><strong>{formatNumber(result.totalTravelMeters / 1000, 2)} km</strong></div>
          <div><span>Row spacing</span><strong>{formatNumber(result.rowSpacingMeters * 100, 2)} cm</strong></div>
        </div>

        {yieldEnabled && (
          <div className="yield-result-panel">
            <span className="section-kicker">{profile.label} estimate</span>
            <div className="yield-result-primary">
              <span>Yield per hectare</span>
              <strong>{formatNumber(result.yieldTonnesPerHectare, 2)} t/ha</strong>
            </div>
            <div className="yield-result-grid">
              <div><span>Per m²</span><strong>{formatNumber(result.yieldKgPerSquareMeter, 3)} kg</strong></div>
              <div><span>Whole field</span><strong>{formatNumber(result.totalYieldTonnes, 2)} t</strong></div>
              <div><span>Established plants</span><strong>{formatNumber(result.establishedPlantsPerSquareMeter, 2)} /m²</strong></div>
              <div><span>Harvest grains</span><strong>{formatCompact(result.harvestGrainsPerSquareMeter)} /m²</strong></div>
            </div>
          </div>
        )}

        <button className="primary-btn planting-pdf-button" onClick={() => void exportPdf()} disabled={exporting}>
          {exporting ? 'Building PDF…' : 'Export PDF report'}
        </button>
        {message && <div className="planting-message">{message}</div>}
      </section>
    </div>
  )
}
