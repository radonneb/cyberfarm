import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldAreaSqMeters } from '../appHelpers'
import type {
  FieldModel,
  PivotNozzleConfig,
  PivotR55Config,
  PivotTrackConfig,
  PivotTrackWheelConfig,
} from '../models/taskData'
import { uid } from '../models/taskData'
import { useAppStore } from '../store/appStore'

type PivotType = 'circle' | 'sector'
type FieldMode = 'existing' | 'free'
type LocalPoint = { x: number; y: number }

type FieldGeometry = {
  polygons: LocalPoint[][]
  detectedCenter: LocalPoint
  detectedType: PivotType
  sectorAngleDegrees: number
  sectorStartRadians: number
  autoLengthMeters: number
  radius: number
}

type WheelModel = PivotTrackWheelConfig & {
  index: number
  radius: number
}

type NozzleModel = PivotNozzleConfig & {
  index: number
  innerRadius: number
  outerRadius: number
  serviceAreaSqMeters: number
  passWaterM3: number
  flowM3h: number
  flowLMin: number
  colorHue: number
}

type PivotModel = {
  areaSqMeters: number
  angleDegrees: number
  theta: number
  pivotLength: number
  idealPivotAreaSqMeters: number
  nozzles: NozzleModel[]
  totalMainFlowM3h: number
  coverageAreaSqMeters: number
  coverageWaterM3: number
  r55SweptAreaSqMeters: number
  r55FlowM3h: number
  wheels: WheelModel[]
  trackAreaSqMeters: number
}

type CanvasLayout = {
  centerX: number
  centerY: number
  scale: number
  frameUnitX: number
  frameUnitY: number
  nozzlePoints: Array<{ x: number; y: number; id: string }>
  wheelPoints: Array<{ x: number; y: number; index: number }>
}

const DEFAULT_NOZZLE_COUNT = 24
const DEFAULT_NOZZLE_THROW = 10
const DEFAULT_DEPTH_MM = 6
const DEFAULT_ROTATION_HOURS = 24
const DEFAULT_R55: PivotR55Config = {
  enabled: true,
  throwMeters: 16,
  sprayAngleDegrees: 180,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 1) {
  const multiplier = 10 ** digits
  return Math.round(value * multiplier) / multiplier
}

function formatNumber(value: number, maximumFractionDigits = 1) {
  return value.toLocaleString('en-US', { maximumFractionDigits })
}

function createWheels(count: number, widthMeters: number): PivotTrackWheelConfig[] {
  return Array.from({ length: count }, () => ({ enabled: true, widthMeters }))
}

function resizeWheels(
  current: PivotTrackWheelConfig[],
  count: number,
  defaultWidth: number,
) {
  const next = current.slice(0, count)
  while (next.length < count) next.push({ enabled: true, widthMeters: defaultWidth })
  return next
}

function createNozzles(
  count: number,
  pivotLength: number,
  throwMeters = DEFAULT_NOZZLE_THROW,
) {
  return Array.from({ length: count }, (_, index): PivotNozzleConfig => ({
    id: uid(),
    enabled: true,
    distanceMeters: round(pivotLength * ((index + 1) / count), 2),
    sprayAngleDegrees: 360,
    throwMeters,
  }))
}

function resizeNozzles(
  current: PivotNozzleConfig[],
  count: number,
  pivotLength: number,
) {
  if (!current.length) return createNozzles(count, pivotLength)
  const next = current.slice(0, count)
  while (next.length < count) {
    const index = next.length
    next.push({
      id: uid(),
      enabled: true,
      distanceMeters: round(pivotLength * ((index + 1) / count), 2),
      sprayAngleDegrees: 360,
      throwMeters: current[0]?.throwMeters ?? DEFAULT_NOZZLE_THROW,
    })
  }
  return next
}

function redistributeNozzles(current: PivotNozzleConfig[], pivotLength: number) {
  return current.map((nozzle, index) => ({
    ...nozzle,
    distanceMeters: round(pivotLength * ((index + 1) / current.length), 2),
  }))
}

function polygonArea(points: LocalPoint[]) {
  if (points.length < 3) return 0
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0)) / 2
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))]
}

function minimalAngleArc(points: LocalPoint[], center: LocalPoint) {
  const angles = points
    .map((point) => Math.atan2(point.y - center.y, point.x - center.x))
    .map((angle) => (angle + Math.PI * 2) % (Math.PI * 2))
    .sort((a, b) => a - b)

  if (angles.length < 2) return { start: 0, span: Math.PI * 2 }

  let largestGap = -1
  let start = angles[0]
  for (let index = 0; index < angles.length; index += 1) {
    const current = angles[index]
    const next = index === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[index + 1]
    const gap = next - current
    if (gap > largestGap) {
      largestGap = gap
      start = next % (Math.PI * 2)
    }
  }

  return { start, span: Math.PI * 2 - largestGap }
}

