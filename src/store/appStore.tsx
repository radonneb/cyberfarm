import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { parseImportedFile } from '../utils/importers'
import { importResultToTaskData } from '../utils/importResultToTaskData'
import type {
  ExportFormat,
  FieldBoundary,
  FieldModel,
  GeoPoint,
  ImportedFileRecord,
  TaskDataModel,
  EditorMode,
  GuidanceLine,
} from '../models/taskData'
import { cloneTaskData, uid } from '../models/taskData'
import { exportTaskData } from '../utils/taskDataExportService'
import { parseTaskDataXmlFile } from '../utils/taskDataXmlParser'

type DraftCreateState = {
  target: 'newField' | 'existingField' | null
  targetFieldId: string | null
  fieldName: string
  guidanceName: string
  boundaryPoints: GeoPoint[]
  guidancePoints: GeoPoint[]
}

type GenerationInput = {
  fieldId: string
  width: number
  operation: 'seeding' | 'fertilizing' | 'spraying' | 'others'
  crop?: string
  rate?: number
  units?: string
  mixtureRate?: number
  chemicalRate?: number
}

type GeneratedLineMetric = {
  id: string
  name: string
  lineIndex: number
  lengthMeters: number
  areaHectares: number
  materialSummary: string
  seedAmount?: number
  seedUnits?: string
  fertilizerKg?: number
  mixtureLiters?: number
  chemicalGrams?: number
}

type GenerationResult = {
  operation: GenerationInput['operation']
  widthMeters: number
  crop?: string
  units?: string
  lines: GeneratedLineMetric[]
  totalLines: number
  totalLengthMeters: number
  totalAreaHectares: number
  totalMaterialSummary: string
  totalSeedAmount?: number
  totalFertilizerKg?: number
  totalMixtureLiters?: number
  totalChemicalGrams?: number
}

type AppStoreValue = {
  importHistory: ImportedFileRecord[]
  loadedTaskData: TaskDataModel | null
  currentFileName: string | null
  errorMessage: string | null
  selectedFieldId: string | null
  editorMode: EditorMode
  draftCreate: DraftCreateState
  generationResult: GenerationResult | null
  dataVersion: number

  importAny: (file: File) => Promise<void>
  setErrorMessage: (value: string | null) => void
  setSelectedFieldId: (value: string | null) => void
  setEditorMode: (value: EditorMode) => void
  openHistoryItem: (recordId: string) => void
  deleteHistoryItem: (recordId: string) => void
  createEmptyMap: () => void
  saveCurrentTaskData: () => boolean
  exportCurrent: (format: ExportFormat) => Promise<void>

  startCreateNewField: (fieldName?: string, guidanceName?: string) => void
  startCreateGuidanceForField: (fieldId: string, guidanceName?: string) => void
  setDraftFieldName: (value: string) => void
  setDraftGuidanceName: (value: string) => void
  addDraftBoundaryPoint: (lat: number, lon: number) => void
  addDraftGuidancePoint: (lat: number, lon: number) => void
  clearDraft: () => void
  commitDraftCreate: () => boolean

  updateFieldName: (fieldId: string, name: string) => void
  deleteField: (fieldId: string) => void
  deleteBoundary: (fieldId: string, boundaryId: string) => void
  deleteGuidance: (fieldId: string, guidanceId: string) => void
  updateBoundaryPoint: (
    fieldId: string,
    boundaryId: string,
    pointId: string,
    lat: number,
    lon: number,
  ) => void
  addBoundaryPoint: (fieldId: string, boundaryId: string) => void
  deleteBoundaryPoint: (fieldId: string, boundaryId: string, pointId: string) => void
  updateGuidanceName: (fieldId: string, guidanceId: string, name: string) => void
  updateGuidancePoint: (
    fieldId: string,
    guidanceId: string,
    pointId: string,
    lat: number,
    lon: number,
  ) => void
  addGuidancePoint: (fieldId: string, guidanceId: string) => void
  generateLines: (input: GenerationInput) => boolean
  clearGenerationResult: () => void
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

const HISTORY_KEY = 'gargha_import_history'
const CURRENT_KEY = 'gargha_current_taskdata'
const CURRENT_NAME_KEY = 'gargha_current_file_name'

function loadHistory(): ImportedFileRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(history: ImportedFileRecord[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
}

function saveCurrentTask(task: TaskDataModel | null, fileName: string | null) {
  if (task) localStorage.setItem(CURRENT_KEY, JSON.stringify(task))
  else localStorage.removeItem(CURRENT_KEY)

  if (fileName) localStorage.setItem(CURRENT_NAME_KEY, fileName)
  else localStorage.removeItem(CURRENT_NAME_KEY)
}

function loadCurrentTask(): { task: TaskDataModel | null; fileName: string | null } {
  try {
    const rawTask = localStorage.getItem(CURRENT_KEY)
    const rawName = localStorage.getItem(CURRENT_NAME_KEY)
    return {
      task: rawTask ? JSON.parse(rawTask) : null,
      fileName: rawName ?? null,
    }
  } catch {
    return { task: null, fileName: null }
  }
}

function emptyDraft(): DraftCreateState {
  return {
    target: null,
    targetFieldId: null,
    fieldName: 'Field',
    guidanceName: 'Guidance 1',
    boundaryPoints: [],
    guidancePoints: [],
  }
}

function upsertTask(
  task: TaskDataModel | null,
  currentName: string | null,
  setLoadedTaskData: (task: TaskDataModel | null) => void,
  setCurrentFileName: (name: string | null) => void,
  setImportHistory?: Dispatch<SetStateAction<ImportedFileRecord[]>>,
  existingHistory?: ImportedFileRecord[],
) {
  setLoadedTaskData(task)
  setCurrentFileName(currentName)
  saveCurrentTask(task, currentName)

  if (task && currentName && setImportHistory && existingHistory) {
    const nextHistory = existingHistory.map((record) =>
      record.originalFileName === currentName
        ? { ...record, snapshot: cloneTaskData(task) }
        : record,
    )
    setImportHistory(nextHistory)
    saveHistory(nextHistory)
  }
}

function metersBetween(a: GeoPoint, b: GeoPoint) {
  const latFactor = 111320
  const lonFactor =
    Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180) * 111320
  const dy = (b.latitude - a.latitude) * latFactor
  const dx = (b.longitude - a.longitude) * lonFactor
  return Math.sqrt(dx * dx + dy * dy)
}

function lineLengthMeters(points: GeoPoint[]) {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += metersBetween(points[i - 1], points[i])
  }
  return total
}

