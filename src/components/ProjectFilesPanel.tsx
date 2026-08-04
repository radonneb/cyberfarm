import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../services/api'

type ProjectFileRaw = {
  id: string
  original_name?: string
  originalName?: string
  content_type?: string | null
  contentType?: string | null
  size_bytes?: number
  sizeBytes?: number
  created_at?: string
  createdAt?: string
}

type ProjectFile = {
  id: string
  name: string
  contentType: string
  sizeBytes: number
  createdAt: string
}

function normalizeFile(file: ProjectFileRaw): ProjectFile {
  return {
    id: file.id,
    name: file.originalName ?? file.original_name ?? 'File',
    contentType: file.contentType ?? file.content_type ?? 'application/octet-stream',
    sizeBytes: Number(file.sizeBytes ?? file.size_bytes ?? 0),
    createdAt: file.createdAt ?? file.created_at ?? '',
  }
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function ProjectFilesPanel({
  projectId,
  projectName,
  farmId,
  isAdmin,
}: {
  projectId: string | null
  projectName: string
  farmId: string | null
  isAdmin: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadFiles = async () => {
    if (!projectId) {
      setFiles([])
      return
    }
    const response = await apiRequest<{ files: ProjectFileRaw[] }>(`/api/projects/${projectId}/files`)
    setFiles(response.files.map(normalizeFile))
  }

  useEffect(() => {
    let cancelled = false
    if (!projectId) {
      setFiles([])
      return
    }

    apiRequest<{ files: ProjectFileRaw[] }>(`/api/projects/${projectId}/files`)
      .then((response) => {
        if (!cancelled) setFiles(response.files.map(normalizeFile))
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load files.')
      })

    return () => {
      cancelled = true
    }
  }, [projectId])

  const uploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!projectId || !farmId || !file || !isAdmin) return

    setBusy(true)
    setMessage('Uploading to Cloudflare R2…')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('farmId', farmId)
      const uploaded = await apiRequest<{ file: { id: string } }>('/api/files', {
        method: 'POST',
        body: formData,
      })

      await apiRequest(`/api/projects/${projectId}/files`, {
        method: 'POST',
        body: JSON.stringify({ fileId: uploaded.file.id }),
      })
      await loadFiles()
      setMessage('File uploaded and attached to this project.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to upload file.')
    } finally {
      setBusy(false)
    }
  }

  const deleteFile = async (file: ProjectFile) => {
    if (!projectId || !isAdmin) return
    if (!window.confirm(`Delete “${file.name}” from this farm?`)) return

    setBusy(true)
    setMessage('Deleting file…')
    try {
      await apiRequest(
        `/api/projects/${projectId}/files?fileId=${encodeURIComponent(file.id)}`,
        { method: 'DELETE' },
      )
      await loadFiles()
      setMessage('File deleted from D1 and R2.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete file.')
    } finally {
      setBusy(false)
    }
  }

  if (!projectId) {
    return (
      <section className="empty-workspace-state">
        <div className="empty-workspace-symbol">↥</div>
        <span className="section-kicker">Farm files</span>
        <h2>Save or open a project first</h2>
        <p>Files are attached to the active farm workspace and stored in Cloudflare R2.</p>
      </section>
    )
  }

  return (
    <div className="project-files-layout">
      <section className="page-card project-files-heading-card">
        <div>
          <span className="section-kicker">Cloudflare R2</span>
          <h2>{projectName}</h2>
          <p>{files.length} stored file{files.length === 1 ? '' : 's'}</p>
        </div>
        {isAdmin && (
          <>
            <button className="primary-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? 'Uploading…' : 'Add file'}
            </button>
            <input ref={inputRef} type="file" hidden onChange={uploadFile} />
          </>
        )}
      </section>

      {message && (
        <div className="workspace-notice project-files-notice">
          <span>{message}</span>
          <button onClick={() => setMessage(null)}>×</button>
        </div>
      )}

      <section className="page-card project-files-list-card">
        {files.length ? (
          <div className="project-files-list">
            {files.map((file) => (
              <div className="project-file-row" key={file.id}>
                <div className="project-file-icon">DOC</div>
                <div className="project-file-copy">
                  <strong>{file.name}</strong>
                  <span>{file.contentType} · {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}</span>
                </div>
                <div className="project-file-actions">
                  <a className="project-file-download" href={`/api/files/${file.id}`}>Download</a>
                  {isAdmin && (
                    <button className="project-file-delete" onClick={() => void deleteFile(file)} disabled={busy}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-panel">No files are attached to this project.</div>
        )}
      </section>
    </div>
  )
}
