import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useFarm, type FarmSummary, type FarmZone } from '../farms/FarmContext'
import { useAppStore } from '../store/appStore'
import { apiRequest } from '../services/api'
import { cloneField, type TaskDataModel } from '../models/taskData'
import HomePage from './HomePage'
import CreateFieldPage from './CreateFieldPage'
import EditFieldPage from './EditFieldPage'
import GenerateLinesPage from './GenerateLinesPage'
import ExportPage from './ExportPage'
import AdminAccessPanel from '../components/AdminAccessPanel'
import ProjectFilesPanel from '../components/ProjectFilesPanel'

const PivotTrackPage = lazy(() => import('./PivotTrackPage'))
const GrainBunkerPage = lazy(() => import('./GrainBunkerPage'))
const PlantingPage = lazy(() => import('./PlantingPage'))
const FieldsLayersPage = lazy(() => import('./FieldsLayersPage'))
const RouteBuilderPage = lazy(() => import('./RouteBuilderPage'))

type WorkspaceTool =
  | 'overview'
  | 'files'
  | 'fields'
  | 'create'
  | 'edit'
  | 'generate'
  | 'planting'
  | 'routes'
  | 'pivot'
  | 'bunker'
  | 'export'
  | 'access'

type ProjectSummaryRaw = {
  id: string
  name: string
  file_name?: string | null
  fileName?: string | null
  updated_at?: string
  updatedAt?: string
  file_count?: number
  fileCount?: number
}

type ProjectSummary = {
  id: string
  name: string
  fileName: string | null
  updatedAt: string
  fileCount: number
}

type ProjectDetail = {
  id: string
  name: string
  farmId: string | null
  fileName: string | null
  projectData: TaskDataModel | null
}

type PendingImport = {
  file: File
  data: TaskDataModel
  mode: 'new-farm' | 'current-farm'
  farmName: string
  strategy: 'overlay' | 'replace-overlaps'
}

const tools: Array<{
  id: WorkspaceTool
  label: string
  icon: string
  description: string
  zone: FarmZone
}> = [
  { id: 'overview', label: 'Maps', icon: '⌖', description: 'Map tools and planting', zone: 'maps' },
  { id: 'fields', label: 'Fields', icon: '▣', description: 'Fields and map layers', zone: 'maps' },
  { id: 'pivot', label: 'Pivot', icon: '◉', description: 'Irrigation frame', zone: 'pivot' },
  { id: 'bunker', label: 'Bunker', icon: '▱', description: 'Grain tank', zone: 'bunker' },
  { id: 'export', label: 'Export', icon: '⇩', description: 'Machine formats', zone: 'export' },
  { id: 'access', label: 'Access', icon: '◎', description: 'Users and permissions', zone: 'access' },
]

const mapTools: Array<{
  id: WorkspaceTool
  label: string
  icon: string
  description: string
  manageOnly?: boolean
}> = [
  { id: 'overview', label: 'Map overview', icon: '⌖', description: 'Fields and guidance' },
  { id: 'create', label: 'Create', icon: '+', description: 'Field or guidance', manageOnly: true },
  { id: 'edit', label: 'Edit', icon: '✦', description: 'Geometry and names', manageOnly: true },
  { id: 'generate', label: 'Lines', icon: '≋', description: 'Parallel guidance', manageOnly: true },
  { id: 'planting', label: 'Planting', icon: '⁙', description: 'Pass, seeds and yield', manageOnly: true },
  { id: 'routes', label: 'Routes', icon: '⌁', description: 'Machine trajectory builder', manageOnly: true },
]

const mapToolIds = new Set<WorkspaceTool>(mapTools.map((tool) => tool.id))

function normalizeProject(project: ProjectSummaryRaw): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    fileName: project.fileName ?? project.file_name ?? null,
    updatedAt: project.updatedAt ?? project.updated_at ?? '',
    fileCount: Number(project.fileCount ?? project.file_count ?? 0),
  }
}

function nameFromFile(fileName: string | null) {
  if (!fileName) return 'Farm workspace'
  return fileName.replace(/\.[^.]+$/, '') || fileName
}

function suggestedFarmName(file: File, task: TaskDataModel) {
  const sourceName = task.farm?.name?.trim()
  return sourceName || nameFromFile(file.name)
}

function scopeTaskToFarm(task: TaskDataModel, farm: FarmSummary): TaskDataModel {
  return {
    ...task,
    farm: { id: farm.id, name: farm.name, clientId: task.client?.id },
    fields: task.fields.map((field) => ({ ...field, farmId: farm.id })),
  }
}