type XY = { x: number; y: number }

type GeneratedSegmentMetrics = {
  lengthMeters: number
  areaHectares: number
  materialAmount?: number
  mixLiters?: number
  chemicalGrams?: number
}

type GeneratedLineLike = {
  id: string
  name: string
  points: GeoPoint[]
  lineNumber: number
  isBaseLine?: boolean
  source?: 'generated'
  metrics?: GeneratedSegmentMetrics
}

function metersPerDegreeLon(lat: number) {
  return 111320 * Math.cos((lat * Math.PI) / 180)
}

function metersPerDegreeLat() {
  return 111320
}

function geoToLocal(point: GeoPoint, origin: GeoPoint): XY {
  return {
    x: (point.longitude - origin.longitude) * metersPerDegreeLon(origin.latitude),
    y: (point.latitude - origin.latitude) * metersPerDegreeLat(),
  }
}

function localToGeo(point: XY, origin: GeoPoint): GeoPoint {
  return {
    id: uid(),
    longitude: origin.longitude + point.x / metersPerDegreeLon(origin.latitude),
    latitude: origin.latitude + point.y / metersPerDegreeLat(),
  }
}

function getFieldOrigin(boundaries: FieldBoundary[]): GeoPoint {
  const firstPoint = boundaries[0]?.points[0]
  if (!firstPoint) {
    return { id: uid(), latitude: 0, longitude: 0 }
  }
  return firstPoint
}

function distanceXY(a: XY, b: XY) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function normalize(v: XY): XY {
  const len = Math.hypot(v.x, v.y)
  if (len === 0) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

function dot(a: XY, b: XY) {
  return a.x * b.x + a.y * b.y
}

function sub(a: XY, b: XY): XY {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: XY, b: XY): XY {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(v: XY, s: number): XY {
  return { x: v.x * s, y: v.y * s }
}

function polygonToLocal(boundary: FieldBoundary, origin: GeoPoint): XY[] {
  return boundary.points.map((p) => geoToLocal(p, origin))
}

function ensureClosed(points: XY[]): XY[] {
  if (points.length < 2) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (first.x === last.x && first.y === last.y) return points
  return [...points, first]
}

function lineNormalFromBase(points: GeoPoint[], origin: GeoPoint) {
  const start = geoToLocal(points[0], origin)
  const end = geoToLocal(points[points.length - 1], origin)
  const dir = normalize(sub(end, start))
  const normal = { x: -dir.y, y: dir.x }
  return { start, end, dir, normal }
}

function lineOffsetDistance(point: XY, basePoint: XY, normal: XY) {
  return dot(sub(point, basePoint), normal)
}

function segmentLineIntersection(
  a: XY,
  b: XY,
  linePoint: XY,
  lineDir: XY,
): { point: XY; tSeg: number; tLine: number } | null {
  const seg = sub(b, a)
  const det = seg.x * -lineDir.y - seg.y * -lineDir.x
  if (Math.abs(det) < 1e-9) return null

  const rhs = sub(linePoint, a)
  const tSeg = (rhs.x * -lineDir.y - rhs.y * -lineDir.x) / det
  const tLine = (seg.x * rhs.y - seg.y * rhs.x) / det

  if (tSeg < -1e-9 || tSeg > 1 + 1e-9) return null

  return {
    point: add(a, scale(seg, tSeg)),
    tSeg,
    tLine,
  }
}

function pointInPolygonXY(point: XY, polygon: XY[]) {
  let inside = false
  const pts = ensureClosed(polygon)

  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]
    const b = pts[i + 1]

    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x

    if (intersects) inside = !inside
  }

  return inside
}

