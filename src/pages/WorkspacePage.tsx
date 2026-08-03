import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useAppStore } from '../store/appStore'
import { apiRequest } from '../services/api'
import HomePage from './HomePage'
import CreateFieldPage from './CreateFieldPage'
import EditFieldPage from './EditFieldPage'
import GenerateLinesPage from './GenerateLinesPage'
import ExportPage from './ExportPage'
import AdminAccessPanel from '../components/AdminAccessPanel'
import ProjectFilesPanel from '../components/ProjectFilesPanel'

type WorkspaceTool = 'overview' | 'files' | 'create' | 'edit' | 'generate' | 'export' | 'access'

type ProjectSummaryRaw = {
  id: string
  name: string
  file_name?: string | null
  fileName?: string | null
  created_at?: string
  createdAt?: string
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
  fileName: string | null
  projectData: unknown
}

const ACTIVE_PROJECT_KEY = 'cyberfarm_active_project'
const CURRENT_TASK_KEY = 'gargha_current_taskdata'
const CURRENT_NAME_KEY = 'gargha_current_file_name'

const tools: Array<{
  id: WorkspaceTool
  label: string
  description: string
  adminOnly?: boolean
}> = [
  { id: 'overview', label: 'Workspace', description: 'Map and fields' },
  { id: 'files', label: 'Files', description: 'Cloudflare library' },
  { id: 'create', label: 'Create', description: 'Field or guidance', adminOnly: true },
  { id: 'edit', label: 'Edit', description: 'Geometry and names', adminOnly: true },
  { id: 'generate', label: 'Generate', description: 'Parallel lines', adminOnly: true },
  { id: 'export', label: 'Export', description: 'Machine formats' },
  { id: 'access', label: 'Access', description: 'Users and permissions', adminOnly: true },
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

function projectNameFromFile(fileName: string | null) {
  if (!fileName) return 'Untitled project'
  return fileName.replace(/\.[^.]+$/, '') || fileName
}

function readableDate(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export default function WorkspacePage() {
  const { user, logout } = useAuth()
  const {
    loadedTaskData,
    currentFileName,
    importAny,
    createEmptyMap,
    saveCurrentTaskData,
    errorMessage,
    setErrorMessage,
  } = useAppStore()

  const isAdmin = user?.role === 'admin'
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [activeTool, setActiveTool] = useState<WorkspaceTool>('overview')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY),
  )
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  const loadProjects = async () => {
    const response = await apiRequest<{ projects: ProjectSummaryRaw[] }>('/api/projects')
    const next = response.projects.map(normalizeProject)
    setProjects(next)
    return next
  }

  useEffect(() => {
    let cancelled = false
    setLoadingProjects(true)

    loadProjects()
      .then((next) => {
        if (cancelled) return
        if (!isAdmin && activeProjectId && !next.some((item) => item.id === activeProjectId)) {
          localStorage.removeItem(ACTIVE_PROJECT_KEY)
          localStorage.removeItem(CURRENT_TASK_KEY)
          localStorage.removeItem(CURRENT_NAME_KEY)
          setActiveProjectId(null)
        }
      })
      .catch((error) => {
        if (!cancelled) setStatusMessage(error instanceof Error ? error.message : 'Unable to load projects.')
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false)
      })

    return () => {
      cancelled = true
    }
  }, [user?.id])


  const openProject = async (projectId: string) => {
    setBusy(true)
    setStatusMessage('Opening project…')
    try {
      const response = await apiRequest<{ project: ProjectDetail }>(`/api/projects/${projectId}`)
      if (!response.project.projectData) throw new Error('This project does not contain map data.')

      localStorage.setItem(CURRENT_TASK_KEY, JSON.stringify(response.project.projectData))
      if (response.project.fileName) localStorage.setItem(CURRENT_NAME_KEY, response.project.fileName)
      else localStorage.removeItem(CURRENT_NAME_KEY)
      localStorage.setItem(ACTIVE_PROJECT_KEY, projectId)
      window.location.reload()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to open project.')
      setBusy(false)
    }
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !isAdmin) return

    localStorage.removeItem(ACTIVE_PROJECT_KEY)
    localStorage.removeItem(CURRENT_TASK_KEY)
    localStorage.removeItem(CURRENT_NAME_KEY)
    setActiveProjectId(null)
    setActiveTool('overview')
    setErrorMessage(null)
    setBusy(true)
    setStatusMessage('Reading the imported file…')

    try {
      await importAny(file)
      const storedName = localStorage.getItem(CURRENT_NAME_KEY)
      const storedTask = localStorage.getItem(CURRENT_TASK_KEY)
      if (storedName !== file.name || !storedTask) {
        setStatusMessage(null)
        return
      }
      const parsed = JSON.parse(storedTask) as unknown

      setStatusMessage('Uploading file to Cloudflare…')
      const formData = new FormData()
      formData.append('file', file)
      const upload = await apiRequest<{ file: { id: string } }>('/api/files', {
        method: 'POST',
        body: formData,
      })

      const created = await apiRequest<{ id: string }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: projectNameFromFile(file.name),
          fileName: file.name,
          projectData: parsed,
          fileId: upload.file.id,
        }),
      })

      localStorage.setItem(ACTIVE_PROJECT_KEY, created.id)
      setActiveProjectId(created.id)
      await loadProjects()
      setStatusMessage('Project and source file are stored in Cloudflare.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to store the project.')
    } finally {
      setBusy(false)
    }
  }

  const handleNewMap = () => {
    if (!isAdmin) return
    createEmptyMap()
    localStorage.removeItem(ACTIVE_PROJECT_KEY)
    setActiveProjectId(null)
    setActiveTool('overview')
    setStatusMessage('New map created locally. Save it to store it in Cloudflare.')
  }

  const handleSave = async () => {
    if (!isAdmin) return
    if (!loadedTaskData) {
      setStatusMessage('There is no project data to save.')
      return
    }

    saveCurrentTaskData()
    setBusy(true)
    setStatusMessage('Saving to Cloudflare…')

    try {
      const payload = {
        name: activeProject?.name ?? projectNameFromFile(currentFileName),
        fileName: currentFileName,
        projectData: loadedTaskData,
      }

      if (activeProjectId) {
        await apiRequest(`/api/projects/${activeProjectId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        const created = await apiRequest<{ id: string }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        localStorage.setItem(ACTIVE_PROJECT_KEY, created.id)
        setActiveProjectId(created.id)
      }

      await loadProjects()
      setStatusMessage('Saved to Cloudflare.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to save project.')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    if (!isAdmin) return
    const project = projects.find((item) => item.id === projectId)
    if (!window.confirm(`Delete “${project?.name ?? 'project'}” from Cloudflare?`)) return

    setBusy(true)
    try {
      await apiRequest(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (activeProjectId === projectId) {
        localStorage.removeItem(ACTIVE_PROJECT_KEY)
        localStorage.removeItem(CURRENT_TASK_KEY)
        localStorage.removeItem(CURRENT_NAME_KEY)
        setActiveProjectId(null)
      }
      await loadProjects()
      setStatusMessage('Project deleted.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to delete project.')
    } finally {
      setBusy(false)
    }
  }

  const visibleTools = tools.filter((tool) => !tool.adminOnly || isAdmin)
  const canDisplayWorkspace = Boolean(loadedTaskData) && (isAdmin || Boolean(activeProject))

  const renderTool = () => {
    if (!canDisplayWorkspace && activeTool !== 'access') {
      return (
        <section className="empty-workspace-state">
          <div className="empty-workspace-symbol">◎</div>
          <span className="section-kicker">No project opened</span>
          <h2>{isAdmin ? 'Import a file or create a new map' : 'Select a shared project'}</h2>
          <p>
            {isAdmin
              ? 'Source files will be uploaded to Cloudflare R2 and project data will be stored in D1.'
              : 'Only projects approved by the administrator appear in your project list.'}
          </p>
          {isAdmin && (
            <div className="action-row centered-actions">
              <button className="primary-btn" onClick={() => fileInputRef.current?.click()}>Import file</button>
              <button className="ghost-btn" onClick={handleNewMap}>Create map</button>
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
            projectName={activeProject?.name ?? projectNameFromFile(currentFileName)}
            isAdmin={isAdmin}
          />
        )
      case 'create':
        return <CreateFieldPage onComplete={() => setActiveTool('overview')} />
      case 'edit':
        return <EditFieldPage />
      case 'generate':
        return <GenerateLinesPage />
      case 'export':
        return <ExportPage />
      case 'access':
        return (
          <AdminAccessPanel
            activeProjectId={activeProjectId}
            activeProjectName={activeProject?.name ?? projectNameFromFile(currentFileName)}
          />
        )
      default:
        return <HomePage />
    }
  }

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">CF</div>
          <div>
            <strong>CyberFarms</strong>
            <span>Field workspace</span>
          </div>
        </div>

        <nav className="workspace-nav" aria-label="Workspace tools">
          {visibleTools.map((tool) => (
            <button
              key={tool.id}
              className={`workspace-nav-item ${activeTool === tool.id ? 'active' : ''}`}
              onClick={() => setActiveTool(tool.id)}
            >
              <span>{tool.label}</span>
              <small>{tool.description}</small>
            </button>
          ))}
        </nav>

        <div className="project-library-heading">
          <span>Projects</span>
          <strong>{projects.length}</strong>
        </div>

        <div className="project-library">
          {loadingProjects ? (
            <div className="sidebar-empty">Loading…</div>
          ) : projects.length ? projects.map((project) => (
            <div className={`project-list-row ${activeProjectId === project.id ? 'active' : ''}`} key={project.id}>
              <button className="project-list-open" onClick={() => void openProject(project.id)} disabled={busy}>
                <strong>{project.name}</strong>
                <span>{readableDate(project.updatedAt)} · {project.fileCount} file{project.fileCount === 1 ? '' : 's'}</span>
              </button>
              {isAdmin && (
                <button
                  className="project-delete-btn"
                  title="Delete project"
                  onClick={() => void handleDeleteProject(project.id)}
                >
                  ×
                </button>
              )}
            </div>
          )) : (
            <div className="sidebar-empty">No available projects</div>
          )}
        </div>

        <div className="sidebar-profile">
          <div className="user-avatar">{(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}</div>
          <div className="sidebar-profile-copy">
            <strong>{user?.name || user?.email}</strong>
            <span>{isAdmin ? 'Administrator' : 'Read-only viewer'}</span>
          </div>
          <button className="profile-logout" onClick={() => void logout()} title="Sign out">↗</button>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-title-wrap">
            <span className="eyebrow">{activeProject ? 'Cloudflare project' : 'Local workspace'}</span>
            <h1>{activeProject?.name ?? projectNameFromFile(currentFileName)}</h1>
            <div className="workspace-meta">
              <span>{loadedTaskData?.fields.length ?? 0} fields</span>
              <span>{currentFileName ?? 'No source file'}</span>
              <span className={`role-chip ${isAdmin ? 'admin' : ''}`}>{isAdmin ? 'Admin' : 'View only'}</span>
            </div>
          </div>

          {isAdmin && (
            <div className="workspace-actions">
              <button className="ghost-btn" onClick={handleNewMap}>New map</button>
              <button className="secondary-btn" onClick={() => fileInputRef.current?.click()}>Import</button>
              <button className="primary-btn" onClick={() => void handleSave()} disabled={busy || !loadedTaskData}>
                {busy ? 'Working…' : 'Save to cloud'}
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.isoxml,.kml,.kmz,.zip,.geojson,.json,.shp,.ini"
            hidden
            onChange={handleImport}
          />
        </header>

        {(statusMessage || errorMessage) && (
          <div className="workspace-notice">
            <span>{errorMessage ?? statusMessage}</span>
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

        {!isAdmin && activeProject && (
          <div className="viewer-banner">
            This project is shared with read-only access. Editing and uploads are disabled.
          </div>
        )}

        <div className="workspace-content">{renderTool()}</div>
      </main>
    </div>
  )
}