function mergeTaskData(
  current: TaskDataModel | null,
  incoming: TaskDataModel,
  farm: FarmSummary,
  strategy: PendingImport['strategy'],
): TaskDataModel {
  const scoped = scopeTaskToFarm(incoming, farm)
  if (!current) return scoped

  const retainedFields = strategy === 'replace-overlaps'
    ? current.fields.filter((existing) =>
        !scoped.fields.some((candidate) => fieldsOverlap(existing, candidate)),
      )
    : current.fields
  const names = new Set(retainedFields.map((field) => field.name.trim().toLowerCase()))
  const addedFields = scoped.fields.map((field) => cloneField(field, names))
  const mapLayers = [...(current.tools?.mapLayers ?? []), ...(scoped.tools?.mapLayers ?? [])]
    .filter((layer, index, all) => all.findIndex((candidate) => candidate.id === layer.id) === index)
  const routes = [...(current.tools?.routes ?? []), ...(scoped.tools?.routes ?? [])]
    .filter((route, index, all) => all.findIndex((candidate) => candidate.id === route.id) === index)

  return {
    ...current,
    farm: { id: farm.id, name: farm.name, clientId: current.client?.id },
    client: current.client ?? scoped.client,
    fields: [...retainedFields, ...addedFields],
    tools: {
      ...current.tools,
      ...scoped.tools,
      pivotTracks: { ...current.tools?.pivotTracks, ...scoped.tools?.pivotTracks },
      plantingPlans: { ...current.tools?.plantingPlans, ...scoped.tools?.plantingPlans },
      mapLayers,
      routes,
    },
  }
}

type Bounds = { minLat: number; minLon: number; maxLat: number; maxLon: number }

function fieldBounds(field: TaskDataModel['fields'][number]): Bounds | null {
  const points = field.boundaries.flatMap((boundary) => boundary.points)
  if (!points.length) return null
  return {
    minLat: Math.min(...points.map((point) => point.latitude)),
    minLon: Math.min(...points.map((point) => point.longitude)),
    maxLat: Math.max(...points.map((point) => point.latitude)),
    maxLon: Math.max(...points.map((point) => point.longitude)),
  }
}

function boundsIntersect(a: Bounds, b: Bounds) {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat
    && a.minLon <= b.maxLon && a.maxLon >= b.minLon
}

function pointInRing(
  point: { latitude: number; longitude: number },
  ring: Array<{ latitude: number; longitude: number }>,
) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index]
    const previousPoint = ring[previous]
    const crosses = (currentPoint.latitude > point.latitude) !== (previousPoint.latitude > point.latitude)
      && point.longitude < (
        (previousPoint.longitude - currentPoint.longitude)
        * (point.latitude - currentPoint.latitude)
        / ((previousPoint.latitude - currentPoint.latitude) || Number.EPSILON)
        + currentPoint.longitude
      )
    if (crosses) inside = !inside
  }
  return inside
}

function orientation(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  c: { latitude: number; longitude: number },
) {
  const cross = (b.longitude - a.longitude) * (c.latitude - a.latitude)
    - (b.latitude - a.latitude) * (c.longitude - a.longitude)
  if (Math.abs(cross) < 1e-12) return 0
  return cross > 0 ? 1 : -1
}

function onSegment(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  point: { latitude: number; longitude: number },
) {
  return point.longitude >= Math.min(a.longitude, b.longitude) - 1e-12
    && point.longitude <= Math.max(a.longitude, b.longitude) + 1e-12
    && point.latitude >= Math.min(a.latitude, b.latitude) - 1e-12
    && point.latitude <= Math.max(a.latitude, b.latitude) + 1e-12
}

function segmentsIntersect(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  c: { latitude: number; longitude: number },
  d: { latitude: number; longitude: number },
) {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  if (abC !== abD && cdA !== cdB) return true
  return (abC === 0 && onSegment(a, b, c))
    || (abD === 0 && onSegment(a, b, d))
    || (cdA === 0 && onSegment(c, d, a))
    || (cdB === 0 && onSegment(c, d, b))
}

function ringsIntersect(
  first: Array<{ latitude: number; longitude: number }>,
  second: Array<{ latitude: number; longitude: number }>,
) {
  if (first.length < 2 || second.length < 2) return false
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % first.length
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % second.length
      if (segmentsIntersect(
        first[firstIndex],
        first[firstNext],
        second[secondIndex],
        second[secondNext],
      )) return true
    }
  }
  return false
}

