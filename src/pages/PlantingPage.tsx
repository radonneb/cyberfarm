import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldAreaSqMeters } from '../appHelpers'
import type { FieldModel, PlantingPlanConfig } from '../models/taskData'
import { useAppStore } from '../store/appStore'
import {
  calculatePlanting,
  formatCount,
  formatDecimal,
} from '../utils/plantingCalculations'

type LocalPoint = { x: number; y: number }

type CropPreset = {
  name: string
  unitsLabel: string
  grainsLabel: string
  unitsPerPlant: number
  grainsPerUnit: number
  sampleCount: number
  sampleWeightGrams: number
}

const cropPresets: CropPreset[] = [
  { name: 'Corn', unitsLabel: 'Ears per plant', grainsLabel: 'Grains per ear', unitsPerPlant: 1, grainsPerUnit: 500, sampleCount: 100, sampleWeightGrams: 32 },
  { name: 'Wheat', unitsLabel: 'Heads per plant', grainsLabel: 'Grains per head', unitsPerPlant: 3, grainsPerUnit: 32, sampleCount: 100, sampleWeightGrams: 4.8 },
  { name: 'Barley', unitsLabel: 'Heads per plant', grainsLabel: 'Grains per head', unitsPerPlant: 3, grainsPerUnit: 25, sampleCount: 100, sampleWeightGrams: 4.6 },
  { name: 'Sunflower', unitsLabel: 'Heads per plant', grainsLabel: 'Seeds per head', unitsPerPlant: 1, grainsPerUnit: 800, sampleCount: 100, sampleWeightGrams: 6 },
  { name: 'Soybean', unitsLabel: 'Pods per plant', grainsLabel: 'Seeds per pod', unitsPerPlant: 35, grainsPerUnit: 2.5, sampleCount: 100, sampleWeightGrams: 18 },
]

function clampPositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function numberFromInput(value: string, fallback: number) {
  return clampPositive(Number(value.replace(',', '.')), fallback)
}

function fieldGeometry(field: FieldModel | null) {
  const geoPoints = field?.boundaries.flatMap((boundary) => boundary.points) ?? []
  if (!geoPoints.length) return { polygons: [] as LocalPoint[][], angle: 0 }

  const latitude = geoPoints.reduce((sum, point) => sum + point.latitude, 0) / geoPoints.length
  const longitude = geoPoints.reduce((sum, point) => sum + point.longitude, 0) / geoPoints.length
  const metersPerLongitude = 111_320 * Math.cos((latitude * Math.PI) / 180)
  const toLocal = (point: { latitude: number; longitude: number }) => ({
    x: (point.longitude - longitude) * metersPerLongitude,
    y: (point.latitude - latitude) * 111_320,
  })
  const polygons = (field?.boundaries ?? []).map((boundary) => boundary.points.map(toLocal))

  const baseLine = field?.guidanceLines.find((line) => line.points.length >= 2)
  if (baseLine) {
    const start = toLocal(baseLine.points[0])
    const end = toLocal(baseLine.points[baseLine.points.length - 1])
    return { polygons, angle: Math.atan2(end.y - start.y, end.x - start.x) }
  }

  let longest = { length: 0, angle: 0 }
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]
      const end = polygon[(index + 1) % polygon.length]
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length > longest.length) {
        longest = { length, angle: Math.atan2(end.y - start.y, end.x - start.x) }
      }
    }
  }
  return { polygons, angle: longest.angle }
}

function rotated(point: LocalPoint, angle: number) {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    u: point.x * cosine + point.y * sine,
    v: -point.x * sine + point.y * cosine,
  }
}