function clipInfiniteLineByPolygon(
  polygon: XY[],
  linePoint: XY,
  lineDir: XY,
): Array<{ start: XY; end: XY }> {
  const pts = ensureClosed(polygon)
  const intersections: Array<{ point: XY; tLine: number }> = []

  for (let i = 0; i < pts.length - 1; i += 1) {
    const hit = segmentLineIntersection(pts[i], pts[i + 1], linePoint, lineDir)
    if (hit) {
      const alreadyExists = intersections.some(
        (p) =>
          Math.abs(p.point.x - hit.point.x) < 1e-6 &&
          Math.abs(p.point.y - hit.point.y) < 1e-6,
      )

      if (!alreadyExists) {
        intersections.push({ point: hit.point, tLine: hit.tLine })
      }
    }
  }

  if (intersections.length < 2) return []

  intersections.sort((a, b) => a.tLine - b.tLine)

  const segments: Array<{ start: XY; end: XY }> = []

  for (let i = 0; i < intersections.length - 1; i += 2) {
    const p1 = intersections[i]
    const p2 = intersections[i + 1]
    const mid = scale(add(p1.point, p2.point), 0.5)

    if (pointInPolygonXY(mid, polygon) && distanceXY(p1.point, p2.point) > 0.05) {
      segments.push({ start: p1.point, end: p2.point })
    }
  }

  return segments
}

function buildMetricsForGeneratedLine(
  lengthMeters: number,
  implementWidthMeters: number,
  operation: 'Seeding' | 'Fertilizing' | 'Spraying' | 'Others',
  options: {
    seedRate?: number
    seedUnit?: 'kg/ha' | 'TK/ha'
    fertilizerRate?: number
    sprayMixRate?: number
    sprayChemicalRate?: number
  },
): GeneratedSegmentMetrics {
  const areaHectares = (lengthMeters * implementWidthMeters) / 10000

  if (operation === 'Seeding') {
    return {
      lengthMeters,
      areaHectares,
      materialAmount: areaHectares * (options.seedRate || 0),
    }
  }

  if (operation === 'Fertilizing') {
    return {
      lengthMeters,
      areaHectares,
      materialAmount: areaHectares * (options.fertilizerRate || 0),
    }
  }

  if (operation === 'Spraying') {
    return {
      lengthMeters,
      areaHectares,
      mixLiters: areaHectares * (options.sprayMixRate || 0),
      chemicalGrams: areaHectares * (options.sprayChemicalRate || 0),
    }
  }

  return {
    lengthMeters,
    areaHectares,
  }
}

