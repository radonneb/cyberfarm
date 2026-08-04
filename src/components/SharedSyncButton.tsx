import { useEffect, useState } from 'react'
import { useFarm } from '../farms/FarmContext'
import type { TaskDataModel } from '../models/taskData'
import { apiRequest } from '../services/api'
import { useAppStore } from '../store/appStore'

type ProjectSummaryRaw = {
  id: string
  updated_at?: string
  updatedAt?: string
  data_revision?: number
  dataRevision?: number
  field_count?: number
  fieldCount?: number
}

type ProjectDetail = {
  id: string
  fileName: string | null
  farmId: string | null
  updatedAt: string
  projectData: TaskDataModel | null
  dataRevision?: number
  dataStatus?: string
  dataWarning?: string | null
  fieldCount?: number
}

const buttonStyle: React.CSSProperties = {
  position: 'fixed',
  right: 24,
  bottom: 24,
  zIndex: 1400,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  minHeight: 44,
  padding: '0 17px',
  border: '1px solid rgba(138, 180, 248, 0.42)',
  borderRadius: 14,
  background: 'rgba(14, 25, 40, 0.94)',
  color: '#f4f8ff',
  boxShadow: '0 14px 40px rgba(0, 0, 0, 0.34)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  fontWeight: 750,
  letterSpacing: '0.01em',
  cursor: 'pointer',
}

const statusStyle: React.CSSProperties = {
  position: 'fixed',
  right: 24,
  bottom: 78,
  zIndex: 1400,
  maxWidth: 340,
  padding: '10px 13px',
  borderRadius: 11,
  background: 'rgba(14, 25, 40, 0.96)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  color: '#e8eef8',
  boxShadow: '0 12px 34px rgba(0, 0, 0, 0.3)',
  fontSize: 13,
  lineHeight: 1.35,
}

export default function SharedSyncButton() {
  const { activeFarm } = useFarm()
  const {
    replaceTaskDataFromCloud,
    setErrorMessage,
  } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    setStatus(null)
  }, [activeFarm?.id])

  if (!activeFarm) return null

  const synchronize = async () => {
    if (syncing) return
    setSyncing(true)
    setStatus('Reading the latest shared revision…')
    setErrorMessage(null)

    try {
      const list = await apiRequest<{ projects: ProjectSummaryRaw[] }>(
        `/api/projects?farmId=${encodeURIComponent(activeFarm.id)}`,
      )

      if (!list.projects.length) {
        setStatus('No shared map exists in this farm yet.')
        return
      }

      let selected: ProjectDetail | null = null
      let lastWarning: string | null = null

      for (const summary of list.projects) {
        const response = await apiRequest<{ project: ProjectDetail }>(
          `/api/projects/${summary.id}`,
        )
        if (response.project.farmId !== activeFarm.id) continue
        if (response.project.dataWarning) lastWarning = response.project.dataWarning
        if (response.project.projectData) {
          selected = response.project
          break
        }
      }

      if (!selected?.projectData) {
        throw new Error(
          lastWarning
            ? `${lastWarning} Re-import any listed source file to rebuild the shared map.`
            : 'The farm has source files, but no readable map revision. Re-import a source file to rebuild it.',
        )
      }

      replaceTaskDataFromCloud(selected.projectData, selected.fileName)
      const revision = Number(selected.dataRevision ?? 0)
      const fields = Number(selected.fieldCount ?? selected.projectData.fields.length)
      const recovered = selected.dataStatus === 'r2-migrated'
        || selected.dataStatus === 'legacy-migrated'
      setStatus(
        `${recovered ? 'Recovered and synchronized' : 'Synchronized'} · revision ${revision} · ${fields} field${fields === 1 ? '' : 's'}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Synchronization failed.'
      setErrorMessage(message)
      setStatus(message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      {status && <div role="status" style={statusStyle}>{status}</div>}
      <button
        type="button"
        style={{
          ...buttonStyle,
          opacity: syncing ? 0.72 : 1,
          cursor: syncing ? 'wait' : 'pointer',
        }}
        onClick={() => void synchronize()}
        disabled={syncing}
        title="Reload the newest shared farm revision from D1"
        aria-label="Synchronize farm data"
      >
        <span aria-hidden="true" style={{ fontSize: 19 }}>{syncing ? '···' : '↻'}</span>
        <span>{syncing ? 'Syncing…' : 'Sync'}</span>
      </button>
    </>
  )
}