function fieldToLocal(field: FieldModel | null): FieldGeometry {
  const sourcePoints = field?.boundaries.flatMap((boundary) => boundary.points) ?? []
  if (!sourcePoints.length) {
    return {
      polygons: [],
      detectedCenter: { x: 0, y: 0 },
      detectedType: 'circle',
      sectorAngleDegrees: 360,
      sectorStartRadians: 0,
      autoLengthMeters: 450,
      radius: 450,
    }
  }

  const latitude = sourcePoints.reduce((sum, point) => sum + point.latitude, 0) / sourcePoints.length
  const longitude = sourcePoints.reduce((sum, point) => sum + point.longitude, 0) / sourcePoints.length
  const metersPerLon = 111_320 * Math.cos((latitude * Math.PI) / 180)
  const polygons = (field?.boundaries ?? []).map((boundary) => {
    const points = boundary.points.map((point) => ({
      x: (point.longitude - longitude) * metersPerLon,
      y: (point.latitude - latitude) * 111_320,
    }))
    if (points.length > 2 && Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    ) < 0.05) points.pop()
    return points
  })

  const primary = [...polygons].sort((a, b) => polygonArea(b) - polygonArea(a))[0] ?? []
  if (primary.length < 3) {
    return {
      polygons,
      detectedCenter: { x: 0, y: 0 },
      detectedType: 'circle',
      sectorAngleDegrees: 360,
      sectorStartRadians: 0,
      autoLengthMeters: 450,
      radius: 450,
    }
  }

  const edgeLengths = primary.map((point, index) => {
    const next = primary[(index + 1) % primary.length]
    return Math.hypot(next.x - point.x, next.y - point.y)
  })
  const typicalEdge = Math.max(0.01, median(edgeLengths))
  let centerIndex = 0
  let centerScore = -1
  for (let index = 0; index < primary.length; index += 1) {
    const previousEdge = edgeLengths[(index - 1 + edgeLengths.length) % edgeLengths.length]
    const nextEdge = edgeLengths[index]
    const score = Math.min(previousEdge, nextEdge)
    if (score > centerScore) {
      centerScore = score
      centerIndex = index
    }
  }

  const sectorCandidate = primary[centerIndex]
  const candidateDistances = primary
    .map((point) => Math.hypot(point.x - sectorCandidate.x, point.y - sectorCandidate.y))
    .filter((distance) => distance > 0.2)
  const candidateRadius = percentile(candidateDistances, 0.9)
  const outerPoints = primary.filter((point) =>
    Math.hypot(point.x - sectorCandidate.x, point.y - sectorCandidate.y) > candidateRadius * 0.55,
  )
  const candidateArc = minimalAngleArc(outerPoints, sectorCandidate)
  const isSector = centerScore > typicalEdge * 2.7 && candidateArc.span < Math.PI * 1.96

  let detectedCenter: LocalPoint
  let detectedType: PivotType
  let sectorStartRadians: number
  let sectorAngleDegrees: number
  let autoLengthMeters: number

  if (isSector) {
    detectedCenter = sectorCandidate
    detectedType = 'sector'
    sectorStartRadians = candidateArc.start
    sectorAngleDegrees = clamp((candidateArc.span * 180) / Math.PI, 10, 355)
    autoLengthMeters = Math.max(1, candidateRadius)
  } else {
    const xs = primary.map((point) => point.x)
    const ys = primary.map((point) => point.y)
    detectedCenter = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    }
    detectedType = 'circle'
    sectorStartRadians = 0
    sectorAngleDegrees = 360
    const distances = primary.map((point) =>
      Math.hypot(point.x - detectedCenter.x, point.y - detectedCenter.y),
    )
    autoLengthMeters = Math.max(1, percentile(distances, 0.9))
  }

  const radius = Math.max(
    autoLengthMeters,
    ...polygons.flatMap((polygon) => polygon.map((point) =>
      Math.hypot(point.x - detectedCenter.x, point.y - detectedCenter.y),
    )),
  )

  return {
    polygons,
    detectedCenter,
    detectedType,
    sectorAngleDegrees,
    sectorStartRadians,
    autoLengthMeters,
    radius,
  }
}

function pointInFan(
  x: number,
  y: number,
  originX: number,
  originY: number,
  direction: number,
  angleDegrees: number,
  radius: number,
) {
  const dx = x - originX
  const dy = y - originY
  if (dx * dx + dy * dy > radius * radius) return false
  if (angleDegrees >= 359.5) return true
  const pointAngle = Math.atan2(dy, dx)
  const difference = Math.atan2(Math.sin(pointAngle - direction), Math.cos(pointAngle - direction))
  return Math.abs(difference) <= (angleDegrees * Math.PI) / 360
}

function estimateCoverageArea(
  nozzles: PivotNozzleConfig[],
  pivotLength: number,
  r55: PivotR55Config,
) {
  const active = nozzles.filter((nozzle) => nozzle.enabled && nozzle.throwMeters > 0)
  const maximumThrow = Math.max(
    1,
    ...active.map((nozzle) => nozzle.throwMeters),
    r55.enabled ? r55.throwMeters : 0,
  )
  const minX = -maximumThrow
  const maxX = pivotLength + Math.max(maximumThrow, r55.enabled ? r55.throwMeters : 0)
  const minY = -maximumThrow
  const maxY = maximumThrow
  const columns = 150
  const rows = 110
  const cellWidth = (maxX - minX) / columns
  const cellHeight = (maxY - minY) / rows
  let covered = 0

  for (let row = 0; row < rows; row += 1) {
    const y = minY + (row + 0.5) * cellHeight
    for (let column = 0; column < columns; column += 1) {
      const x = minX + (column + 0.5) * cellWidth
      const coveredByMain = active.some((nozzle) => pointInFan(
        x,
        y,
        nozzle.distanceMeters,
        0,
        Math.PI / 2,
        nozzle.sprayAngleDegrees,
        nozzle.throwMeters,
      ))
      const coveredByR55 = r55.enabled && pointInFan(
        x,
        y,
        pivotLength,
        0,
        0,
        r55.sprayAngleDegrees,
        r55.throwMeters,
      )
      if (coveredByMain || coveredByR55) covered += 1
    }
  }

  return covered * cellWidth * cellHeight
}