function generateLinesForAllBoundaries(params: {
  field: FieldModel
  baseGuidanceLine: GuidanceLine
  implementWidthMeters: number
  operation: 'Seeding' | 'Fertilizing' | 'Spraying' | 'Others'
  seedRate?: number
  seedUnit?: 'kg/ha' | 'TK/ha'
  fertilizerRate?: number
  sprayMixRate?: number
  sprayChemicalRate?: number
}): GeneratedLineLike[] {
  const {
    field,
    baseGuidanceLine,
    implementWidthMeters,
    operation,
    seedRate,
    seedUnit,
    fertilizerRate,
    sprayMixRate,
    sprayChemicalRate,
  } = params

  if (!field.boundaries.length || baseGuidanceLine.points.length < 2) return []

  const origin = getFieldOrigin(field.boundaries)
  const base = lineNormalFromBase(baseGuidanceLine.points, origin)
  const start = base.start
  const dir = base.dir
  const normal = base.normal

  let minOffset = Infinity
  let maxOffset = -Infinity

  for (const boundary of field.boundaries) {
    for (const point of boundary.points) {
      const local = geoToLocal(point, origin)
      const d = lineOffsetDistance(local, start, normal)
      minOffset = Math.min(minOffset, d)
      maxOffset = Math.max(maxOffset, d)
    }
  }

  const results: GeneratedLineLike[] = []

  const addSegmentsForOffset = (offset: number, lineNumber: number) => {
    const linePoint = add(start, scale(normal, offset))

    for (const boundary of field.boundaries) {
      const polygon = ensureClosed(polygonToLocal(boundary, origin))
      const segments = clipInfiniteLineByPolygon(polygon, linePoint, dir)

      for (const segment of segments) {
        const lengthMeters = distanceXY(segment.start, segment.end)
        if (lengthMeters < 1) continue

        const metrics = buildMetricsForGeneratedLine(
          lengthMeters,
          implementWidthMeters,
          operation,
          {
            seedRate,
            seedUnit,
            fertilizerRate,
            sprayMixRate,
            sprayChemicalRate,
          },
        )

        results.push({
          id: uid(),
          name: `${lineNumber > 0 ? `+${lineNumber}` : lineNumber}`,
          lineNumber,
          isBaseLine: lineNumber === 0,
          source: 'generated',
          points: [localToGeo(segment.start, origin), localToGeo(segment.end, origin)],
          metrics,
        })
      }
    }
  }

  addSegmentsForOffset(0, 0)

  const positiveMaxIndex = Math.ceil(Math.max(0, maxOffset) / implementWidthMeters)
  const negativeMaxIndex = Math.ceil(Math.max(0, -minOffset) / implementWidthMeters)

  for (let i = 1; i <= positiveMaxIndex; i += 1) {
    addSegmentsForOffset(i * implementWidthMeters, i)
  }

  for (let i = 1; i <= negativeMaxIndex; i += 1) {
    addSegmentsForOffset(-i * implementWidthMeters, -i)
  }

  return results.sort((a, b) => {
    if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber

    const aMid = a.points[Math.floor(a.points.length / 2)]
    const bMid = b.points[Math.floor(b.points.length / 2)]
    return aMid.latitude - bMid.latitude || aMid.longitude - bMid.longitude
  })
}

function buildLineMetric(
  line: GeneratedLineLike,
  input: GenerationInput,
  index: number,
): GeneratedLineMetric {
  const lengthMeters = line.metrics?.lengthMeters ?? lineLengthMeters(line.points)
  const areaHectares = line.metrics?.areaHectares ?? (lengthMeters * input.width) / 10000

  if (input.operation === 'seeding') {
    const seedAmount = line.metrics?.materialAmount ?? (input.rate ?? 0) * areaHectares
    const seedUnits = input.units ?? 'kg/ha'

    return {
      id: line.id,
      name: line.name || `${index}`,
      lineIndex: line.lineNumber ?? (Number(line.name ?? index) || 0),
      lengthMeters,
      areaHectares,
      seedAmount,
      seedUnits,
      materialSummary: `${seedAmount.toFixed(2)} ${seedUnits.replace('/ha', '')}`,
    }
  }

  if (input.operation === 'fertilizing') {
    const fertilizerKg =
      line.metrics?.materialAmount ?? (input.rate ?? 0) * areaHectares

    return {
      id: line.id,
      name: line.name || `${index}`,
      lineIndex: line.lineNumber ?? (Number(line.name ?? index) || 0),
      lengthMeters,
      areaHectares,
      fertilizerKg,
      materialSummary: `${fertilizerKg.toFixed(2)} kg`,
    }
  }

  if (input.operation === 'spraying') {
    const mixtureLiters =
      line.metrics?.mixLiters ?? (input.mixtureRate ?? 0) * areaHectares
    const chemicalGrams =
      line.metrics?.chemicalGrams ?? (input.chemicalRate ?? 0) * areaHectares

    return {
      id: line.id,
      name: line.name || `${index}`,
      lineIndex: line.lineNumber ?? (Number(line.name ?? index) || 0),
      lengthMeters,
      areaHectares,
      mixtureLiters,
      chemicalGrams,
      materialSummary: `${mixtureLiters.toFixed(2)} L mix, ${chemicalGrams.toFixed(2)} g chemical`,
    }
  }

  return {
    id: line.id,
    name: line.name || `${index}`,
    lineIndex: line.lineNumber ?? (Number(line.name ?? index) || 0),
    lengthMeters,
    areaHectares,
    materialSummary: 'Length and area only',
  }
}

