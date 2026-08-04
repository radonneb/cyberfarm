import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useFarm, type FarmSummary } from '../farms/FarmContext'
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

type WorkspaceTool =
  | 'overview'
  | 'files'
  | 'create'
  | 'edit'
  | 'generate'
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
}

const tools: Array<{
  id: WorkspaceTool
  label: string
  icon: string
  description: string
  adminOnly?: boolean
}> = [
  { id: 'overview', label: 'Map', icon: '⌖', description: 'Fields and guidance' },
  { id: 'files', label: 'Files', icon: '▣', description: 'Farm source files' },
  { id: 'create', label: 'Create', icon: '+', description: 'Field or guidance', adminOnly: true },
  { id: 'edit', label: 'Edit', icon: '✦', description: 'Geometry and names', adminOnly: true },
  { id: 'generate', label: 'Lines', icon: '≋', description: 'Parallel guidance', adminOnly: true },
  { id: 'pivot', label: 'Pivot', icon: '◉', description: 'Wheel tracks' },
  { id: 'bunker', label: 'Bunker', icon: '▱', description: 'Grain tank' },
  { id: 'export', label: 'Export', icon: '⇩', description: 'Machine formats' },
  { id: 'access', label: 'Access', icon: '◎', description: 'Users and permissions', adminOnly: true },
]

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
): TaskDataModel {
  const scoped = scopeTaskToFarm(incoming, farm)
  if (!current) return scoped

  const names = new Set(current.fields.map((field) => field.name.trim().toLowerCase()))
  const addedFields = scoped.fields.map((field) => cloneField(field, names))

  return {
    ...current,
    farm: { id: farm.id, name: farm.name, clientId: current.client?.id },
    client: current.client ?? scoped.client,
    fields: [...current.fields, ...addedFields],
  }
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
  } = useAppStore()

  const isAdmin = user?.role === 'admin'
  const canManage = isAdmin || activeFarm?.role === 'editor'
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
  const [newFarmName, setNewFarmName] = useState('')
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)

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

  const openProject = async (projectId: string) => {
    const requestId = ++projectLoadRef.current
    setLoadingProjects(true)
    try {
      const response = await apiRequest<{ project: ProjectDetail }>(`/api/projects/${projectId}`)
      if (requestId !== projectLoadRef.current) return
      if (!response.project.projectData) throw new Error('This farm workspace has no map data.')

      setActiveProjectId(projectId)
      loadTaskData(response.project.projectData, response.project.fileName)
      setStatusMessage(null)
      setSaveState('idle')
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
        if (next[0]) await openProject(next[0].id)
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
    if (!canManage || !activeProjectId || !loadedTaskData || busy) return

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    setSaveState('saving')

    saveTimerRef.current = window.setTimeout(() => {
      void apiRequest(`/api/projects/${activeProjectId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: activeFarm?.name ?? activeProject?.name ?? 'Farm workspace',
          fileName: currentFileName,
          projectData: loadedTaskData,
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
  }, [dataVersion, activeProjectId, canManage])

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !canManage) return

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
    if (!pendingImport || !canManage) return

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
        setPendingImport(null)
        setStatusMessage(
          `This file was already imported into ${targetFarm.name} on ${importedAt}. No duplicate fields were added.`,
        )
        return
      }

      setStatusMessage('Uploading the source file…')
      const upload = await uploadSourceFile(pendingImport.file, targetFarm.id)
      uploadedFileId = upload.file.id
      const isCurrentFarm = activeFarm?.id === targetFarm.id
      const existingProjectId = isCurrentFarm ? activeProjectId : null
      const nextTask = existingProjectId
        ? mergeTaskData(loadedTaskData, pendingImport.data, targetFarm)
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
    if (!canManage || !activeFarm) return

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

  const visibleTools = tools.filter((tool) => !tool.adminOnly || canManage)
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
          {canManage && (
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
            isAdmin={Boolean(canManage)}
          />
        )
      case 'create':
        return <CreateFieldPage onComplete={() => setActiveTool('overview')} />
      case 'edit':
        return <EditFieldPage />
      case 'generate':
        return <GenerateLinesPage />
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
            activeProjectId={activeProjectId}
            activeProjectName={activeFarm?.name ?? 'Select a farm'}
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

  return (
    <div className="workspace-shell dark-glass-shell">
      <aside className="tool-rail">
        <div className="brand-mark rail-brand">CF</div>

        <nav className="tool-rail-nav" aria-label="CyberFarm tools">
          {visibleTools.map((tool) => (
            <button
              key={tool.id}
              className={`tool-rail-item ${activeTool === tool.id ? 'active' : ''}`}
              title={`${tool.label} — ${tool.description}`}
              onClick={() => setActiveTool(tool.id)}
            >
              <span className="tool-rail-icon">{tool.icon}</span>
              <small>{tool.label}</small>
            </button>
          ))}
        </nav>

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
            onClick={() => setProfileOpen((current) => !current)}
            title="Account and farm switcher"
          >
            {(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}
          </button>
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

          {canManage && (
            <div className="workspace-actions">
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

        {(statusMessage || errorMessage || farmError) && (
          <div className="workspace-notice glass-panel">
            <span>{errorMessage ?? farmError ?? statusMessage}</span>
            <button
              onClick={() => {
                setStatusMessage(null)
                setErrorMessage(null)
              }}
            >
              ×
            </button>
          </div>
        )}

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
                <small>Merge the detected fields into the active farm.</small>
              </span>
            </label>

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