function buildModel(
  areaHa: number,
  type: PivotType,
  sectorAngle: number,
  pivotLength: number,
  nozzles: PivotNozzleConfig[],
  targetDepthMm: number,
  rotationHours: number,
  r55: PivotR55Config,
  wheels: PivotTrackWheelConfig[],
): PivotModel {
  const areaSqMeters = Math.max(1, areaHa * 10_000)
  const angleDegrees = type === 'circle' ? 360 : clamp(sectorAngle, 10, 355)
  const theta = (angleDegrees * Math.PI) / 180
  const safeLength = Math.max(1, pivotLength)
  const safeHours = Math.max(0.1, rotationHours)
  const idealPivotAreaSqMeters = (theta * safeLength ** 2) / 2
  const activeSorted = nozzles
    .map((nozzle, index) => ({ ...nozzle, index }))
    .filter((nozzle) => nozzle.enabled)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)

  const nozzleModels: NozzleModel[] = activeSorted.map((nozzle, sortedIndex) => {
    const previous = activeSorted[sortedIndex - 1]
    const next = activeSorted[sortedIndex + 1]
    const innerRadius = previous
      ? (previous.distanceMeters + nozzle.distanceMeters) / 2
      : 0
    const outerRadius = next
      ? (nozzle.distanceMeters + next.distanceMeters) / 2
      : safeLength
    const safeInner = clamp(innerRadius, 0, safeLength)
    const safeOuter = clamp(outerRadius, safeInner, safeLength)
    const serviceAreaSqMeters = (theta * (safeOuter ** 2 - safeInner ** 2)) / 2
    const passWaterM3 = (serviceAreaSqMeters * targetDepthMm) / 1000
    return {
      ...nozzle,
      innerRadius: safeInner,
      outerRadius: safeOuter,
      serviceAreaSqMeters,
      passWaterM3,
      flowM3h: passWaterM3 / safeHours,
      flowLMin: (passWaterM3 * 1000) / (safeHours * 60),
      colorHue: 205 - 165 * clamp(nozzle.distanceMeters / safeLength, 0, 1),
    }
  })

  const disabledModels: NozzleModel[] = nozzles
    .map((nozzle, index) => ({ nozzle, index }))
    .filter(({ nozzle }) => !nozzle.enabled)
    .map(({ nozzle, index }) => ({
      ...nozzle,
      index,
      innerRadius: nozzle.distanceMeters,
      outerRadius: nozzle.distanceMeters,
      serviceAreaSqMeters: 0,
      passWaterM3: 0,
      flowM3h: 0,
      flowLMin: 0,
      colorHue: 205 - 165 * clamp(nozzle.distanceMeters / safeLength, 0, 1),
    }))

  const nozzleById = new Map([...nozzleModels, ...disabledModels].map((nozzle) => [nozzle.id, nozzle]))
  const orderedNozzles = nozzles
    .map((nozzle) => nozzleById.get(nozzle.id))
    .filter((nozzle): nozzle is NozzleModel => Boolean(nozzle))

  const r55SweptAreaSqMeters = r55.enabled
    ? (theta * ((safeLength + r55.throwMeters) ** 2 - safeLength ** 2)) / 2
    : 0
  const r55FlowM3h = (r55SweptAreaSqMeters * targetDepthMm) / (1000 * safeHours)
  const coverageAreaSqMeters = estimateCoverageArea(nozzles, safeLength, r55)

  const wheelModels = wheels.map((wheel, index) => ({
    ...wheel,
    index,
    radius: safeLength * ((index + 1) / wheels.length),
  }))
  const bands = wheelModels
    .filter((wheel) => wheel.enabled)
    .map((wheel) => [
      Math.max(0, wheel.radius - wheel.widthMeters / 2),
      Math.min(safeLength, wheel.radius + wheel.widthMeters / 2),
    ] as [number, number])
    .filter(([inner, outer]) => outer > inner)
    .sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const band of bands) {
    const previous = merged[merged.length - 1]
    if (previous && band[0] <= previous[1]) previous[1] = Math.max(previous[1], band[1])
    else merged.push([...band])
  }
  const trackAreaSqMeters = merged.reduce(
    (sum, [inner, outer]) => sum + (theta * (outer ** 2 - inner ** 2)) / 2,
    0,
  )

  return {
    areaSqMeters,
    angleDegrees,
    theta,
    pivotLength: safeLength,
    idealPivotAreaSqMeters,
    nozzles: orderedNozzles,
    totalMainFlowM3h: nozzleModels.reduce((sum, nozzle) => sum + nozzle.flowM3h, 0),
    coverageAreaSqMeters,
    coverageWaterM3: (coverageAreaSqMeters * targetDepthMm) / 1000,
    r55SweptAreaSqMeters,
    r55FlowM3h,
    wheels: wheelModels,
    trackAreaSqMeters,
  }
}

function configKey(fieldMode: FieldMode, fieldId: string | null) {
  return fieldMode === 'existing' && fieldId ? fieldId : '__free__'
}

function arcPoints(
  center: LocalPoint,
  radius: number,
  start: number,
  end: number,
  steps = 90,
) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + (end - start) * (index / steps)
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  })
}

function annularSectorPoints(
  center: LocalPoint,
  innerRadius: number,
  outerRadius: number,
  start: number,
  end: number,
) {
  const outer = arcPoints(center, outerRadius, start, end)
  if (innerRadius <= 0.01) return [center, ...outer]
  const inner = arcPoints(center, innerRadius, end, start)
  return [...outer, ...inner]
}

function fanPoints(
  center: LocalPoint,
  direction: number,
  angleDegrees: number,
  radius: number,
) {
  if (angleDegrees >= 359.5) return arcPoints(center, radius, 0, Math.PI * 2, 72)
  const half = (angleDegrees * Math.PI) / 360
  return [center, ...arcPoints(center, radius, direction - half, direction + half, 42)]
}