function unrotate(u: number, v: number, angle: number): LocalPoint {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return { x: u * cosine - v * sine, y: u * sine + v * cosine }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

function drawInset(
  context: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  sizeMeters: number,
  title: string,
  subtitle: string,
  rowSpacingMeters: number,
  seedSpacingMeters: number,
  color: string,
) {
  roundedRect(context, box.x, box.y, box.width, box.height, 18)
  context.fillStyle = '#0b2017'
  context.fill()
  context.strokeStyle = 'rgba(255,255,255,0.12)'
  context.stroke()

  context.fillStyle = '#f3f7f4'
  context.font = '700 15px Inter, sans-serif'
  context.fillText(title, box.x + 16, box.y + 24)
  context.fillStyle = '#9eb0a5'
  context.font = '500 11px Inter, sans-serif'
  context.fillText(subtitle, box.x + 16, box.y + 41)

  const plotSize = Math.max(20, Math.min(box.width - 32, box.height - 66))
  const plotX = box.x + (box.width - plotSize) / 2
  const plotY = box.y + 53
  context.fillStyle = 'rgba(255,255,255,0.035)'
  context.fillRect(plotX, plotY, plotSize, plotSize)
  context.strokeStyle = color
  context.lineWidth = 1.5
  context.strokeRect(plotX, plotY, plotSize, plotSize)

  const totalRows = Math.max(1, Math.ceil(sizeMeters / rowSpacingMeters))
  const totalSeedsPerRow = Math.max(1, Math.ceil(sizeMeters / seedSpacingMeters))
  const rowStep = Math.max(1, Math.ceil(totalRows / 42))
  const seedStep = Math.max(1, Math.ceil(totalSeedsPerRow / 58))
  const multiplier = rowStep * seedStep

  context.fillStyle = color
  context.beginPath()
  for (let row = 0; row < totalRows; row += rowStep) {
    const y = plotY + ((row + 0.5) / totalRows) * plotSize
    for (let seed = 0; seed < totalSeedsPerRow; seed += seedStep) {
      const x = plotX + ((seed + 0.5) / totalSeedsPerRow) * plotSize
      context.moveTo(x + (sizeMeters === 1 ? 2.6 : 1.2), y)
      context.arc(x, y, sizeMeters === 1 ? 2.6 : 1.2, 0, Math.PI * 2)
    }
  }
  context.fill()

  if (multiplier > 1) {
    context.fillStyle = '#9eb0a5'
    context.font = '600 10px Inter, sans-serif'
    context.textAlign = 'right'
    context.fillText(`1 dot ≈ ${formatCount(multiplier)} seeds`, box.x + box.width - 16, box.y + box.height - 12)
    context.textAlign = 'left'
  }
}

function drawPlantingVisualization(
  canvas: HTMLCanvasElement,
  field: FieldModel | null,
  widthMeters: number,
  coulterCount: number,
  seedSpacingCm: number,
  metrics: ReturnType<typeof calculatePlanting>,
) {
  const host = canvas.parentElement
  if (!host) return
  const bounds = host.getBoundingClientRect()
  const width = Math.max(1, Math.floor(bounds.width))
  const height = Math.max(1, Math.floor(bounds.height))
  const devicePixelRatio = window.devicePixelRatio || 1
  canvas.width = Math.floor(width * devicePixelRatio)
  canvas.height = Math.floor(height * devicePixelRatio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)

  const background = context.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, '#071b12')
  background.addColorStop(1, '#0b2a1c')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)

  const gap = 14
  const sidePadding = 18
  const mainHeight = Math.max(250, height * 0.62)
  const mainBox = { x: sidePadding, y: 18, width: width - sidePadding * 2, height: mainHeight - 24 }
  const insetY = mainHeight + 4
  const insetHeight = Math.max(135, height - insetY - 16)
  const insetWidth = (width - sidePadding * 2 - gap) / 2

  roundedRect(context, mainBox.x, mainBox.y, mainBox.width, mainBox.height, 20)
  context.fillStyle = 'rgba(255,255,255,0.035)'
  context.fill()
  context.strokeStyle = 'rgba(255,255,255,0.1)'
  context.stroke()

  context.fillStyle = '#f3f7f4'
  context.font = '800 16px Inter, sans-serif'
  context.fillText('Machine pass and planting rows', mainBox.x + 18, mainBox.y + 26)
  context.fillStyle = '#9eb0a5'
  context.font = '500 11px Inter, sans-serif'
  context.fillText('Actual field geometry · direction follows the first guidance line', mainBox.x + 18, mainBox.y + 44)

  const geometry = fieldGeometry(field)
  const points = geometry.polygons.flat()
  if (points.length >= 3) {
    const minX = Math.min(...points.map((point) => point.x))
    const maxX = Math.max(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxY = Math.max(...points.map((point) => point.y))
    const plot = {
      x: mainBox.x + 22,
      y: mainBox.y + 58,
      width: mainBox.width - 44,
      height: mainBox.height - 78,
    }
    const geometryWidth = Math.max(1, maxX - minX)
    const geometryHeight = Math.max(1, maxY - minY)
    const scale = Math.min(plot.width / geometryWidth, plot.height / geometryHeight) * 0.94
    const centerX = plot.x + plot.width / 2
    const centerY = plot.y + plot.height / 2
    const geometryCenterX = (minX + maxX) / 2
    const geometryCenterY = (minY + maxY) / 2
    const toCanvas = (point: LocalPoint) => ({
      x: centerX + (point.x - geometryCenterX) * scale,
      y: centerY - (point.y - geometryCenterY) * scale,
    })
    const fieldPath = () => {
      context.beginPath()
      for (const polygon of geometry.polygons) {
        if (!polygon.length) continue
        const first = toCanvas(polygon[0])
        context.moveTo(first.x, first.y)
        for (const point of polygon.slice(1)) {
          const next = toCanvas(point)
          context.lineTo(next.x, next.y)
        }
        context.closePath()
      }
    }

    fieldPath()
    context.fillStyle = 'rgba(77,187,120,0.12)'
    context.fill()
    context.strokeStyle = '#67d993'
    context.lineWidth = 2
    context.stroke()

    const rowPoints = points.map((point) => rotated(point, geometry.angle))
    const minU = Math.min(...rowPoints.map((point) => point.u))
    const maxU = Math.max(...rowPoints.map((point) => point.u))
    const minV = Math.min(...rowPoints.map((point) => point.v))
    const maxV = Math.max(...rowPoints.map((point) => point.v))
    const rowSpacing = clampPositive(metrics.rowSpacingMeters, 0.75)
    const seedSpacing = clampPositive(seedSpacingCm / 100, 0.16)
    const totalRows = Math.max(1, Math.ceil((maxV - minV) / rowSpacing))
    const totalSeeds = Math.max(1, Math.ceil((maxU - minU) / seedSpacing))
    const rowStep = Math.max(1, Math.ceil(totalRows / 90))
    const renderedRows = Math.ceil(totalRows / rowStep)
    const seedStep = Math.max(1, Math.ceil(totalSeeds / Math.max(20, 12_000 / renderedRows)))

    context.save()
    fieldPath()
    context.clip()

    const passHalfWidth = widthMeters / 2
    const passCorners = [
      unrotate(minU, -passHalfWidth, geometry.angle),
      unrotate(maxU, -passHalfWidth, geometry.angle),
      unrotate(maxU, passHalfWidth, geometry.angle),
      unrotate(minU, passHalfWidth, geometry.angle),
    ].map(toCanvas)
    context.beginPath()
    context.moveTo(passCorners[0].x, passCorners[0].y)
    passCorners.slice(1).forEach((point) => context.lineTo(point.x, point.y))
    context.closePath()
    context.fillStyle = 'rgba(242,201,76,0.14)'
    context.fill()

    context.strokeStyle = 'rgba(91,218,205,0.34)'
    context.lineWidth = 1
    for (let row = 0; row <= totalRows; row += rowStep) {
      const v = minV + row * rowSpacing
      const start = toCanvas(unrotate(minU, v, geometry.angle))
      const end = toCanvas(unrotate(maxU, v, geometry.angle))
      context.beginPath()
      context.moveTo(start.x, start.y)
      context.lineTo(end.x, end.y)
      context.stroke()
    }

    context.fillStyle = '#67d993'
    context.beginPath()
    for (let row = 0; row <= totalRows; row += rowStep) {
      const v = minV + row * rowSpacing
      for (let seed = 0; seed <= totalSeeds; seed += seedStep) {
        const u = minU + seed * seedSpacing
        const point = toCanvas(unrotate(u, v, geometry.angle))
        context.moveTo(point.x + 1.15, point.y)
        context.arc(point.x, point.y, 1.15, 0, Math.PI * 2)
      }
    }
    context.fill()
    context.restore()

    const hectareCenter = toCanvas({ x: geometryCenterX, y: geometryCenterY })
    const hectarePixels = 100 * scale
    context.strokeStyle = '#f2c94c'
    context.lineWidth = 2
    context.strokeRect(hectareCenter.x - hectarePixels / 2, hectareCenter.y - hectarePixels / 2, hectarePixels, hectarePixels)
    context.fillStyle = '#f2c94c'
    context.font = '800 10px Inter, sans-serif'
    context.fillText('1 ha', hectareCenter.x - hectarePixels / 2 + 5, hectareCenter.y - hectarePixels / 2 + 13)

    context.fillStyle = '#ff7ac8'
    context.beginPath()
    context.arc(hectareCenter.x, hectareCenter.y, 4.5, 0, Math.PI * 2)
    context.fill()
    context.font = '800 10px Inter, sans-serif'
    context.fillText('1 m²', hectareCenter.x + 8, hectareCenter.y - 7)

    const direction = toCanvas(unrotate(minU + (maxU - minU) * 0.18, 0, geometry.angle))
    context.save()
    context.translate(direction.x, direction.y)
    context.rotate(-geometry.angle)
    context.fillStyle = '#f2c94c'
    roundedRect(context, -13, -8, 26, 16, 5)
    context.fill()
    context.fillStyle = '#172016'
    context.font = '900 10px Inter, sans-serif'
    context.textAlign = 'center'
    context.fillText(`${coulterCount}`, 0, 3.5)
    context.restore()
    context.textAlign = 'left'
  } else {
    context.fillStyle = '#9eb0a5'
    context.font = '600 14px Inter, sans-serif'
    context.fillText('Select a field with a valid boundary to build the visualization.', mainBox.x + 18, mainBox.y + 82)
  }

  const seedSpacingMeters = clampPositive(seedSpacingCm / 100, 0.16)
  const rowSpacingMeters = clampPositive(metrics.rowSpacingMeters, 0.75)
  drawInset(
    context,
    { x: sidePadding, y: insetY, width: insetWidth, height: insetHeight },
    1,
    '1 square metre',
    `${formatCount(metrics.plantsPerSqMeter)} planting positions`,
    rowSpacingMeters,
    seedSpacingMeters,
    '#ff7ac8',
  )
  drawInset(
    context,
    { x: sidePadding + insetWidth + gap, y: insetY, width: insetWidth, height: insetHeight },
    100,
    '1 hectare',
    `${formatCount(metrics.plantsPerHectare)} planting positions`,
    rowSpacingMeters,
    seedSpacingMeters,
    '#f2c94c',
  )
}