function totalMaterialSummary(
  operation: GenerationInput['operation'],
  result: GenerationResult,
) {
  if (operation === 'seeding') {
    return `${(result.totalSeedAmount ?? 0).toFixed(2)} ${(
      result.units ?? 'kg/ha'
    ).replace('/ha', '')}`
  }

  if (operation === 'fertilizing') {
    return `${(result.totalFertilizerKg ?? 0).toFixed(2)} kg`
  }

  if (operation === 'spraying') {
    return `${(result.totalMixtureLiters ?? 0).toFixed(2)} L mix, ${(
      result.totalChemicalGrams ?? 0
    ).toFixed(2)} g chemical`
  }

  return 'Length and area only'
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const loaded = loadCurrentTask()
  const [importHistory, setImportHistory] = useState<ImportedFileRecord[]>(loadHistory)
  const [loadedTaskData, setLoadedTaskData] = useState<TaskDataModel | null>(loaded.task)
  const [currentFileName, setCurrentFileName] = useState<string | null>(loaded.fileName)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    loaded.task?.fields[0]?.id ?? null,
  )
  const [editorMode, setEditorMode] = useState<EditorMode>('view')
  const [draftCreate, setDraftCreate] = useState<DraftCreateState>(emptyDraft)
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(
    null,
  )
  const [dataVersion, setDataVersion] = useState(0)

  const persistTask = (task: TaskDataModel | null, name: string | null) => {
    upsertTask(
      task,
      name,
      setLoadedTaskData,
      setCurrentFileName,
      setImportHistory,
      importHistory,
    )
    setDataVersion((prev) => prev + 1)
  }

  const importAny = async (file: File) => {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      let parsed: TaskDataModel

      if (ext === 'xml' || ext === 'isoxml') {
        try {
          parsed = await parseTaskDataXmlFile(file)
        } catch {
          const result = await parseImportedFile(file)
          parsed = importResultToTaskData(result, file.name)
        }
      } else {
        const result = await parseImportedFile(file)
        parsed = importResultToTaskData(result, file.name)
      }

      const record: ImportedFileRecord = {
        id: uid(),
        originalFileName: file.name,
        cachedFileName: file.name,
        importDate: new Date().toISOString(),
        snapshot: cloneTaskData(parsed),
      }

      const nextHistory = [
        record,
        ...importHistory.filter((item) => item.originalFileName !== file.name),
      ]

      setImportHistory(nextHistory)
      saveHistory(nextHistory)
      setLoadedTaskData(parsed)
      setCurrentFileName(file.name)
      saveCurrentTask(parsed, file.name)
      setSelectedFieldId(parsed.fields[0]?.id ?? null)
      setEditorMode('view')
      setDraftCreate(emptyDraft())
      setGenerationResult(null)
      setErrorMessage(null)
      setDataVersion((prev) => prev + 1)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Import failed')
    }
  }

  const openHistoryItem = (recordId: string) => {
    const found = importHistory.find((record) => record.id === recordId)
    if (!found?.snapshot) return

    setLoadedTaskData(cloneTaskData(found.snapshot))
    setCurrentFileName(found.originalFileName)
    saveCurrentTask(found.snapshot, found.originalFileName)
    setSelectedFieldId(found.snapshot.fields[0]?.id ?? null)
    setErrorMessage(null)
    setDataVersion((prev) => prev + 1)
  }

  const deleteHistoryItem = (recordId: string) => {
    const next = importHistory.filter((record) => record.id !== recordId)
    setImportHistory(next)
    saveHistory(next)
    setDataVersion((prev) => prev + 1)
  }

  const createEmptyMap = () => {
    const next: TaskDataModel = { client: null, farm: null, fields: [] }
    setLoadedTaskData(next)
    setCurrentFileName('New Map.xml')
    saveCurrentTask(next, 'New Map.xml')
    setSelectedFieldId(null)
    setDataVersion((prev) => prev + 1)
  }

  const saveCurrentTaskData = () => {
    if (!loadedTaskData) {
      setErrorMessage('No data to save.')
      return false
    }

    persistTask(loadedTaskData, currentFileName)
    return true
  }

  const exportCurrent = async (format: ExportFormat) => {
    if (!loadedTaskData) {
      setErrorMessage('No data to export.')
      return
    }

    try {
      await exportTaskData(loadedTaskData, currentFileName ?? 'TaskData', format)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Export failed')
    }
  }

  const startCreateNewField = (
    fieldName = 'Field',
    guidanceName = 'Guidance 1',
  ) => {
    setDraftCreate({
      target: 'newField',
      targetFieldId: null,
      fieldName,
      guidanceName,
      boundaryPoints: [],
      guidancePoints: [],
    })
    setEditorMode('drawField')
  }

  const startCreateGuidanceForField = (
    fieldId: string,
    guidanceName = 'Guidance 1',
  ) => {
    const field = loadedTaskData?.fields.find((item) => item.id === fieldId)
    setSelectedFieldId(fieldId)
    setDraftCreate({
      target: 'existingField',
      targetFieldId: fieldId,
      fieldName: field?.name ?? 'Field',
      guidanceName,
      boundaryPoints: [],
      guidancePoints: [],
    })
    setEditorMode('drawGuidance')
  }

  const setDraftFieldName = (value: string) =>
    setDraftCreate((prev) => ({ ...prev, fieldName: value }))

  const setDraftGuidanceName = (value: string) =>
    setDraftCreate((prev) => ({ ...prev, guidanceName: value }))

  const addDraftBoundaryPoint = (lat: number, lon: number) =>
    setDraftCreate((prev) => ({
      ...prev,
      boundaryPoints: [
        ...prev.boundaryPoints,
        { id: uid(), latitude: lat, longitude: lon },
      ],
    }))

  const addDraftGuidancePoint = (lat: number, lon: number) =>
    setDraftCreate((prev) => ({
      ...prev,
      guidancePoints: [
        ...prev.guidancePoints,
        { id: uid(), latitude: lat, longitude: lon },
      ],
    }))

  const clearDraft = () => {
    setDraftCreate(emptyDraft())
    setEditorMode('view')
  }

  const commitDraftCreate = () => {
    if (!loadedTaskData) {
      setErrorMessage('Import a file or create a new map first.')
      return false
    }

    if (draftCreate.target === 'newField') {
      if (draftCreate.boundaryPoints.length < 3) {
        setErrorMessage('A new boundary needs at least 3 points.')
        return false
      }

      if (draftCreate.guidancePoints.length < 2) {
        setErrorMessage('A new guidance line needs at least 2 points.')
        return false
      }

      const field: FieldModel = {
        id: uid(),
        name: draftCreate.fieldName.trim() || `Field ${loadedTaskData.fields.length + 1}`,
        clientId: loadedTaskData.client?.id,
        farmId: loadedTaskData.farm?.id,
        boundaries: [{ id: uid(), points: draftCreate.boundaryPoints }],
        guidanceLines: [
          {
            id: uid(),
            name: draftCreate.guidanceName.trim() || 'Guidance 1',
            points: draftCreate.guidancePoints,
          },
        ],
      }

      const next = { ...loadedTaskData, fields: [...loadedTaskData.fields, field] }
      persistTask(next, currentFileName)
      setSelectedFieldId(field.id)
      clearDraft()
      return true
    }

    if (draftCreate.target === 'existingField' && draftCreate.targetFieldId) {
      if (draftCreate.guidancePoints.length < 2) {
        setErrorMessage('A guidance line needs at least 2 points.')
        return false
      }

      const next: TaskDataModel = {
        ...loadedTaskData,
        fields: loadedTaskData.fields.map((field) =>
          field.id !== draftCreate.targetFieldId
            ? field
            : {
                ...field,
                guidanceLines: [
                  ...field.guidanceLines,
                  {
                    id: uid(),
                    name:
                      draftCreate.guidanceName.trim() ||
                      `Guidance ${field.guidanceLines.length + 1}`,
                    points: draftCreate.guidancePoints,
                  },
                ],
              },
        ),
      }

      persistTask(next, currentFileName)
      clearDraft()
      return true
    }

    return false
  }

  const patchFields = (patcher: (fields: FieldModel[]) => FieldModel[]) => {
    if (!loadedTaskData) return
    const next = { ...loadedTaskData, fields: patcher(loadedTaskData.fields) }
    persistTask(next, currentFileName)
  }

  const updateFieldName = (fieldId: string, name: string) =>
    patchFields((fields) =>
      fields.map((field) => (field.id === fieldId ? { ...field, name } : field)),
    )

  const deleteField = (fieldId: string) => {
    patchFields((fields) => fields.filter((field) => field.id !== fieldId))

    if (selectedFieldId === fieldId) setSelectedFieldId(null)
    setGenerationResult((prev) => (prev && selectedFieldId === fieldId ? null : prev))
  }

  const deleteBoundary = (fieldId: string, boundaryId: string) =>
    patchFields((fields) =>
      fields.map((field) =>
        field.id !== fieldId
          ? field
          : {
              ...field,
              boundaries: field.boundaries.filter(
                (boundary) => boundary.id !== boundaryId,
              ),
            },
      ),
    )

  const deleteGuidance = (fieldId: string, guidanceId: string) =>
    patchFields((fields) =>
      fields.map((field) =>
        field.id !== fieldId
          ? field
          : {
              ...field,
              guidanceLines: field.guidanceLines.filter(
                (line) => line.id !== guidanceId,
              ),
            },
      ),
    )

  const updateBoundaryPoint = (
    fieldId: string,
    boundaryId: string,
    pointId: string,
    lat: number,
    lon: number,
  ) =>
    patchFields((fields) =>
      fields.map((field) =>
        field.id !== fieldId
          ? field
          : {
              ...field,
              boundaries: field.boundaries.map((boundary) =>
                boundary.id !== boundaryId
                  ? boundary
                  : {
                      ...boundary,
                      points: boundary.points.map((point) =>
                        point.id !== pointId
                          ? point
                          : { ...point, latitude: lat, longitude: lon },
                      ),
                    },
              ),
            },
      ),
    )

  const addBoundaryPoint = (fieldId: string, boundaryId: string) =>
    patchFields((fields) =>
      fields.map((field) => {
        if (field.id !== fieldId) return field

        return {
          ...field,
          boundaries: field.boundaries.map((boundary) => {
            if (boundary.id !== boundaryId) return boundary

            const last =
              boundary.points[boundary.points.length - 1] ?? {
                latitude: 0,
                longitude: 0,
              }

            return {
              ...boundary,
              points: [
                ...boundary.points,
                { id: uid(), latitude: last.latitude, longitude: last.longitude },
              ],
            }
          }),
        }
      }),
    )

  const deleteBoundaryPoint = (
    fieldId: string,
    boundaryId: string,
    pointId: string,
  ) =>
    patchFields((fields) =>
      fields.map((field) =>
        field.id !== fieldId
          ? field
          : {
              ...field,
              boundaries: field.boundaries.map((boundary) =>
                boundary.id !== boundaryId
                  ? boundary
                  : {
                      ...boundary,
                      points: boundary.points.filter((point) => point.id !== pointId),
                    },
              ),
            },
      ),
    )

  const updateGuidanceName = (
    fieldId: string,
    guidanceId: string,
    name: string,
  ) =>
    patchFields((fields) =>
      fields.map((field) =>
        field.id !== fieldId
          ? field
          : {
              ...field,
              guidanceLines: field.guidanceLines.map((line) =>
                line.id !== guidanceId ? line : { ...line, name },
              ),
            },
      ),
    )

  const updateGuidancePoint = (
    fieldId: string,
    guidanceId: string,
    pointId: string,
    lat: number,
    lon: number,
  ) =>
    patchFields((fields) =>
      fields.map((field) =>
        field.id !== fieldId
          ? field
          : {
              ...field,
              guidanceLines: field.guidanceLines.map((line) =>
                line.id !== guidanceId
                  ? line
                  : {
                      ...line,
                      points: line.points.map((point) =>
                        point.id !== pointId
                          ? point
                          : { ...point, latitude: lat, longitude: lon },
                      ),
                    },
              ),
            },
      ),
    )

  const addGuidancePoint = (fieldId: string, guidanceId: string) =>
    patchFields((fields) =>
      fields.map((field) => {
        if (field.id !== fieldId) return field

        return {
          ...field,
          guidanceLines: field.guidanceLines.map((line) => {
            if (line.id !== guidanceId) return line

            const last =
              line.points[line.points.length - 1] ?? {
                latitude: 0,
                longitude: 0,
              }

            return {
              ...line,
              points: [
                ...line.points,
                { id: uid(), latitude: last.latitude, longitude: last.longitude },
              ],
            }
          }),
        }
      }),
    )

  const generateLines = (input: GenerationInput) => {
    if (!loadedTaskData) return false

    if (!Number.isFinite(input.width) || input.width <= 0) {
      setErrorMessage('Working width must be greater than 0.')
      return false
    }

    if (
      input.operation === 'seeding' &&
      (!Number.isFinite(input.rate) || (input.rate ?? 0) <= 0)
    ) {
      setErrorMessage('For Seeding, rate must be greater than 0.')
      return false
    }

    if (
      input.operation === 'fertilizing' &&
      (!Number.isFinite(input.rate) || (input.rate ?? 0) <= 0)
    ) {
      setErrorMessage('For Fertilizing, kg/ha must be greater than 0.')
      return false
    }

    if (input.operation === 'spraying') {
      if (!Number.isFinite(input.mixtureRate) || (input.mixtureRate ?? 0) <= 0) {
        setErrorMessage('For Spraying, mixture rate must be greater than 0.')
        return false
      }

      if (!Number.isFinite(input.chemicalRate) || (input.chemicalRate ?? 0) <= 0) {
        setErrorMessage('For Spraying, chemical rate must be greater than 0.')
        return false
      }
    }

    const field = loadedTaskData.fields.find((item) => item.id === input.fieldId)
    if (!field) {
      setErrorMessage('Select a field for generation.')
      return false
    }

    const baseGuidanceLine =
      field.guidanceLines.find((line) => !line.id.startsWith('generated-')) ??
      field.guidanceLines[0]

    if (!baseGuidanceLine || baseGuidanceLine.points.length < 2) {
      setErrorMessage('Selected field does not have a valid guidance line.')
      return false
    }

    const operationMap: Record<
      GenerationInput['operation'],
      'Seeding' | 'Fertilizing' | 'Spraying' | 'Others'
    > = {
      seeding: 'Seeding',
      fertilizing: 'Fertilizing',
      spraying: 'Spraying',
      others: 'Others',
    }

    const generated = generateLinesForAllBoundaries({
      field,
      baseGuidanceLine,
      implementWidthMeters: input.width,
      operation: operationMap[input.operation],
      seedRate: input.operation === 'seeding' ? input.rate : undefined,
      seedUnit:
        input.operation === 'seeding'
          ? ((input.units === 'TK/ha' ? 'TK/ha' : 'kg/ha') as 'kg/ha' | 'TK/ha')
          : undefined,
      fertilizerRate: input.operation === 'fertilizing' ? input.rate : undefined,
      sprayMixRate: input.operation === 'spraying' ? input.mixtureRate : undefined,
      sprayChemicalRate:
        input.operation === 'spraying' ? input.chemicalRate : undefined,
    })

    if (!generated.length) {
      setErrorMessage('Unable to generate lines inside the field boundary.')
      return false
    }

    const generatedGuidanceLines: GuidanceLine[] = generated.map((line, index) => ({
      id: `generated-${field.id}-${index + 1}`,
      name: `${line.lineNumber > 0 ? `+${line.lineNumber}` : line.lineNumber}`,
      points: line.points,
    }))

    const metrics: GeneratedLineMetric[] = generated
      .map((line, index) => buildLineMetric(line, input, index))
      .sort((a, b) => a.lineIndex - b.lineIndex)

    const result: GenerationResult = {
      operation: input.operation,
      widthMeters: input.width,
      crop: input.crop,
      units: input.units,
      lines: metrics,
      totalLines: metrics.length,
      totalLengthMeters: metrics.reduce((sum, item) => sum + item.lengthMeters, 0),
      totalAreaHectares: metrics.reduce((sum, item) => sum + item.areaHectares, 0),
      totalSeedAmount: metrics.reduce((sum, item) => sum + (item.seedAmount ?? 0), 0),
      totalFertilizerKg: metrics.reduce(
        (sum, item) => sum + (item.fertilizerKg ?? 0),
        0,
      ),
      totalMixtureLiters: metrics.reduce(
        (sum, item) => sum + (item.mixtureLiters ?? 0),
        0,
      ),
      totalChemicalGrams: metrics.reduce(
        (sum, item) => sum + (item.chemicalGrams ?? 0),
        0,
      ),
      totalMaterialSummary: '',
    }

    result.totalMaterialSummary = totalMaterialSummary(input.operation, result)

    const next: TaskDataModel = {
      ...loadedTaskData,
      fields: loadedTaskData.fields.map((item) =>
        item.id !== field.id
          ? item
          : {
              ...item,
              guidanceLines: [
                ...item.guidanceLines.filter((line) => !line.id.startsWith('generated-')),
                ...generatedGuidanceLines,
              ],
            },
      ),
    }

    persistTask(next, currentFileName)
    setGenerationResult(result)
    setSelectedFieldId(field.id)
    setErrorMessage(null)
    return true
  }

  const clearGenerationResult = () => {
    setGenerationResult(null)
    if (!loadedTaskData) return

    const next: TaskDataModel = {
      ...loadedTaskData,
      fields: loadedTaskData.fields.map((field) => ({
        ...field,
        guidanceLines: field.guidanceLines.filter(
          (line) => !line.id.startsWith('generated-'),
        ),
      })),
    }

    persistTask(next, currentFileName)
  }

  const value = useMemo<AppStoreValue>(
    () => ({
      importHistory,
      loadedTaskData,
      currentFileName,
      errorMessage,
      selectedFieldId,
      editorMode,
      draftCreate,
      generationResult,
      dataVersion,
      importAny,
      setErrorMessage,
      setSelectedFieldId,
      setEditorMode,
      openHistoryItem,
      deleteHistoryItem,
      createEmptyMap,
      saveCurrentTaskData,
      exportCurrent,
      startCreateNewField,
      startCreateGuidanceForField,
      setDraftFieldName,
      setDraftGuidanceName,
      addDraftBoundaryPoint,
      addDraftGuidancePoint,
      clearDraft,
      commitDraftCreate,
      updateFieldName,
      deleteField,
      deleteBoundary,
      deleteGuidance,
      updateBoundaryPoint,
      addBoundaryPoint,
      deleteBoundaryPoint,
      updateGuidanceName,
      updateGuidancePoint,
      addGuidancePoint,
      generateLines,
      clearGenerationResult,
    }),
    [
      importHistory,
      loadedTaskData,
      currentFileName,
      errorMessage,
      selectedFieldId,
      editorMode,
      draftCreate,
      generationResult,
      dataVersion,
    ],
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore() {
  const ctx = useContext(AppStoreContext)
  if (!ctx) {
    throw new Error('useAppStore must be used inside AppStoreProvider')
  }
  return ctx
}