export default function PivotTrackPage() {
  const {
    loadedTaskData,
    selectedFieldId,
    setSelectedFieldId,
    updateTaskData,
  } = useAppStore()
  const fields = useMemo(() => loadedTaskData?.fields ?? [], [loadedTaskData?.fields])
  const taskReady = Boolean(loadedTaskData)

  const [fieldMode, setFieldMode] = useState<FieldMode>('existing')
  const [pivotType, setPivotType] = useState<PivotType>('circle')
  const [sectorAngle, setSectorAngle] = useState(270)
  const [sectorStart, setSectorStart] = useState(-Math.PI * 0.75)
  const [areaHa, setAreaHa] = useState(70)
  const [pivotLength, setPivotLength] = useState(450)
  const [position, setPosition] = useState(35)
  const [targetDepthMm, setTargetDepthMm] = useState(DEFAULT_DEPTH_MM)
  const [rotationHours, setRotationHours] = useState(DEFAULT_ROTATION_HOURS)
  const [nozzles, setNozzles] = useState<PivotNozzleConfig[]>(() =>
    createNozzles(DEFAULT_NOZZLE_COUNT, 450),
  )
  const [selectedNozzleId, setSelectedNozzleId] = useState<string | null>(null)
  const [r55, setR55] = useState<PivotR55Config>(DEFAULT_R55)
  const [defaultWidth, setDefaultWidth] = useState(0.45)
  const [centerOffsetX, setCenterOffsetX] = useState(0)
  const [centerOffsetY, setCenterOffsetY] = useState(0)
  const [wheels, setWheels] = useState<PivotTrackWheelConfig[]>(() => createWheels(8, 0.45))
  const [zoom, setZoom] = useState(1)
  const [viewPanX, setViewPanX] = useState(0)
  const [viewPanY, setViewPanY] = useState(0)
  const [applyToAllNozzles, setApplyToAllNozzles] = useState(false)
  const [sizeVersion, setSizeVersion] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef<CanvasLayout | null>(null)
  const draggingCenterRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null)
  const draggingNozzleRef = useRef<string | null>(null)
  const draggingViewRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const loadingConfigRef = useRef(false)

  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? fields[0] ?? null
  const fieldGeometry = useMemo(() => fieldToLocal(selectedField), [selectedField])

  useEffect(() => {
    if (!selectedFieldId && fields[0]) setSelectedFieldId(fields[0].id)
  }, [fields, selectedFieldId, setSelectedFieldId])

  useEffect(() => {
    if (!taskReady) return
    const key = configKey(fieldMode, selectedField?.id ?? null)
    const stored = loadedTaskData?.tools?.pivotTracks?.[key]
    loadingConfigRef.current = true

    if (stored) {
      const migrateLegacyField = fieldMode === 'existing' && Boolean(selectedField) && !stored.nozzles?.length
      const loadedLength = migrateLegacyField
        ? round(fieldGeometry.autoLengthMeters, 1)
        : stored.pivotLengthMeters
      // Configuration hydration intentionally updates the complete editor state as one transaction.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPivotType(migrateLegacyField ? fieldGeometry.detectedType : stored.pivotType)
      setSectorAngle(migrateLegacyField ? round(fieldGeometry.sectorAngleDegrees, 1) : stored.sectorAngle)
      setSectorStart(migrateLegacyField
        ? fieldGeometry.sectorStartRadians
        : ((stored.sectorStartDegrees ?? -135) * Math.PI) / 180)
      setAreaHa(migrateLegacyField && selectedField
        ? round(Math.max(0.0001, fieldAreaSqMeters(selectedField) / 10_000), 4)
        : stored.fieldAreaHa)
      setPivotLength(loadedLength)
      setPosition(stored.positionDegrees)
      setCenterOffsetX(stored.centerOffsetXMeters)
      setCenterOffsetY(stored.centerOffsetYMeters)
      setWheels(stored.wheels.length ? stored.wheels : createWheels(8, defaultWidth))
      setNozzles(stored.nozzles?.length
        ? stored.nozzles
        : createNozzles(DEFAULT_NOZZLE_COUNT, loadedLength))
      setTargetDepthMm(stored.targetDepthMm ?? DEFAULT_DEPTH_MM)
      setRotationHours(stored.rotationHours ?? DEFAULT_ROTATION_HOURS)
      setR55(stored.r55 ?? DEFAULT_R55)
      setZoom(stored.zoom ?? 1)
      setViewPanX(stored.viewPanX ?? 0)
      setViewPanY(stored.viewPanY ?? 0)
    } else if (fieldMode === 'existing' && selectedField) {
      const nextArea = Math.max(0.0001, fieldAreaSqMeters(selectedField) / 10_000)
      const nextLength = round(fieldGeometry.autoLengthMeters, 1)
      setAreaHa(round(nextArea, 4))
      setPivotType(fieldGeometry.detectedType)
      setSectorAngle(round(fieldGeometry.sectorAngleDegrees, 1))
      setSectorStart(fieldGeometry.sectorStartRadians)
      setPivotLength(nextLength)
      setPosition(180)
      setCenterOffsetX(0)
      setCenterOffsetY(0)
      setNozzles(createNozzles(DEFAULT_NOZZLE_COUNT, nextLength))
      setTargetDepthMm(DEFAULT_DEPTH_MM)
      setRotationHours(DEFAULT_ROTATION_HOURS)
      setR55(DEFAULT_R55)
      setWheels(createWheels(8, defaultWidth))
      setZoom(1)
      setViewPanX(0)
      setViewPanY(0)
    } else {
      setAreaHa(70)
      setPivotType('circle')
      setSectorAngle(270)
      setSectorStart(-Math.PI * 0.75)
      setPivotLength(450)
      setPosition(35)
      setCenterOffsetX(0)
      setCenterOffsetY(0)
      setNozzles(createNozzles(DEFAULT_NOZZLE_COUNT, 450))
      setTargetDepthMm(DEFAULT_DEPTH_MM)
      setRotationHours(DEFAULT_ROTATION_HOURS)
      setR55(DEFAULT_R55)
      setWheels(createWheels(8, defaultWidth))
      setZoom(1)
      setViewPanX(0)
      setViewPanY(0)
    }

    setSelectedNozzleId(null)
    queueMicrotask(() => {
      loadingConfigRef.current = false
    })
    // Re-hydration is keyed only by workspace readiness, field and mode. Including the
    // auto-saved pivot object would re-hydrate the editor after every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldMode, selectedField?.id, taskReady])

  const model = useMemo(
    () => buildModel(
      areaHa,
      pivotType,
      sectorAngle,
      pivotLength,
      nozzles,
      targetDepthMm,
      rotationHours,
      r55,
      wheels,
    ),
    [
      areaHa,
      pivotType,
      sectorAngle,
      pivotLength,
      nozzles,
      targetDepthMm,
      rotationHours,
      r55,
      wheels,
    ],
  )

  const selectedNozzle = model.nozzles.find((nozzle) => nozzle.id === selectedNozzleId)
    ?? model.nozzles[0]
    ?? null

  useEffect(() => {
    if (loadingConfigRef.current || !loadedTaskData) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      const key = configKey(fieldMode, selectedField?.id ?? null)
      const config: PivotTrackConfig = {
        fieldId: fieldMode === 'existing' ? selectedField?.id ?? null : null,
        fieldMode,
        pivotType,
        sectorAngle,
        sectorStartDegrees: (sectorStart * 180) / Math.PI,
        fieldAreaHa: areaHa,
        pivotLengthMeters: pivotLength,
        positionDegrees: position,
        centerOffsetXMeters: centerOffsetX,
        centerOffsetYMeters: centerOffsetY,
        nozzles,
        targetDepthMm,
        rotationHours,
        r55,
        zoom,
        viewPanX,
        viewPanY,
        wheels,
      }
      updateTaskData((task) => ({
        ...task,
        tools: {
          ...task.tools,
          pivotTracks: {
            ...task.tools?.pivotTracks,
            [key]: config,
          },
        },
      }))
    }, 650)

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
    // updateTaskData changes loadedTaskData; including either here would schedule a save loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fieldMode,
    selectedField?.id,
    pivotType,
    sectorAngle,
    sectorStart,
    areaHa,
    pivotLength,
    position,
    centerOffsetX,
    centerOffsetY,
    nozzles,
    targetDepthMm,
    rotationHours,
    r55,
    zoom,
    viewPanX,
    viewPanY,
    wheels,
  ])

  useEffect(() => {
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => setSizeVersion((value) => value + 1))
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = canvasWrapRef.current
    if (!canvas || !wrap) return

    const rect = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, rect.width, rect.height)

    const padding = 54
    const visibleRadius = Math.max(
      fieldMode === 'existing' ? fieldGeometry.radius : 0,
      model.pivotLength + (r55.enabled ? r55.throwMeters : 0),
      model.pivotLength + Math.max(0, ...nozzles.map((nozzle) => nozzle.throwMeters)),
    )
    const baseScale = Math.max(0.01, Math.min(
      (rect.width - padding * 2) / Math.max(visibleRadius * 2, 1),
      (rect.height - padding * 2) / Math.max(visibleRadius * 2, 1),
    ))
    const scale = baseScale * zoom
    const viewportCenterX = rect.width / 2 + viewPanX
    const viewportCenterY = rect.height / 2 + viewPanY
    const pivotCenter: LocalPoint = { x: centerOffsetX, y: centerOffsetY }
    const centerX = viewportCenterX + pivotCenter.x * scale
    const centerY = viewportCenterY - pivotCenter.y * scale
    const workingStart = pivotType === 'circle' ? 0 : sectorStart
    const workingEnd = pivotType === 'circle' ? Math.PI * 2 : sectorStart + model.theta
    const frameAngle = pivotType === 'circle'
      ? (position * Math.PI) / 180
      : sectorStart + model.theta * (position / 360)

    const toScreen = (point: LocalPoint) => ({
      x: viewportCenterX + point.x * scale,
      y: viewportCenterY - point.y * scale,
    })
    const drawPolygon = (
      points: LocalPoint[],
      fillStyle: string,
      strokeStyle?: string,
      lineWidth = 1,
    ) => {
      if (!points.length) return
      const first = toScreen(points[0])
      context.beginPath()
      context.moveTo(first.x, first.y)
      for (const point of points.slice(1)) {
        const screen = toScreen(point)
        context.lineTo(screen.x, screen.y)
      }
      context.closePath()
      context.fillStyle = fillStyle
      context.fill()
      if (strokeStyle) {
        context.strokeStyle = strokeStyle
        context.lineWidth = lineWidth
        context.stroke()
      }
    }
    const drawLine = (points: LocalPoint[], strokeStyle: string, lineWidth = 1) => {
      if (!points.length) return
      const first = toScreen(points[0])
      context.beginPath()
      context.moveTo(first.x, first.y)
      for (const point of points.slice(1)) {
        const screen = toScreen(point)
        context.lineTo(screen.x, screen.y)
      }
      context.strokeStyle = strokeStyle
      context.lineWidth = lineWidth
      context.stroke()
    }

    if (fieldMode === 'existing' && fieldGeometry.polygons.length) {
      for (const polygon of fieldGeometry.polygons) {
        drawPolygon(
          polygon.map((point) => ({
            x: point.x - fieldGeometry.detectedCenter.x,
            y: point.y - fieldGeometry.detectedCenter.y,
          })),
          'rgba(77, 187, 120, 0.11)',
          'rgba(113, 222, 151, 0.82)',
          2,
        )
      }
    }

    drawPolygon(
      annularSectorPoints(pivotCenter, 0, model.pivotLength, workingStart, workingEnd),
      'rgba(62, 150, 103, 0.045)',
      'rgba(93, 194, 132, 0.58)',
      1.5,
    )

    for (const nozzle of model.nozzles) {
      if (!nozzle.enabled || nozzle.outerRadius <= nozzle.innerRadius) continue
      drawPolygon(
        annularSectorPoints(
          pivotCenter,
          nozzle.innerRadius,
          nozzle.outerRadius,
          workingStart,
          workingEnd,
        ),
        `hsla(${nozzle.colorHue}, 80%, 58%, 0.075)`,
      )
    }

    for (const wheel of model.wheels) {
      if (!wheel.enabled) continue
      drawLine(
        arcPoints(pivotCenter, wheel.radius, workingStart, workingEnd),
        'rgba(242, 201, 76, 0.4)',
        Math.max(1.2, wheel.widthMeters * scale),
      )
    }

    for (const nozzle of model.nozzles) {
      if (!nozzle.enabled) continue
      const origin = {
        x: pivotCenter.x + Math.cos(frameAngle) * nozzle.distanceMeters,
        y: pivotCenter.y + Math.sin(frameAngle) * nozzle.distanceMeters,
      }
      drawPolygon(
        fanPoints(origin, frameAngle + Math.PI / 2, nozzle.sprayAngleDegrees, nozzle.throwMeters),
        `hsla(${nozzle.colorHue}, 88%, 60%, 0.18)`,
        `hsla(${nozzle.colorHue}, 90%, 67%, 0.72)`,
        nozzle.id === selectedNozzle?.id ? 2 : 1,
      )
    }

    const frameTip = {
      x: pivotCenter.x + Math.cos(frameAngle) * model.pivotLength,
      y: pivotCenter.y + Math.sin(frameAngle) * model.pivotLength,
    }
    if (r55.enabled) {
      drawPolygon(
        fanPoints(frameTip, frameAngle, r55.sprayAngleDegrees, r55.throwMeters),
        'rgba(255, 151, 74, 0.19)',
        'rgba(255, 179, 92, 0.86)',
        2,
      )
    }

    drawLine([pivotCenter, frameTip], 'rgba(239, 246, 241, 0.92)', 4)
    drawLine([pivotCenter, frameTip], 'rgba(15, 45, 30, 0.88)', 1)

    const nozzlePoints: CanvasLayout['nozzlePoints'] = []
    for (const nozzle of model.nozzles) {
      const world = {
        x: pivotCenter.x + Math.cos(frameAngle) * nozzle.distanceMeters,
        y: pivotCenter.y + Math.sin(frameAngle) * nozzle.distanceMeters,
      }
      const screen = toScreen(world)
      context.beginPath()
      context.arc(screen.x, screen.y, nozzle.id === selectedNozzle?.id ? 7 : 4.5, 0, Math.PI * 2)
      context.fillStyle = nozzle.enabled ? `hsl(${nozzle.colorHue}, 86%, 61%)` : '#718078'
      context.fill()
      context.strokeStyle = nozzle.id === selectedNozzle?.id ? '#ffffff' : 'rgba(241, 248, 244, 0.75)'
      context.lineWidth = nozzle.id === selectedNozzle?.id ? 2.5 : 1
      context.stroke()
      nozzlePoints.push({ ...screen, id: nozzle.id })
    }

    const wheelPoints: CanvasLayout['wheelPoints'] = []
    for (const wheel of model.wheels) {
      const world = {
        x: pivotCenter.x + Math.cos(frameAngle) * wheel.radius,
        y: pivotCenter.y + Math.sin(frameAngle) * wheel.radius,
      }
      const screen = toScreen(world)
      context.beginPath()
      context.rect(screen.x - 4, screen.y - 4, 8, 8)
      context.fillStyle = wheel.enabled ? '#f2c94c' : '#708078'
      context.fill()
      wheelPoints.push({ ...screen, index: wheel.index })
    }

    context.beginPath()
    context.arc(centerX, centerY, 8, 0, Math.PI * 2)
    context.fillStyle = '#50c878'
    context.fill()
    context.strokeStyle = '#f2f6f3'
    context.lineWidth = 2
    context.stroke()

    if (r55.enabled) {
      const r55Screen = toScreen(frameTip)
      context.font = '700 11px Inter, system-ui, sans-serif'
      context.fillStyle = '#ffbd75'
      context.fillText('R55', r55Screen.x + 9, r55Screen.y - 9)
    }

    layoutRef.current = {
      centerX,
      centerY,
      scale,
      frameUnitX: Math.cos(frameAngle),
      frameUnitY: -Math.sin(frameAngle),
      nozzlePoints,
      wheelPoints,
    }
  }, [
    model,
    fieldMode,
    fieldGeometry,
    centerOffsetX,
    centerOffsetY,
    position,
    pivotType,
    sectorStart,
    r55,
    nozzles,
    selectedNozzle?.id,
    zoom,
    viewPanX,
    viewPanY,
    sizeVersion,
  ])

  const fitToField = () => {
    if (!selectedField) return
    const nextLength = round(fieldGeometry.autoLengthMeters, 1)
    setPivotType(fieldGeometry.detectedType)
    setSectorAngle(round(fieldGeometry.sectorAngleDegrees, 1))
    setSectorStart(fieldGeometry.sectorStartRadians)
    setPivotLength(nextLength)
    setCenterOffsetX(0)
    setCenterOffsetY(0)
    setNozzles((current) => redistributeNozzles(current, nextLength))
    setZoom(1)
    setViewPanX(0)
    setViewPanY(0)
  }

  const updateNozzle = (id: string, patch: Partial<PivotNozzleConfig>) => {
    const appliesToPackage = applyToAllNozzles && patch.distanceMeters === undefined
    setNozzles((current) => current.map((nozzle) =>
      appliesToPackage || nozzle.id === id ? { ...nozzle, ...patch } : nozzle,
    ))
  }

  const changePivotLength = (nextLength: number) => {
    const safeLength = Math.max(1, nextLength)
    setPivotLength(safeLength)
    setNozzles((current) => current.map((nozzle) => ({
      ...nozzle,
      distanceMeters: Math.min(nozzle.distanceMeters, safeLength),
    })))
  }

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current
    if (!layout) return
    const point = pointerPosition(event)
    const nozzle = [...layout.nozzlePoints]
      .sort((a, b) => Number(b.id === selectedNozzle?.id) - Number(a.id === selectedNozzle?.id))
      .find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 13)
    if (nozzle) {
      setSelectedNozzleId(nozzle.id)
      draggingNozzleRef.current = nozzle.id
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (Math.hypot(layout.centerX - point.x, layout.centerY - point.y) < 18) {
      draggingCenterRef.current = {
        startX: point.x,
        startY: point.y,
        offsetX: centerOffsetX,
        offsetY: centerOffsetY,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    draggingViewRef.current = {
      startX: point.x,
      startY: point.y,
      panX: viewPanX,
      panY: viewPanY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current
    if (!layout) return
    const point = pointerPosition(event)
    if (draggingNozzleRef.current) {
      const dx = point.x - layout.centerX
      const dy = point.y - layout.centerY
      const projectedMeters = (dx * layout.frameUnitX + dy * layout.frameUnitY) / layout.scale
      updateNozzle(draggingNozzleRef.current, {
        distanceMeters: round(clamp(projectedMeters, 1, pivotLength), 2),
      })
      return
    }

    const drag = draggingCenterRef.current
    if (drag) {
      setCenterOffsetX(drag.offsetX + (point.x - drag.startX) / layout.scale)
      setCenterOffsetY(drag.offsetY - (point.y - drag.startY) / layout.scale)
      return
    }

    const viewDrag = draggingViewRef.current
    if (!viewDrag) return
    setViewPanX(viewDrag.panX + point.x - viewDrag.startX)
    setViewPanY(viewDrag.panY + point.y - viewDrag.startY)
  }

  const stopDragging = () => {
    draggingCenterRef.current = null
    draggingNozzleRef.current = null
    draggingViewRef.current = null
  }

  const selectedFieldWaterM3 = (model.areaSqMeters * targetDepthMm) / 1000
  const idealPivotWaterM3 = (model.idealPivotAreaSqMeters * targetDepthMm) / 1000
  const totalDesignFlowM3h = model.totalMainFlowM3h + model.r55FlowM3h
  const r55OutsideOfficialFlow = r55.enabled && (model.r55FlowM3h < 4.2 || model.r55FlowM3h > 23.6)

  return (
    <div className="pivot-layout">
      <section className="page-card pivot-controls scroll-panel">
        <div className="section-kicker">Pivot irrigation</div>
        <h2 className="section-title">Irrigation frame constructor</h2>

        <div className="seg-row">
          <button className={`seg-btn-v2 ${fieldMode === 'existing' ? 'active' : ''}`} onClick={() => setFieldMode('existing')}>Existing field</button>
          <button className={`seg-btn-v2 ${fieldMode === 'free' ? 'active' : ''}`} onClick={() => setFieldMode('free')}>Free design</button>
        </div>

        {fieldMode === 'existing' && (
          <>
            <label className="form-label">Field</label>
            <select
              className="text-input"
              value={selectedField?.id ?? ''}
              onChange={(event) => setSelectedFieldId(event.target.value || null)}
            >
              <option value="">Select field</option>
              {fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
            </select>
            <div className="pivot-detection-row">
              <span>Detected: <strong>{fieldGeometry.detectedType === 'sector' ? `sector ${Math.round(fieldGeometry.sectorAngleDegrees)}°` : 'full circle'}</strong></span>
              <button className="ghost-btn" onClick={fitToField}>Fit to field</button>
            </div>
          </>
        )}

        <div className="seg-row">
          <button className={`seg-btn-v2 ${pivotType === 'circle' ? 'active' : ''}`} onClick={() => setPivotType('circle')}>Circular</button>
          <button className={`seg-btn-v2 ${pivotType === 'sector' ? 'active' : ''}`} onClick={() => setPivotType('sector')}>Sector</button>
        </div>

        <div className="pivot-two-column">
          <label>
            <span className="form-label">Field area, ha</span>
            <input className="text-input" type="number" min="0.01" step="0.1" value={areaHa} readOnly={fieldMode === 'existing'} onChange={(event) => setAreaHa(Math.max(0.01, Number(event.target.value) || 0.01))} />
          </label>
          <label>
            <span className="form-label">Frame length, m</span>
            <input className="text-input" type="number" min="1" step="1" value={pivotLength} onChange={(event) => changePivotLength(Number(event.target.value) || 1)} />
          </label>
        </div>

        {pivotType === 'sector' && (
          <>
            <label className="form-label">Working sector: {Math.round(sectorAngle)}°</label>
            <input className="pivot-range" type="range" min="10" max="355" value={sectorAngle} onChange={(event) => setSectorAngle(Number(event.target.value))} />
          </>
        )}

        <label className="form-label">Frame position: {Math.round(position)}°</label>
        <input className="pivot-range" type="range" min="0" max="360" value={position} onChange={(event) => setPosition(Number(event.target.value))} />

        <div className="pivot-section-heading">
          <div>
            <span className="section-kicker">Main function</span>
            <strong>Nozzle package</strong>
          </div>
          <span>{nozzles.length} nozzles</span>
        </div>

        <div className="pivot-two-column">
          <label>
            <span className="form-label">Nozzle count</span>
            <input
              className="text-input"
              type="number"
              min="1"
              max="120"
              value={nozzles.length}
              onChange={(event) => setNozzles((current) => resizeNozzles(
                current,
                clamp(Math.floor(Number(event.target.value) || 1), 1, 120),
                pivotLength,
              ))}
            />
          </label>
          <label>
            <span className="form-label">Application, mm</span>
            <input className="text-input" type="number" min="0.1" step="0.5" value={targetDepthMm} onChange={(event) => setTargetDepthMm(Math.max(0.1, Number(event.target.value) || 0.1))} />
          </label>
        </div>

        <div className="pivot-inline-control">
          <label>
            <span className="form-label">Full pass, hours</span>
            <input className="text-input" type="number" min="0.1" step="0.5" value={rotationHours} onChange={(event) => setRotationHours(Math.max(0.1, Number(event.target.value) || 0.1))} />
          </label>
          <button className="ghost-btn" onClick={() => setNozzles((current) => redistributeNozzles(current, pivotLength))}>Distribute</button>
        </div>

        <label className="pivot-switch-row pivot-apply-all-toggle">
          <input
            type="checkbox"
            checked={applyToAllNozzles}
            onChange={(event) => setApplyToAllNozzles(event.target.checked)}
          />
          <span>
            <strong>Apply nozzle settings to all</strong>
            <small>Angle, throw radius and On/Off changes affect the complete package. Position remains individual.</small>
          </span>
        </label>

        {selectedNozzle && (
          <div className="pivot-nozzle-editor">
            <div className="pivot-nozzle-editor-title">
              <span style={{ background: `hsl(${selectedNozzle.colorHue}, 86%, 61%)` }} />
              <strong>Nozzle {selectedNozzle.index + 1}</strong>
              <button
                className={selectedNozzle.enabled ? 'enabled' : ''}
                onClick={() => updateNozzle(selectedNozzle.id, { enabled: !selectedNozzle.enabled })}
              >{selectedNozzle.enabled ? 'On' : 'Off'}</button>
            </div>

            <label className="form-label">Position on frame: {selectedNozzle.distanceMeters.toFixed(1)} m</label>
            <input className="pivot-range compact" type="range" min="1" max={pivotLength} step="0.1" value={selectedNozzle.distanceMeters} onChange={(event) => updateNozzle(selectedNozzle.id, { distanceMeters: Number(event.target.value) })} />

            <label className="form-label">Spray angle: {Math.round(selectedNozzle.sprayAngleDegrees)}°</label>
            <input className="pivot-range compact" type="range" min="30" max="360" step="5" value={selectedNozzle.sprayAngleDegrees} onChange={(event) => updateNozzle(selectedNozzle.id, { sprayAngleDegrees: Number(event.target.value) })} />

            <label className="form-label">Throw radius, m</label>
            <input className="text-input" type="number" min="0.5" max="50" step="0.5" value={selectedNozzle.throwMeters} onChange={(event) => updateNozzle(selectedNozzle.id, { throwMeters: Math.max(0.5, Number(event.target.value) || 0.5) })} />

            <div className="pivot-nozzle-stats">
              <span>Service zone <strong>{formatNumber(selectedNozzle.serviceAreaSqMeters)} m²</strong></span>
              <span>Required flow <strong>{selectedNozzle.flowLMin.toFixed(1)} L/min</strong></span>
            </div>
          </div>
        )}

        <div className="pivot-r55-card">
          <label className="pivot-switch-row">
            <input type="checkbox" checked={r55.enabled} onChange={(event) => setR55((current) => ({ ...current, enabled: event.target.checked }))} />
            <span><strong>R55 end-of-pivot sprinkler</strong><small>Enabled by default</small></span>
          </label>
          {r55.enabled && (
            <>
              <label className="form-label">Throw beyond frame: {r55.throwMeters.toFixed(1)} m</label>
              <input className="pivot-range compact" type="range" min="1" max="30" step="0.5" value={r55.throwMeters} onChange={(event) => setR55((current) => ({ ...current, throwMeters: Number(event.target.value) }))} />
              <div className={`pivot-equipment-note ${r55OutsideOfficialFlow ? 'warning' : ''}`}>
                Calculated {model.r55FlowM3h.toFixed(1)} m³/h. R55 VT published operating envelope: 4.2–23.6 m³/h and 12.2–16.9 m radius.
              </div>
            </>
          )}
        </div>

        <details className="pivot-subpanel">
          <summary><span>Wheels & track calculation</span><strong>{wheels.length}</strong></summary>
          <div className="pivot-subpanel-body">
            <div className="pivot-two-column">
              <label>
                <span className="form-label">Number of wheels</span>
                <input className="text-input" type="number" min="1" max="30" value={wheels.length} onChange={(event) => setWheels((current) => resizeWheels(current, clamp(Math.floor(Number(event.target.value) || 1), 1, 30), defaultWidth))} />
              </label>
              <label>
                <span className="form-label">Track width, m</span>
                <input className="text-input" type="number" min="0.01" step="0.05" value={defaultWidth} onChange={(event) => setDefaultWidth(Math.max(0.01, Number(event.target.value) || 0.01))} />
              </label>
            </div>
            <button className="ghost-btn pivot-apply-button" onClick={() => setWheels((current) => current.map((wheel) => ({ ...wheel, widthMeters: defaultWidth })))}>Apply width to all</button>
            <div className="pivot-wheel-list">
              {wheels.map((wheel, index) => (
                <div className="pivot-wheel-row" key={index}>
                  <button className={wheel.enabled ? 'enabled' : ''} onClick={() => setWheels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item))}>{wheel.enabled ? '●' : '○'}</button>
                  <span>W{index + 1}</span>
                  <input type="number" min="0.01" step="0.05" value={wheel.widthMeters} onChange={(event) => setWheels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, widthMeters: Math.max(0.01, Number(event.target.value) || 0.01) } : item))} />
                </div>
              ))}
            </div>
            <div className="pivot-track-result">Wheel-track area: <strong>{(model.trackAreaSqMeters / 10_000).toFixed(4)} ha</strong></div>
          </div>
        </details>

        <div className="pivot-action-row">
          <button className="ghost-btn" onClick={() => { setCenterOffsetX(0); setCenterOffsetY(0) }}>Reset centre</button>
          <button className="ghost-btn" onClick={() => { setZoom(1); setViewPanX(0); setViewPanY(0) }}>Reset view</button>
        </div>
      </section>

      <section className="page-card pivot-visual-card">
        <div ref={canvasWrapRef} className="pivot-canvas-wrap">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onWheel={(event) => {
              event.preventDefault()
              setZoom((current) => clamp(current * (event.deltaY > 0 ? 0.9 : 1.1), 0.55, 4))
            }}
          />
          <div className="pivot-flow-legend">
            <span>Lower flow</span><i /><span>Higher flow</span>
          </div>
          <div className="pivot-zoom-controls">
            <button onClick={() => setZoom((current) => clamp(current * 1.2, 0.55, 4))}>+</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((current) => clamp(current / 1.2, 0.55, 4))}>−</button>
          </div>
          <div className="pivot-canvas-hint">Drag empty space to pan. Drag a nozzle along the frame or the green pivot centre to reposition it. Scroll or use +/− to zoom.</div>
        </div>

        <div className="pivot-results">
          <div className="metric-card"><span>Per 1 m²</span><strong>{targetDepthMm.toFixed(1)} L · {(targetDepthMm / 1000).toFixed(3)} t</strong></div>
          <div className="metric-card"><span>Per hectare</span><strong>{(targetDepthMm * 10).toFixed(1)} m³ · {(targetDepthMm * 10).toFixed(1)} t</strong></div>
          <div className="metric-card"><span>Selected field</span><strong>{formatNumber(selectedFieldWaterM3, 0)} m³ · {formatNumber(selectedFieldWaterM3, 0)} t</strong></div>
          <div className="metric-card"><span>Frame sweep</span><strong>{formatNumber(idealPivotWaterM3, 0)} m³ · {formatNumber(idealPivotWaterM3, 0)} t</strong></div>
          <div className="metric-card"><span>Current spray footprint</span><strong>{formatNumber(model.coverageAreaSqMeters, 0)} m²</strong></div>
          <div className="metric-card"><span>Water in footprint</span><strong>{model.coverageWaterM3.toFixed(1)} m³ · {model.coverageWaterM3.toFixed(1)} t</strong></div>
          <div className="metric-card"><span>Main nozzle flow</span><strong>{model.totalMainFlowM3h.toFixed(1)} m³/h</strong></div>
          <div className="metric-card"><span>Total with R55</span><strong>{totalDesignFlowM3h.toFixed(1)} m³/h</strong></div>
        </div>
        <div className="pivot-method-note">
          Design estimate: nozzle flow is distributed by serviced annular area, so outer nozzles receive progressively higher flow. Water mass uses the practical approximation 1 m³ ≈ 1 metric tonne. Confirm the final nozzle chart, pressure regulators and runoff limit with a Valley/Zimmatic dealer before installation.
        </div>
      </section>
    </div>
  )
}
