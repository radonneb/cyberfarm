import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldAreaSqMeters } from '../appHelpers'
import type { FieldModel, PivotTrackConfig, PivotTrackWheelConfig } from '../models/taskData'
import { useAppStore } from '../store/appStore'

type PivotType = 'circle' | 'sector'
type FieldMode = 'existing' | 'free'
type LocalPoint = { x: number; y: number }

type WheelModel = PivotTrackWheelConfig & {
  index: number
  radius: number
}

type PivotModel = {
  areaSqMeters: number
  angleDegrees: number
  theta: number
  equivalentRadius: number
  pivotLength: number
  wheels: WheelModel[]
  trackAreaSqMeters: number
}

type CanvasLayout = {
  centerX: number
  centerY: number
  scale: number
  rotation: number
  pivotAngle: number
  wheelPoints: Array<{ x: number; y: number; index: number }>
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

function buildModel(
  areaHa: number,
  type: PivotType,
  sectorAngle: number,
  pivotLength: number,
  wheels: PivotTrackWheelConfig[],
): PivotModel {
  const areaSqMeters = Math.max(1, areaHa * 10_000)
  const angleDegrees = type === 'circle' ? 360 : clamp(sectorAngle, 30, 355)
  const theta = (angleDegrees * Math.PI) / 180
  const equivalentRadius = Math.sqrt((2 * areaSqMeters) / theta)

  const wheelModels = wheels.map((wheel, index) => ({
    ...wheel,
    index,
    radius: pivotLength * ((index + 1) / wheels.length),
  }))

  const bands = wheelModels
    .filter(
      (wheel) =>
        wheel.enabled &&
        wheel.radius < equivalentRadius + wheel.widthMeters / 2,
    )
    .map((wheel) => [
      Math.max(0, wheel.radius - wheel.widthMeters / 2),
      Math.min(equivalentRadius, wheel.radius + wheel.widthMeters / 2),
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
    equivalentRadius,
    pivotLength,
    wheels: wheelModels,
    trackAreaSqMeters,
  }
}

function fieldToLocal(field: FieldModel | null) {
  const points = field?.boundaries.flatMap((boundary) => boundary.points) ?? []
  if (!points.length) return { polygons: [] as LocalPoint[][], radius: 0 }

  const latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length
  const longitude = points.reduce((sum, point) => sum + point.longitude, 0) / points.length
  const metersPerLon = 111_320 * Math.cos((latitude * Math.PI) / 180)

  const polygons = (field?.boundaries ?? []).map((boundary) =>
    boundary.points.map((point) => ({
      x: (point.longitude - longitude) * metersPerLon,
      y: (point.latitude - latitude) * 111_320,
    })),
  )

  const radius = Math.max(
    0,
    ...polygons.flatMap((polygon) => polygon.map((point) => Math.hypot(point.x, point.y))),
  )

  return { polygons, radius }
}

function configKey(fieldMode: FieldMode, fieldId: string | null) {
  return fieldMode === 'existing' && fieldId ? fieldId : '__free__'
}

export default function PivotTrackPage() {
  const {
    loadedTaskData,
    selectedFieldId,
    setSelectedFieldId,
    updateTaskData,
  } = useAppStore()
  const fields = loadedTaskData?.fields ?? []

  const [fieldMode, setFieldMode] = useState<FieldMode>('existing')
  const [pivotType, setPivotType] = useState<PivotType>('circle')
  const [sectorAngle, setSectorAngle] = useState(270)
  const [areaHa, setAreaHa] = useState(70)
  const [pivotLength, setPivotLength] = useState(450)
  const [position, setPosition] = useState(35)
  const [defaultWidth, setDefaultWidth] = useState(0.45)
  const [centerOffsetX, setCenterOffsetX] = useState(0)
  const [centerOffsetY, setCenterOffsetY] = useState(0)
  const [wheels, setWheels] = useState<PivotTrackWheelConfig[]>(() => createWheels(8, 0.45))
  const [water, setWater] = useState<boolean[]>(() => Array.from({ length: 360 }, () => false))
  const [sizeVersion, setSizeVersion] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const lastPositionRef = useRef(position)
  const layoutRef = useRef<CanvasLayout | null>(null)
  const draggingCenterRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const loadingConfigRef = useRef(false)

  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? fields[0] ?? null
  const fieldGeometry = useMemo(() => fieldToLocal(selectedField), [selectedField])

  useEffect(() => {
    if (!selectedFieldId && fields[0]) setSelectedFieldId(fields[0].id)
  }, [fields, selectedFieldId, setSelectedFieldId])

  useEffect(() => {
    if (fieldMode !== 'existing' || !selectedField) return
    const nextArea = fieldAreaSqMeters(selectedField) / 10_000
    if (nextArea > 0) setAreaHa(Number(nextArea.toFixed(4)))
  }, [fieldMode, selectedField])

  useEffect(() => {
    const key = configKey(fieldMode, selectedField?.id ?? null)
    const stored = loadedTaskData?.tools?.pivotTracks?.[key]
    if (!stored) {
      setCenterOffsetX(0)
      setCenterOffsetY(0)
      return
    }

    loadingConfigRef.current = true
    setPivotType(stored.pivotType)
    setSectorAngle(stored.sectorAngle)
    setAreaHa(stored.fieldAreaHa)
    setPivotLength(stored.pivotLengthMeters)
    setPosition(stored.positionDegrees)
    setCenterOffsetX(stored.centerOffsetXMeters)
    setCenterOffsetY(stored.centerOffsetYMeters)
    setWheels(stored.wheels.length ? stored.wheels : createWheels(8, defaultWidth))
    queueMicrotask(() => {
      loadingConfigRef.current = false
    })
  }, [fieldMode, selectedField?.id])

  const model = useMemo(
    () => buildModel(areaHa, pivotType, sectorAngle, pivotLength, wheels),
    [areaHa, pivotType, sectorAngle, pivotLength, wheels],
  )

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
        fieldAreaHa: areaHa,
        pivotLengthMeters: pivotLength,
        positionDegrees: position,
        centerOffsetXMeters: centerOffsetX,
        centerOffsetYMeters: centerOffsetY,
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
  }, [
    fieldMode,
    selectedField?.id,
    pivotType,
    sectorAngle,
    areaHa,
    pivotLength,
    position,
    centerOffsetX,
    centerOffsetY,
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
    const contentRadius = Math.max(
      model.equivalentRadius,
      model.pivotLength,
      fieldMode === 'existing' ? fieldGeometry.radius : 0,
    )
    const scale = Math.max(
      0.01,
      Math.min(
        (rect.width - padding * 2) / Math.max(contentRadius * 2, 1),
        (rect.height - padding * 2) / Math.max(contentRadius * 2, 1),
      ),
    )
    const centerX = rect.width / 2 + centerOffsetX * scale
    const centerY = rect.height / 2 - centerOffsetY * scale
    const rotation = pivotType === 'circle' ? 0 : -Math.PI / 2 - model.theta / 2
    const pivotAngle = pivotType === 'circle'
      ? (position * Math.PI) / 180
      : model.theta * (position / 360)

    context.save()
    context.translate(rect.width / 2, rect.height / 2)
    context.scale(1, -1)

    if (fieldMode === 'existing' && fieldGeometry.polygons.length) {
      for (const polygon of fieldGeometry.polygons) {
        if (!polygon.length) continue
        context.beginPath()
        context.moveTo(polygon[0].x * scale, polygon[0].y * scale)
        for (const point of polygon.slice(1)) context.lineTo(point.x * scale, point.y * scale)
        context.closePath()
        context.fillStyle = 'rgba(77, 187, 120, 0.12)'
        context.fill()
        context.strokeStyle = 'rgba(113, 222, 151, 0.85)'
        context.lineWidth = 2
        context.stroke()
      }
    }

    context.restore()

    context.save()
    context.translate(centerX, centerY)
    context.rotate(rotation)

    context.beginPath()
    context.moveTo(0, 0)
    context.arc(0, 0, model.equivalentRadius * scale, 0, model.theta)
    if (pivotType === 'sector') context.closePath()
    context.fillStyle = 'rgba(77, 187, 120, 0.07)'
    context.fill()
    context.strokeStyle = 'rgba(77, 187, 120, 0.75)'
    context.lineWidth = 2
    context.stroke()

    context.save()
    context.beginPath()
    context.moveTo(0, 0)
    context.arc(0, 0, model.equivalentRadius * scale, 0, model.theta)
    if (pivotType === 'sector') context.closePath()
    context.clip()
    context.fillStyle = 'rgba(90, 207, 224, 0.15)'
    for (let index = 0; index < 360; index += 1) {
      if (!water[index]) continue
      const angle = pivotType === 'circle'
        ? (index * Math.PI) / 180
        : model.theta * (index / 360)
      context.beginPath()
      context.moveTo(0, 0)
      context.arc(
        0,
        0,
        Math.min(model.pivotLength, model.equivalentRadius) * scale,
        angle - 0.008,
        angle + 0.026,
      )
      context.closePath()
      context.fill()
    }
    context.restore()

    for (const wheel of model.wheels) {
      if (wheel.radius > model.equivalentRadius + wheel.widthMeters / 2) continue
      context.beginPath()
      context.arc(0, 0, wheel.radius * scale, 0, model.theta)
      context.strokeStyle = wheel.enabled
        ? 'rgba(242, 201, 76, 0.88)'
        : 'rgba(160, 177, 168, 0.5)'
      context.lineWidth = Math.max(1.4, wheel.widthMeters * scale)
      context.stroke()
    }

    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(
      Math.min(model.pivotLength, model.equivalentRadius) * scale * Math.cos(pivotAngle),
      Math.min(model.pivotLength, model.equivalentRadius) * scale * Math.sin(pivotAngle),
    )
    context.strokeStyle = 'rgba(239, 246, 241, 0.78)'
    context.lineWidth = 2
    context.stroke()

    const wheelPoints: CanvasLayout['wheelPoints'] = []
    for (const wheel of model.wheels) {
      if (wheel.radius > model.equivalentRadius) continue
      const x = wheel.radius * scale * Math.cos(pivotAngle)
      const y = wheel.radius * scale * Math.sin(pivotAngle)
      context.beginPath()
      context.arc(x, y, wheel.enabled ? 6 : 5, 0, Math.PI * 2)
      context.fillStyle = wheel.enabled ? '#f2c94c' : '#8fa298'
      context.fill()
      context.strokeStyle = '#f2f6f3'
      context.lineWidth = 1.5
      context.stroke()
      wheelPoints.push({ x: centerX + x, y: centerY + y, index: wheel.index })
    }

    context.beginPath()
    context.arc(0, 0, 7, 0, Math.PI * 2)
    context.fillStyle = '#50c878'
    context.fill()
    context.strokeStyle = '#f2f6f3'
    context.lineWidth = 2
    context.stroke()
    context.restore()

    layoutRef.current = { centerX, centerY, scale, rotation, pivotAngle, wheelPoints }
  }, [
    model,
    water,
    fieldMode,
    fieldGeometry,
    centerOffsetX,
    centerOffsetY,
    position,
    pivotType,
    sizeVersion,
  ])

  const markIrrigation = (nextPosition: number) => {
    const previous = lastPositionRef.current
    const next = [...water]
    let start = Math.round(previous)
    let end = Math.round(nextPosition)
    if (pivotType === 'circle' && Math.abs(start - end) > 180) {
      if (start < end) start += 360
      else end += 360
    }
    for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) {
      next[(index + 360) % 360] = true
    }
    lastPositionRef.current = nextPosition
    setWater(next)
    setPosition(nextPosition)
  }

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current
    if (!layout) return
    const point = pointerPosition(event)

    const wheel = layout.wheelPoints.find(
      (candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 13,
    )
    if (wheel) {
      setWheels((current) =>
        current.map((item, index) =>
          index === wheel.index ? { ...item, enabled: !item.enabled } : item,
        ),
      )
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
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = draggingCenterRef.current
    const layout = layoutRef.current
    if (!drag || !layout) return
    const point = pointerPosition(event)
    setCenterOffsetX(drag.offsetX + (point.x - drag.startX) / layout.scale)
    setCenterOffsetY(drag.offsetY - (point.y - drag.startY) / layout.scale)
  }

  const stopDragging = () => {
    draggingCenterRef.current = null
  }

  const activeInside = model.wheels.filter(
    (wheel) => wheel.enabled && wheel.radius < model.equivalentRadius + wheel.widthMeters / 2,
  ).length
  const totalArcKm = model.wheels
    .filter((wheel) => wheel.enabled && wheel.radius < model.equivalentRadius)
    .reduce((sum, wheel) => sum + wheel.radius * model.theta, 0) / 1000

  return (
    <div className="pivot-layout">
      <section className="page-card pivot-controls scroll-panel">
        <div className="section-kicker">Pivot Track</div>
        <h2 className="section-title">Wheel-track calculator</h2>

        <div className="seg-row">
          <button className={`seg-btn-v2 ${fieldMode === 'existing' ? 'active' : ''}`} onClick={() => setFieldMode('existing')}>Existing field</button>
          <button className={`seg-btn-v2 ${fieldMode === 'free' ? 'active' : ''}`} onClick={() => setFieldMode('free')}>Free calculation</button>
        </div>

        {fieldMode === 'existing' && (
          <>
            <label className="form-label">Field</label>
            <select
              className="text-input"
              value={selectedField?.id ?? ''}
              onChange={(event) => {
                setSelectedFieldId(event.target.value || null)
                setCenterOffsetX(0)
                setCenterOffsetY(0)
              }}
            >
              <option value="">Select field</option>
              {fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
            </select>
            <div className="pivot-center-note">
              The pivot starts at the calculated field centre. Drag the green centre marker to adjust it.
            </div>
          </>
        )}

        <div className="seg-row">
          <button className={`seg-btn-v2 ${pivotType === 'circle' ? 'active' : ''}`} onClick={() => setPivotType('circle')}>Circular</button>
          <button className={`seg-btn-v2 ${pivotType === 'sector' ? 'active' : ''}`} onClick={() => setPivotType('sector')}>Sector</button>
        </div>

        <label className="form-label">Field area, ha</label>
        <input className="text-input" type="number" min="0.01" step="0.1" value={areaHa} readOnly={fieldMode === 'existing'} onChange={(event) => setAreaHa(Math.max(0.01, Number(event.target.value) || 0.01))} />

        {pivotType === 'sector' && (
          <>
            <label className="form-label">Working angle: {Math.round(sectorAngle)}°</label>
            <input className="pivot-range" type="range" min="30" max="355" value={sectorAngle} onChange={(event) => setSectorAngle(Number(event.target.value))} />
          </>
        )}

        <label className="form-label">Pivot length, m</label>
        <input className="text-input" type="number" min="1" step="1" value={pivotLength} onChange={(event) => setPivotLength(Math.max(1, Number(event.target.value) || 1))} />

        <label className="form-label">Number of wheels</label>
        <input
          className="text-input"
          type="number"
          min="1"
          max="30"
          value={wheels.length}
          onChange={(event) => setWheels((current) => resizeWheels(current, clamp(Math.floor(Number(event.target.value) || 1), 1, 30), defaultWidth))}
        />

        <label className="form-label">Default track width, m</label>
        <div className="pivot-inline-control">
          <input className="text-input" type="number" min="0.01" step="0.05" value={defaultWidth} onChange={(event) => setDefaultWidth(Math.max(0.01, Number(event.target.value) || 0.01))} />
          <button className="ghost-btn" onClick={() => setWheels((current) => current.map((wheel) => ({ ...wheel, widthMeters: defaultWidth })))}>Apply all</button>
        </div>

        <label className="form-label">Pivot position: {Math.round(position)}°</label>
        <input className="pivot-range" type="range" min="0" max="360" value={position} onChange={(event) => markIrrigation(Number(event.target.value))} />

        <div className="pivot-action-row">
          <button className="ghost-btn" onClick={() => {
            setWater(Array.from({ length: 360 }, () => false))
            lastPositionRef.current = position
          }}>Clear irrigation</button>
          <button className="ghost-btn" onClick={() => {
            setCenterOffsetX(0)
            setCenterOffsetY(0)
          }}>Reset centre</button>
        </div>

        <div className="pivot-wheel-list">
          {wheels.map((wheel, index) => (
            <div className="pivot-wheel-row" key={index}>
              <button
                className={wheel.enabled ? 'enabled' : ''}
                onClick={() => setWheels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item))}
                title={wheel.enabled ? 'Disable wheel' : 'Enable wheel'}
              >
                {wheel.enabled ? '●' : '○'}
              </button>
              <span>W{index + 1}</span>
              <input
                type="number"
                min="0.01"
                step="0.05"
                value={wheel.widthMeters}
                onChange={(event) => setWheels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, widthMeters: Math.max(0.01, Number(event.target.value) || 0.01) } : item))}
              />
            </div>
          ))}
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
          />
          <div className="pivot-canvas-hint">Click wheel markers to toggle. Drag the green centre marker to adjust the pivot.</div>
        </div>

        <div className="pivot-results">
          <div className="metric-card"><span>Track area</span><strong>{(model.trackAreaSqMeters / 10_000).toFixed(4)} ha</strong></div>
          <div className="metric-card"><span>Square metres</span><strong>{Math.round(model.trackAreaSqMeters).toLocaleString('en-US')} m²</strong></div>
          <div className="metric-card"><span>Field share</span><strong>{((model.trackAreaSqMeters / model.areaSqMeters) * 100).toFixed(3)}%</strong></div>
          <div className="metric-card"><span>Active wheels inside</span><strong>{activeInside} of {model.wheels.length}</strong></div>
          <div className="metric-card"><span>Equivalent radius</span><strong>{model.equivalentRadius.toFixed(1)} m</strong></div>
          <div className="metric-card"><span>Active arc length</span><strong>{totalArcKm.toFixed(2)} km</strong></div>
        </div>
      </section>
    </div>
  )
}