function fieldsOverlap(
  existing: TaskDataModel['fields'][number],
  candidate: TaskDataModel['fields'][number],
) {
  if (existing.name.trim().toLowerCase() === candidate.name.trim().toLowerCase()) return true
  const existingBounds = fieldBounds(existing)
  const candidateBounds = fieldBounds(candidate)
  if (!existingBounds || !candidateBounds || !boundsIntersect(existingBounds, candidateBounds)) {
    return false
  }

  return existing.boundaries.some((existingBoundary) =>
    candidate.boundaries.some((candidateBoundary) =>
      existingBoundary.points.some((point) => pointInRing(point, candidateBoundary.points))
      || candidateBoundary.points.some((point) => pointInRing(point, existingBoundary.points))
      || ringsIntersect(existingBoundary.points, candidateBoundary.points),
    ),
  )
}


async function sha256File(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function formatSaveState(state: 'idle' | 'saving' | 'saved' | 'error') {
  if (state === 'saving') return 'Saving…'
  if (state === 'saved') return 'Saved'
  if (state === 'error') return 'Save failed'
  return 'Cloud sync'
}

export default function WorkspacePage() {
  const { user, logout } = useAuth()
  const {
    farms,
    activeFarm,
    permissions,
    loading: loadingFarms,
    error: farmError,
    createFarm,
    switchFarm,
  } = useFarm()
  const {
    loadedTaskData,
    currentFileName,
    parseAny,
    loadTaskData,
    clearTaskData,
    createEmptyMap,
    errorMessage,
    setErrorMessage,
    dataVersion,
    canUndo,
    undoLastChange,
  } = useAppStore()

  const isAdmin = user?.role === 'admin'
  const canManage = isAdmin || activeFarm?.role === 'editor'
  const canManageMaps = Boolean(canManage && permissions.maps)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const projectLoadRef = useRef(0)
  const suppressFarmReloadRef = useRef<string | null>(null)

  const [activeTool, setActiveTool] = useState<WorkspaceTool>('overview')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [dismissedNotifications, setDismissedNotifications] = useState<string[]>([])
  const [mapMenuOpen, setMapMenuOpen] = useState(false)
  const [newFarmName, setNewFarmName] = useState('')
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const saveZone: Exclude<FarmZone, 'access'> | null = activeTool === 'pivot'
    ? 'pivot'
    : activeTool === 'bunker'
      ? 'bunker'
      : activeTool === 'fields' || mapToolIds.has(activeTool)
        ? 'maps'
        : null
  const canSaveActiveZone = Boolean(canManage && saveZone && permissions[saveZone])
  const notifications = [
    errorMessage ? { id: `app-error:${errorMessage}`, tone: 'error', message: errorMessage } : null,
    farmError ? { id: `farm-error:${farmError}`, tone: 'error', message: farmError } : null,
    statusMessage ? { id: `status:${statusMessage}`, tone: 'info', message: statusMessage } : null,
  ].filter((item): item is { id: string; tone: string; message: string } =>
    Boolean(item && !dismissedNotifications.includes(item.id)),
  )

  const allowedTools = useMemo(() => {
    const allowed = new Set<WorkspaceTool>()
    if (permissions.maps) {
      allowed.add('overview')
      allowed.add('files')
      allowed.add('fields')
      if (canManageMaps) {
        allowed.add('create')
        allowed.add('edit')
        allowed.add('generate')
        allowed.add('planting')
        allowed.add('routes')
      }
    }
    if (permissions.pivot) allowed.add('pivot')
    if (permissions.bunker) allowed.add('bunker')
    if (permissions.export) allowed.add('export')
    if (isAdmin) allowed.add('access')
    return allowed
  }, [permissions, canManageMaps, isAdmin])

  useEffect(() => {
    if (allowedTools.has(activeTool)) return
    const fallback = (['overview', 'pivot', 'bunker', 'export', 'access'] as WorkspaceTool[])
      .find((tool) => allowedTools.has(tool))
    if (!fallback) return
    const timer = window.setTimeout(() => setActiveTool(fallback), 0)
    return () => window.clearTimeout(timer)
  }, [activeTool, allowedTools])

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  const loadProjects = async (farmId: string) => {
    const response = await apiRequest<{ projects: ProjectSummaryRaw[] }>(
      `/api/projects?farmId=${encodeURIComponent(farmId)}`,
    )
    const next = response.projects.map(normalizeProject)
    setProjects(next)
    return next
  }

  const openFarmWorkspace = async (farm: FarmSummary, farmProjects: ProjectSummary[]) => {
    if (!farmProjects.length) return
    const requestId = ++projectLoadRef.current
    setLoadingProjects(true)
    try {
      const details = await Promise.all(
        [...farmProjects].reverse().map((project) =>
          apiRequest<{ project: ProjectDetail }>(`/api/projects/${project.id}`),
        ),
      )
      if (requestId !== projectLoadRef.current) return

      let combined: TaskDataModel | null = null
      for (const response of details) {
        if (!response.project.projectData) continue
        combined = mergeTaskData(combined, response.project.projectData, farm, 'overlay')
      }
      if (!combined) throw new Error('This farm workspace has no map data.')

      const canonical = farmProjects[0]
      setActiveProjectId(canonical.id)
      loadTaskData(combined, canonical.fileName)
      setStatusMessage(null)
      setSaveState('idle')

      if (farmProjects.length > 1 && canManageMaps) {
        await apiRequest(`/api/projects/${canonical.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: farm.name,
            fileName: canonical.fileName,
            projectData: combined,
            zone: 'maps',
            mergeProjectIds: farmProjects.slice(1).map((project) => project.id),
          }),
        })
        const consolidated = await loadProjects(farm.id)
        setProjects(consolidated)
        setStatusMessage(
          `${farmProjects.length} farm workspaces were safely combined. All fields and source files are now shown together.`,
        )
        setSaveState('saved')
      }
    } catch (error) {
      if (requestId === projectLoadRef.current) {
        setStatusMessage(error instanceof Error ? error.message : 'Unable to open farm workspace.')
        clearTaskData()
        setActiveProjectId(null)
      }
    } finally {
      if (requestId === projectLoadRef.current) setLoadingProjects(false)
    }
  }

  useEffect(() => {
    if (activeFarm && suppressFarmReloadRef.current === activeFarm.id) {
      suppressFarmReloadRef.current = null
      return
    }

    if (!activeFarm) {
      setProjects([])
      setActiveProjectId(null)
      clearTaskData()
      return
    }

    let cancelled = false
    setLoadingProjects(true)
    setActiveTool('overview')
    setActiveProjectId(null)
    clearTaskData()

    loadProjects(activeFarm.id)
      .then(async (next) => {
        if (cancelled) return
        if (next[0]) await openFarmWorkspace(activeFarm, next)
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : 'Unable to load farm data.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false)
      })

    return () => {
      cancelled = true
      projectLoadRef.current += 1
    }
  }, [activeFarm?.id])

  useEffect(() => {
    if (!canSaveActiveZone || !saveZone || !activeProjectId || !loadedTaskData || busy) return

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    setSaveState('saving')

    saveTimerRef.current = window.setTimeout(() => {
      void apiRequest(`/api/projects/${activeProjectId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: activeFarm?.name ?? activeProject?.name ?? 'Farm workspace',
          fileName: currentFileName,
          projectData: loadedTaskData,
          zone: saveZone,
        }),
      })
        .then(() => setSaveState('saved'))
        .catch((error) => {
          setSaveState('error')
          setStatusMessage(error instanceof Error ? error.message : 'Automatic save failed.')
        })
    }, 900)

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [dataVersion, activeProjectId, canSaveActiveZone, saveZone])

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !canManageMaps) return

    setBusy(true)
    setStatusMessage('Reading the imported file…')
    setErrorMessage(null)
    try {
      const data = await parseAny(file)
      setPendingImport({
        file,
        data,
        mode: activeFarm ? 'current-farm' : 'new-farm',
        farmName: suggestedFarmName(file, data),
        strategy: 'overlay',
      })
      setStatusMessage(null)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to read imported file.')
    } finally {
      setBusy(false)
    }
  }

  const uploadSourceFile = async (file: File, farmId: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('farmId', farmId)
    return apiRequest<{ file: { id: string } }>('/api/files', {
      method: 'POST',
      body: formData,
    })
  }

  const commitImport = async () => {
    if (!pendingImport || !canManageMaps) return

    let uploadedFileId: string | null = null
    setBusy(true)
    setStatusMessage('Checking the imported file…')
    try {
      let targetFarm = activeFarm
      if (pendingImport.mode === 'new-farm') {
        const farmName = pendingImport.farmName.trim()
        if (!farmName) throw new Error('Farm name is required.')
        targetFarm = await createFarm(farmName)
        suppressFarmReloadRef.current = targetFarm.id
      }
      if (!targetFarm) throw new Error('Select or create a farm first.')

      const fileHash = await sha256File(pendingImport.file)
      const duplicateCheck = await apiRequest<{
        duplicate: boolean
        import: { originalName: string; importedFields: number; completedAt: string } | null
      }>(
        `/api/farms/${targetFarm.id}/imports?fileHash=${encodeURIComponent(fileHash)}`,
      )

      if (duplicateCheck.duplicate) {
        const importedAt = duplicateCheck.import?.completedAt
          ? new Date(duplicateCheck.import.completedAt).toLocaleString('en-GB')
          : 'an earlier date'
        setStatusMessage(
          `This file was imported on ${importedAt}. Restoring it with the selected merge option…`,
        )
      }

      setStatusMessage('Uploading the source file…')
      const upload = await uploadSourceFile(pendingImport.file, targetFarm.id)
      uploadedFileId = upload.file.id
      const isCurrentFarm = activeFarm?.id === targetFarm.id
      const existingProjectId = isCurrentFarm
        ? (activeProjectId ?? projects[0]?.id ?? null)
        : null
      const serverTask = existingProjectId
        ? (await apiRequest<{ project: ProjectDetail }>(`/api/projects/${existingProjectId}`)).project.projectData
        : null
      const currentTask = serverTask && loadedTaskData && isCurrentFarm
        ? mergeTaskData(serverTask, loadedTaskData, targetFarm, 'replace-overlaps')
        : serverTask ?? loadedTaskData
      const nextTask = existingProjectId
        ? mergeTaskData(currentTask, pendingImport.data, targetFarm, pendingImport.strategy)
        : scopeTaskToFarm(pendingImport.data, targetFarm)

      if (existingProjectId) {
        await apiRequest(`/api/projects/${existingProjectId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: targetFarm.name,
            fileName: currentFileName ?? pendingImport.file.name,
            projectData: nextTask,
            fileId: upload.file.id,
          }),
        })
        await apiRequest(`/api/projects/${existingProjectId}/files`, {
          method: 'POST',
          body: JSON.stringify({ fileId: upload.file.id }),
        })
        loadTaskData(nextTask, currentFileName ?? pendingImport.file.name)
        setActiveProjectId(existingProjectId)
      } else {
        const created = await apiRequest<{ id: string }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify({
            farmId: targetFarm.id,
            name: targetFarm.name,
            fileName: pendingImport.file.name,
            projectData: nextTask,
            fileId: upload.file.id,
          }),
        })
        const nextProjects = await loadProjects(targetFarm.id)
        setProjects(nextProjects)
        setActiveProjectId(created.id)
        loadTaskData(nextTask, pendingImport.file.name)
      }

      await apiRequest(`/api/farms/${targetFarm.id}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceFileId: upload.file.id,
          originalName: pendingImport.file.name,
          fileHash,
          importType: pendingImport.file.name.split('.').pop() ?? 'unknown',
          detectedFields: pendingImport.data.fields.length,
          importedFields: pendingImport.data.fields.length,
        }),
      })

      setPendingImport(null)
      setActiveTool('overview')
      setSaveState('saved')
      setStatusMessage(
        pendingImport.mode === 'new-farm'
          ? `Farm “${targetFarm.name}” created.`
          : `${pendingImport.data.fields.length} field${pendingImport.data.fields.length === 1 ? '' : 's'} added to ${targetFarm.name}.`,
      )
    } catch (error) {
      if (uploadedFileId) {
        await apiRequest(`/api/files/${uploadedFileId}`, { method: 'DELETE' }).catch(() => undefined)
      }
      setStatusMessage(error instanceof Error ? error.message : 'Unable to import farm data.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateFarm = async () => {
    const name = newFarmName.trim()
    if (!name || !isAdmin) return

    setBusy(true)
    try {
      await createFarm(name)
      setNewFarmName('')
      setProfileOpen(false)
      setStatusMessage(`Farm “${name}” created.`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to create farm.')
    } finally {
      setBusy(false)
    }
  }

  const handleSwitchFarm = async (farmId: string) => {
    if (farmId === activeFarm?.id) {
      setProfileOpen(false)
      return
    }

    setBusy(true)
    try {
      await switchFarm(farmId)
      setProfileOpen(false)
      setStatusMessage(null)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to switch farm.')
    } finally {
      setBusy(false)
    }
  }

  const handleNewMap = async () => {
    if (!canManageMaps || !activeFarm) return

    setBusy(true)
    try {
      createEmptyMap()
      const emptyTask: TaskDataModel = {
        client: null,
        farm: { id: activeFarm.id, name: activeFarm.name },
        fields: [],
      }
      const created = await apiRequest<{ id: string }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          farmId: activeFarm.id,
          name: activeFarm.name,
          fileName: 'New Map.xml',
          projectData: emptyTask,
        }),
      })
      setActiveProjectId(created.id)
      loadTaskData(emptyTask, 'New Map.xml')
      await loadProjects(activeFarm.id)
      setActiveTool('create')
      setStatusMessage('Empty farm workspace created and connected to cloud storage.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to create workspace.')
    } finally {
      setBusy(false)
    }
  }

  const visibleTools = tools.filter((tool) => allowedTools.has(tool.id))
  const canDisplayWorkspace = Boolean(loadedTaskData)

  const renderTool = () => {
    if (!canDisplayWorkspace && activeTool !== 'access') {
      return (
        <section className="empty-workspace-state glass-panel">
          <div className="empty-workspace-symbol">⌖</div>
          <span className="section-kicker">{activeFarm?.name ?? 'No active farm'}</span>
          <h2>{activeFarm ? 'Import fields or create an empty map' : 'Create your first farm'}</h2>
          <p>
            {activeFarm
              ? 'All fields, source files and later GeoTIFF or route layers will stay inside this farm.'
              : 'A farm is the top-level workspace. Data from different farms is never mixed on one map.'}
          </p>
          {canManageMaps && (
            <div className="action-row centered-actions">
              <button className="primary-btn" onClick={() => fileInputRef.current?.click()}>Import fields</button>
              {activeFarm && <button className="ghost-btn" onClick={() => void handleNewMap()}>Create empty map</button>}
            </div>
          )}
        </section>
      )
    }

    switch (activeTool) {
      case 'files':
        return (
          <ProjectFilesPanel
            projectId={activeProjectId}
            projectName={activeFarm?.name ?? 'Farm files'}
            farmId={activeFarm?.id ?? null}
            isAdmin={canManageMaps}
          />
        )
      case 'fields':
        return (
          <Suspense fallback={<section className="empty-workspace-state glass-panel"><h2>Loading layers…</h2></section>}>
            <FieldsLayersPage
              projectId={activeProjectId}
              farmId={activeFarm?.id ?? null}
              canManage={canManageMaps}
            />
          </Suspense>
        )
      case 'create':
        return <CreateFieldPage onComplete={() => setActiveTool('overview')} />
      case 'edit':
        return <EditFieldPage />
      case 'generate':
        return <GenerateLinesPage />
      case 'planting':
        return (
          <Suspense fallback={<section className="empty-workspace-state glass-panel"><h2>Loading Planting…</h2></section>}>
            <PlantingPage />
          </Suspense>
        )
      case 'routes':
        return (
          <Suspense fallback={<section className="empty-workspace-state glass-panel"><h2>Loading routes…</h2></section>}>
            <RouteBuilderPage />
          </Suspense>
        )
      case 'pivot':
        return (
          <Suspense fallback={<section className="empty-workspace-state glass-panel"><h2>Loading Pivot Track…</h2></section>}>
            <PivotTrackPage />
          </Suspense>
        )
      case 'bunker':
        return (
          <Suspense fallback={<section className="empty-workspace-state glass-panel"><h2>Loading Grain Bunker…</h2></section>}>
            <GrainBunkerPage />
          </Suspense>
        )
      case 'export':
        return <ExportPage />
      case 'access':
        return (
          <AdminAccessPanel
            activeFarmId={activeFarm?.id ?? null}
            activeFarmName={activeFarm?.name ?? 'Select a farm'}
          />
        )
      default:
        return <HomePage />
    }
  }

  if (loadingFarms) {
    return (
      <main className="app-loading-screen">
        <div className="loading-mark">CF</div>
        <span>Loading farms…</span>
      </main>
    )
  }

  const mapSectionActive = mapToolIds.has(activeTool)
  const visibleMapTools = permissions.maps
    ? mapTools.filter((tool) => !tool.manageOnly || canManageMaps)
    : []

  const openRailTool = (tool: WorkspaceTool) => {
    setProfileOpen(false)
    setNotificationsOpen(false)
    if (tool === 'overview') {
      if (mapSectionActive) {
        setMapMenuOpen((current) => !current)
      } else {
        setActiveTool('overview')
        setMapMenuOpen(true)
      }
      return
    }
    setActiveTool(tool)
    setMapMenuOpen(false)
  }

  return (
    <div className="workspace-shell dark-glass-shell">
      <aside className="tool-rail">
        <div className="brand-mark rail-brand">CF</div>

        <nav className="tool-rail-nav" aria-label="CyberFarm tools">
          {visibleTools.map((tool) => (
            <button
              key={tool.id}
              className={`tool-rail-item ${tool.id === 'overview' ? (mapSectionActive ? 'active' : '') : (activeTool === tool.id ? 'active' : '')}`}
              title={`${tool.label} — ${tool.description}`}
              aria-expanded={tool.id === 'overview' ? mapMenuOpen : undefined}
              onClick={() => openRailTool(tool.id)}
            >
              <span className="tool-rail-icon">{tool.icon}</span>
              <small>{tool.label}</small>
            </button>
          ))}
        </nav>

        {mapMenuOpen && (
          <section className="map-tool-drawer" aria-label="Map tools">
            <div className="map-tool-drawer-head">
              <span>
                <small>Workspace</small>
                <strong>Maps</strong>
              </span>
              <button onClick={() => setMapMenuOpen(false)} aria-label="Close map tools">×</button>
            </div>
            <div className="map-tool-drawer-list">
              {visibleMapTools.map((tool) => (
                <button
                  key={tool.id}
                  className={`map-tool-drawer-item ${activeTool === tool.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTool(tool.id)
                    setMapMenuOpen(false)
                  }}
                >
                  <span className="map-tool-drawer-icon">{tool.icon}</span>
                  <span>
                    <strong>{tool.label}</strong>
                    <small>{tool.description}</small>
                  </span>
                  <b>›</b>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="rail-footer-actions">
          <div className="notification-menu-wrap">
            {notificationsOpen && (
              <div className="notification-popover glass-panel">
                <div className="notification-popover-head">
                  <span><small>Activity</small><strong>Notifications</strong></span>
                  {notifications.length > 0 && (
                    <button
                      onClick={() => {
                        setDismissedNotifications((current) => [
                          ...new Set([...current, ...notifications.map((notification) => notification.id)]),
                        ])
                        setStatusMessage(null)
                        setErrorMessage(null)
                        setNotificationsOpen(false)
                      }}
                    >Clear all</button>
                  )}
                </div>
                <div className="notification-list">
                  {notifications.length ? notifications.map((notification) => (
                    <article className={`notification-item ${notification.tone}`} key={notification.id}>
                      <i />
                      <span>{notification.message}</span>
                    </article>
                  )) : (
                    <div className="notification-empty">No new notifications.</div>
                  )}
                </div>
              </div>
            )}
            <button
              className={`rail-notification ${notificationsOpen ? 'active' : ''}`}
              onClick={() => {
                setNotificationsOpen((current) => !current)
                setProfileOpen(false)
                setMapMenuOpen(false)
              }}
              title="Notifications"
              aria-label="Notifications"
            >
              <span aria-hidden="true">🔔</span>
              {notifications.length > 0 && <i className="notification-indicator" />}
            </button>
          </div>

          <div className="profile-menu-wrap">
          {profileOpen && (
            <div className="profile-popover glass-panel">
              <div className="profile-popover-head">
                <strong>{user?.name || user?.email}</strong>
                <span>{isAdmin ? 'Administrator' : activeFarm?.role ?? 'Viewer'}</span>
              </div>

              <div className="farm-menu-label">Active farm</div>
              <div className="farm-switch-list">
                {farms.map((farm) => (
                  <button
                    key={farm.id}
                    className={`farm-switch-row ${farm.id === activeFarm?.id ? 'active' : ''}`}
                    onClick={() => void handleSwitchFarm(farm.id)}
                    disabled={busy}
                  >
                    <span>{farm.name}</span>
                    <small>{farm.role}</small>
                  </button>
                ))}
              </div>

              {permissions.maps && (
                <button
                  className={`profile-files-link ${activeTool === 'files' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTool('files')
                    setProfileOpen(false)
                    setMapMenuOpen(false)
                  }}
                >
                  <span className="profile-files-icon">▣</span>
                  <span>
                    <strong>Farm files</strong>
                    <small>{projects.reduce((sum, project) => sum + project.fileCount, 0)} source files</small>
                  </span>
                  <b>›</b>
                </button>
              )}

              {isAdmin && (
                <div className="quick-farm-create">
                  <input
                    value={newFarmName}
                    onChange={(event) => setNewFarmName(event.target.value)}
                    placeholder="New farm name"
                  />
                  <button onClick={() => void handleCreateFarm()} disabled={!newFarmName.trim() || busy}>+</button>
                </div>
              )}

              <button className="profile-signout" onClick={() => void logout()}>Sign out</button>
            </div>
          )}

          <button
            className={`rail-profile ${profileOpen ? 'active' : ''}`}
            onClick={() => {
              setProfileOpen((current) => !current)
              setNotificationsOpen(false)
            }}
            title="Account and farm switcher"
          >
            {(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}
          </button>
          </div>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-topbar glass-panel">
          <div className="workspace-title-wrap">
            <span className="eyebrow">Active farm</span>
            <h1>{activeFarm?.name ?? 'No farm selected'}</h1>
            <div className="workspace-meta">
              <span>{loadedTaskData?.fields.length ?? 0} fields</span>
              <span>{projects.reduce((sum, project) => sum + project.fileCount, 0)} source files</span>
              <span className={`save-chip ${saveState}`}>{formatSaveState(saveState)}</span>
            </div>
          </div>

          {canManageMaps && (
            <div className="workspace-actions">
              <button className="ghost-btn undo-btn" onClick={undoLastChange} disabled={!canUndo || busy} title="Undo last map change">
                ↶ Undo
              </button>
              {activeFarm && <button className="ghost-btn" onClick={() => void handleNewMap()} disabled={busy}>Empty map</button>}
              <button className="primary-btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {busy ? 'Working…' : 'Import'}
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.isoxml,.kml,.kmz,.zip,.geojson,.json,.shp,.ini"
            hidden
            onChange={handleFileSelected}
          />
        </header>

        {!canManage && activeFarm && (
          <div className="viewer-banner glass-panel">
            Read-only access to {activeFarm.name}. Editing and uploads are disabled.
          </div>
        )}

        <div className="workspace-content">
          {loadingProjects ? (
            <section className="empty-workspace-state glass-panel">
              <div className="empty-workspace-symbol">···</div>
              <h2>Loading farm workspace</h2>
            </section>
          ) : renderTool()}
        </div>
      </main>

      {pendingImport && (
        <div className="modal-backdrop">
          <section className="import-modal glass-panel">
            <span className="section-kicker">Import destination</span>
            <h2>{pendingImport.file.name}</h2>
            <p>
              Detected {pendingImport.data.fields.length} field{pendingImport.data.fields.length === 1 ? '' : 's'}.
              Choose whether this file is a separate farm or belongs to the active farm.
            </p>

            <label className={`import-mode-card ${pendingImport.mode === 'new-farm' ? 'active' : ''}`}>
              <input
                type="radio"
                checked={pendingImport.mode === 'new-farm'}
                onChange={() => setPendingImport((current) => current ? { ...current, mode: 'new-farm' } : current)}
              />
              <span>
                <strong>Create a new farm</strong>
                <small>This file becomes a separate farm workspace.</small>
              </span>
            </label>

            {pendingImport.mode === 'new-farm' && (
              <input
                className="text-input"
                value={pendingImport.farmName}
                onChange={(event) => setPendingImport((current) => current ? { ...current, farmName: event.target.value } : current)}
                placeholder="Farm name"
              />
            )}

            <label className={`import-mode-card ${pendingImport.mode === 'current-farm' ? 'active' : ''} ${!activeFarm ? 'disabled' : ''}`}>
              <input
                type="radio"
                checked={pendingImport.mode === 'current-farm'}
                disabled={!activeFarm}
                onChange={() => setPendingImport((current) => current ? { ...current, mode: 'current-farm' } : current)}
              />
              <span>
                <strong>Add to {activeFarm?.name ?? 'current farm'}</strong>
                <small>Keep the existing fields and apply the option below.</small>
              </span>
            </label>

            {pendingImport.mode === 'current-farm' && (
              <div className="import-strategy-group">
                <span className="form-label">When fields overlap</span>
                <label className={`import-mode-card ${pendingImport.strategy === 'overlay' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    checked={pendingImport.strategy === 'overlay'}
                    onChange={() => setPendingImport((current) => current ? { ...current, strategy: 'overlay' } : current)}
                  />
                  <span>
                    <strong>Keep both / overlay</strong>
                    <small>Existing fields stay untouched; imported copies are added above them.</small>
                  </span>
                </label>
                <label className={`import-mode-card ${pendingImport.strategy === 'replace-overlaps' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    checked={pendingImport.strategy === 'replace-overlaps'}
                    onChange={() => setPendingImport((current) => current ? { ...current, strategy: 'replace-overlaps' } : current)}
                  />
                  <span>
                    <strong>Replace overlapping fields</strong>
                    <small>Only matching or spatially overlapping fields are replaced; all other fields stay.</small>
                  </span>
                </label>
              </div>
            )}

            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setPendingImport(null)} disabled={busy}>Cancel</button>
              <button
                className="primary-btn"
                onClick={() => void commitImport()}
                disabled={busy || (pendingImport.mode === 'new-farm' && !pendingImport.farmName.trim())}
              >
                {busy ? 'Importing…' : 'Continue'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