function InputField({
  label,
  value,
  onChange,
  step,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: string
}) {
  return (
    <label className="planting-input-field">
      <span>{label}</span>
      <input
        className="text-input compact-input"
        type="number"
        min="0"
        step={step ?? '1'}
        value={value}
        onChange={(event) => onChange(numberFromInput(event.target.value, 0.01))}
      />
    </label>
  )
}

export default function PlantingPage() {
  const {
    loadedTaskData,
    selectedFieldId,
    setSelectedFieldId,
    setErrorMessage,
    updateTaskData,
  } = useAppStore()
  const fields = useMemo(() => loadedTaskData?.fields ?? [], [loadedTaskData?.fields])
  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? fields[0] ?? null
  const selectedFieldKey = selectedField?.id ?? null
  const plantingPlans = loadedTaskData?.tools?.plantingPlans
  const taskLoaded = Boolean(loadedTaskData)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const loadingPlanRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const updateTaskDataRef = useRef(updateTaskData)
  const [sizeVersion, setSizeVersion] = useState(0)
  const [workingWidthMeters, setWorkingWidthMeters] = useState(6)
  const [coulterCount, setCoulterCount] = useState(8)
  const [seedSpacingCm, setSeedSpacingCm] = useState(16)
  const [crop, setCrop] = useState('Corn')
  const [yieldEnabled, setYieldEnabled] = useState(false)
  const [yieldUnitsPerPlant, setYieldUnitsPerPlant] = useState(1)
  const [grainsPerUnit, setGrainsPerUnit] = useState(500)
  const [weightSampleCount, setWeightSampleCount] = useState(100)
  const [weightSampleGrams, setWeightSampleGrams] = useState(32)
  const [pdfBusy, setPdfBusy] = useState(false)

  const cropPreset = cropPresets.find((preset) => preset.name === crop) ?? cropPresets[0]
  const areaSqMeters = useMemo(() => fieldAreaSqMeters(selectedField), [selectedField])
  const metrics = useMemo(
    () => calculatePlanting({
      areaSqMeters,
      workingWidthMeters,
      coulterCount,
      seedSpacingCm,
      yieldEnabled,
      yieldUnitsPerPlant,
      grainsPerUnit,
      weightSampleCount,
      weightSampleGrams,
    }),
    [areaSqMeters, workingWidthMeters, coulterCount, seedSpacingCm, yieldEnabled, yieldUnitsPerPlant, grainsPerUnit, weightSampleCount, weightSampleGrams],
  )

  useEffect(() => {
    updateTaskDataRef.current = updateTaskData
  }, [updateTaskData])

  useEffect(() => {
    if (!selectedFieldId && fields[0]) setSelectedFieldId(fields[0].id)
  }, [fields, selectedFieldId, setSelectedFieldId])

  useEffect(() => {
    const stored = selectedFieldKey ? plantingPlans?.[selectedFieldKey] : undefined
    let cancelled = false
    loadingPlanRef.current = true
    queueMicrotask(() => {
      if (cancelled) return
      if (stored) {
        setWorkingWidthMeters(stored.workingWidthMeters)
        setCoulterCount(stored.coulterCount)
        setSeedSpacingCm(stored.seedSpacingCm)
        setCrop(stored.crop)
        setYieldEnabled(stored.yieldEnabled)
        setYieldUnitsPerPlant(stored.yieldUnitsPerPlant)
        setGrainsPerUnit(stored.grainsPerUnit)
        setWeightSampleCount(stored.weightSampleCount)
        setWeightSampleGrams(stored.weightSampleGrams)
      } else {
        const defaults = cropPresets[0]
        setWorkingWidthMeters(6)
        setCoulterCount(8)
        setSeedSpacingCm(16)
        setCrop(defaults.name)
        setYieldEnabled(false)
        setYieldUnitsPerPlant(defaults.unitsPerPlant)
        setGrainsPerUnit(defaults.grainsPerUnit)
        setWeightSampleCount(defaults.sampleCount)
        setWeightSampleGrams(defaults.sampleWeightGrams)
      }
      loadingPlanRef.current = false
    })
    return () => {
      cancelled = true
    }
  }, [selectedFieldKey, plantingPlans])

  useEffect(() => {
    if (loadingPlanRef.current || !taskLoaded || !selectedFieldKey) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      const plan: PlantingPlanConfig = {
        fieldId: selectedFieldKey,
        operation: 'seeding',
        workingWidthMeters,
        coulterCount,
        seedSpacingCm,
        crop,
        yieldEnabled,
        yieldUnitsPerPlant,
        grainsPerUnit,
        weightSampleCount,
        weightSampleGrams,
      }
      updateTaskDataRef.current((task) => ({
        ...task,
        tools: {
          ...task.tools,
          plantingPlans: {
            ...task.tools?.plantingPlans,
            [selectedFieldKey]: plan,
          },
        },
      }))
    }, 650)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [taskLoaded, selectedFieldKey, workingWidthMeters, coulterCount, seedSpacingCm, crop, yieldEnabled, yieldUnitsPerPlant, grainsPerUnit, weightSampleCount, weightSampleGrams])

  useEffect(() => {
    const host = canvasWrapRef.current
    if (!host) return
    const observer = new ResizeObserver(() => setSizeVersion((current) => current + 1))
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!canvasRef.current) return
    drawPlantingVisualization(
      canvasRef.current,
      selectedField,
      workingWidthMeters,
      coulterCount,
      seedSpacingCm,
      metrics,
    )
  }, [selectedField, workingWidthMeters, coulterCount, seedSpacingCm, metrics, sizeVersion])

  const changeCrop = (nextCrop: string) => {
    const preset = cropPresets.find((item) => item.name === nextCrop) ?? cropPresets[0]
    setCrop(preset.name)
    setYieldUnitsPerPlant(preset.unitsPerPlant)
    setGrainsPerUnit(preset.grainsPerUnit)
    setWeightSampleCount(preset.sampleCount)
    setWeightSampleGrams(preset.sampleWeightGrams)
  }

  const exportPdf = async () => {
    if (!selectedField || !canvasRef.current) {
      setErrorMessage('Select a field before exporting the planting report.')
      return
    }
    setPdfBusy(true)
    try {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      pdf.setFillColor(247, 249, 244)
      pdf.rect(0, 0, pageWidth, pageHeight, 'F')
      pdf.setFillColor(11, 58, 39)
      pdf.roundedRect(9, 9, pageWidth - 18, 25, 4, 4, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(18)
      pdf.text('CyberFarm - Planting plan report', 16, 20)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.text(`${selectedField.name}  |  ${new Date().toLocaleDateString('en-GB')}`, 16, 27)

      const visualization = canvasRef.current.toDataURL('image/png', 1)
      pdf.addImage(visualization, 'PNG', 9, 39, 182, 153, undefined, 'FAST')

      const x = 198
      const valueX = pageWidth - 15
      let y = 46
      const row = (label: string, value: string, accent = false) => {
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8.5)
        pdf.setTextColor(92, 111, 99)
        pdf.text(label, x, y)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(accent ? 16 : 26, accent ? 116 : 46, accent ? 71 : 33)
        pdf.text(value, valueX, y, { align: 'right' })
        y += 7
      }
      const heading = (label: string) => {
        y += 3
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(10.5)
        pdf.setTextColor(11, 58, 39)
        pdf.text(label, x, y)
        y += 7
      }

      heading('Setup')
      row('Operation', 'Seeding')
      row('Working width', `${formatDecimal(workingWidthMeters)} m`)
      row('Coulters / rows', formatCount(coulterCount))
      row('Row spacing', `${formatDecimal(metrics.rowSpacingMeters, 3)} m`)
      row('Seed spacing', `${formatDecimal(seedSpacingCm, 1)} cm`)
      heading('Planting positions')
      row('Per square metre', formatCount(metrics.plantsPerSqMeter), true)
      row('Per hectare', formatCount(metrics.plantsPerHectare), true)
      row(`Whole field (${formatDecimal(metrics.fieldAreaHectares, 3)} ha)`, formatCount(metrics.plantsInField), true)

      if (yieldEnabled) {
        heading(`Yield estimate - ${crop}`)
        row(cropPreset.unitsLabel, formatDecimal(yieldUnitsPerPlant, 1))
        row(cropPreset.grainsLabel, formatDecimal(grainsPerUnit, 1))
        row(`Weight of ${formatCount(weightSampleCount)} seeds`, `${formatDecimal(weightSampleGrams, 2)} g`)
        row('Per square metre', `${formatDecimal(metrics.yieldKgPerSqMeter, 3)} kg`, true)
        row('Per hectare', `${formatDecimal(metrics.yieldTonsPerHectare, 2)} t`, true)
        row('Whole field', `${formatDecimal(metrics.yieldTonsInField, 2)} t`, true)
      }

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(107, 119, 111)
      const note = yieldEnabled
        ? 'The yield result is theoretical. Germination, field losses, harvest moisture and cleaning losses are not applied.'
        : 'Planting positions are calculated from row spacing and in-row seed spacing.'
      pdf.text(pdf.splitTextToSize(note, pageWidth - x - 15), x, pageHeight - 15)
      const safeName = selectedField.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'field'
      pdf.save(`${safeName}-planting-report.pdf`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create the PDF report.')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="planting-layout">
      <section className="page-card planting-controls scroll-panel">
        <div className="section-kicker compact-kicker">Planting setup</div>
        <h2 className="section-title">Seeding pass</h2>

        <label className="form-label">Field</label>
        <select className="text-input compact-input" value={selectedField?.id ?? ''} onChange={(event) => setSelectedFieldId(event.target.value || null)}>
          <option value="">Select field</option>
          {fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select>

        <label className="form-label">Operation</label>
        <select className="text-input compact-input" value="seeding" disabled>
          <option value="seeding">Seeding</option>
        </select>

        <div className="planting-input-grid">
          <InputField label="Working width, m" value={workingWidthMeters} onChange={setWorkingWidthMeters} step="0.1" />
          <InputField label="Coulters / rows" value={coulterCount} onChange={(value) => setCoulterCount(Math.max(1, Math.round(value)))} />
          <InputField label="Seed spacing, cm" value={seedSpacingCm} onChange={setSeedSpacingCm} step="0.1" />
          <div className="planting-derived-field">
            <span>Row spacing</span>
            <strong>{formatDecimal(metrics.rowSpacingMeters, 3)} m</strong>
          </div>
        </div>

        <label className="yield-toggle">
          <input type="checkbox" checked={yieldEnabled} onChange={(event) => setYieldEnabled(event.target.checked)} />
          <span>
            <strong>Calculate potential yield</strong>
            <small>Optional theoretical estimate</small>
          </span>
        </label>

        {yieldEnabled && (
          <div className="yield-settings">
            <label className="form-label">Crop</label>
            <select className="text-input compact-input" value={crop} onChange={(event) => changeCrop(event.target.value)}>
              {cropPresets.map((preset) => <option key={preset.name}>{preset.name}</option>)}
            </select>
            <div className="planting-input-grid">
              <InputField label={cropPreset.unitsLabel} value={yieldUnitsPerPlant} onChange={setYieldUnitsPerPlant} step="0.1" />
              <InputField label={cropPreset.grainsLabel} value={grainsPerUnit} onChange={setGrainsPerUnit} step="0.1" />
              <InputField label="Seed sample count" value={weightSampleCount} onChange={setWeightSampleCount} />
              <InputField label="Sample weight, g" value={weightSampleGrams} onChange={setWeightSampleGrams} step="0.01" />
            </div>
          </div>
        )}

        <button className="primary-btn planting-pdf-btn" onClick={() => void exportPdf()} disabled={!selectedField || pdfBusy}>
          {pdfBusy ? 'Creating PDF…' : 'Export PDF report'}
        </button>
      </section>

      <section className="page-card planting-visual-card" ref={canvasWrapRef}>
        <canvas ref={canvasRef} className="planting-canvas" aria-label="Planting pass visualization" />
      </section>

      <section className="page-card planting-results scroll-panel">
        <div className="section-kicker compact-kicker">Calculation</div>
        <h2 className="section-title">Planting positions</h2>
        <div className="planting-result-list">
          <article className="planting-result-card square-metre">
            <span><i />1 m²</span>
            <strong>{formatCount(metrics.plantsPerSqMeter)}</strong>
            <small>planting positions</small>
          </article>
          <article className="planting-result-card hectare">
            <span><i />1 hectare</span>
            <strong>{formatCount(metrics.plantsPerHectare)}</strong>
            <small>planting positions</small>
          </article>
          <article className="planting-result-card whole-field">
            <span><i />Whole field</span>
            <strong>{formatCount(metrics.plantsInField)}</strong>
            <small>{formatDecimal(metrics.fieldAreaHectares, 3)} ha</small>
          </article>
        </div>

        <div className="planting-formula-card">
          <span>Density formula</span>
          <code>1 ÷ ({formatDecimal(metrics.rowSpacingMeters, 3)} m × {formatDecimal(seedSpacingCm / 100, 3)} m)</code>
          <small>{formatDecimal(metrics.seedsPerRowMeter, 2)} seeds per metre in each row</small>
        </div>

        {yieldEnabled && (
          <>
            <div className="section-kicker planting-yield-kicker">Potential yield · {crop}</div>
            <div className="yield-result-grid">
              <article><span>1 m²</span><strong>{formatDecimal(metrics.yieldKgPerSqMeter, 3)} kg</strong></article>
              <article><span>1 ha</span><strong>{formatDecimal(metrics.yieldTonsPerHectare, 2)} t</strong></article>
              <article><span>Whole field</span><strong>{formatDecimal(metrics.yieldTonsInField, 2)} t</strong></article>
            </div>
            <p className="planting-disclaimer">Theoretical biological yield before germination, field, moisture and harvest losses.</p>
          </>
        )}
      </section>
    </div>
  )
}
