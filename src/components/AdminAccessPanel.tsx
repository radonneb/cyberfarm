import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { apiRequest } from '../services/api'

type ViewerUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'viewer'
  active: number | boolean
}

type PermissionRow = {
  id: string
  email: string
  name: string
  active: number | boolean
  allowed: number | boolean
}

type Props = {
  activeProjectId: string | null
  activeProjectName: string
}

export default function AdminAccessPanel({ activeProjectId, activeProjectName }: Props) {
  const [users, setUsers] = useState<ViewerUser[]>([])
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadUsers = async () => {
    const response = await apiRequest<{ users: ViewerUser[] }>('/api/users')
    setUsers(response.users.filter((user) => user.role === 'viewer'))
  }

  const loadPermissions = async () => {
    if (!activeProjectId) {
      setPermissions([])
      return
    }
    const response = await apiRequest<{ permissions: PermissionRow[] }>(
      `/api/projects/${activeProjectId}/permissions`,
    )
    setPermissions(response.permissions)
  }

  useEffect(() => {
    void loadUsers().catch((error) => setMessage(error.message))
  }, [])

  useEffect(() => {
    void loadPermissions().catch((error) => setMessage(error.message))
  }, [activeProjectId])

  const permissionByUser = useMemo(
    () => new Map(permissions.map((item) => [item.id, item])),
    [permissions],
  )

  const createUser = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({ email, name, password }),
      })
      setEmail('')
      setName('')
      setPassword('')
      setMessage('Viewer account created.')
      await Promise.all([loadUsers(), loadPermissions()])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create account.')
    } finally {
      setBusy(false)
    }
  }

  const togglePermission = async (userId: string, allowed: boolean) => {
    if (!activeProjectId) return
    setMessage(null)
    try {
      await apiRequest(`/api/projects/${activeProjectId}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ userId, allowed }),
      })
      await loadPermissions()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to change access.')
    }
  }

  const toggleUserActive = async (user: ViewerUser) => {
    const nextActive = !Boolean(user.active)
    setMessage(null)
    try {
      await apiRequest(`/api/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: nextActive, name: user.name }),
      })
      await Promise.all([loadUsers(), loadPermissions()])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update account.')
    }
  }

  return (
    <div className="admin-access-layout">
      <section className="page-card access-create-card">
        <span className="section-kicker">Viewer account</span>
        <h2 className="section-title">Create read-only access</h2>
        <p className="muted-copy">
          Viewers can open only projects explicitly shared with them. Editing and uploading remain disabled.
        </p>

        <form onSubmit={createUser} className="access-form">
          <label className="form-label" htmlFor="viewer-name">Name</label>
          <input
            id="viewer-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Employee name"
          />

          <label className="form-label" htmlFor="viewer-email">Email</label>
          <input
            id="viewer-email"
            className="text-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="employee@company.com"
            required
          />

          <label className="form-label" htmlFor="viewer-password">Temporary password</label>
          <input
            id="viewer-password"
            className="text-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />

          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create viewer'}
          </button>
        </form>
      </section>

      <section className="page-card access-list-card">
        <div className="access-heading-row">
          <div>
            <span className="section-kicker">Project permissions</span>
            <h2 className="section-title">{activeProjectName || 'Select a project'}</h2>
          </div>
          <span className="status-chip">{users.length} viewers</span>
        </div>

        {message && <div className="inline-alert">{message}</div>}

        {!activeProjectId ? (
          <div className="empty-panel">Open a project before assigning access.</div>
        ) : users.length ? (
          <div className="access-user-list">
            {users.map((user) => {
              const permission = permissionByUser.get(user.id)
              const allowed = Boolean(permission?.allowed)
              const active = Boolean(user.active)

              return (
                <div className="access-user-row" key={user.id}>
                  <div className="user-avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</div>
                  <div className="access-user-copy">
                    <strong>{user.name || user.email}</strong>
                    <span>{user.email}</span>
                  </div>
                  <label className="permission-toggle">
                    <input
                      type="checkbox"
                      checked={allowed && active}
                      disabled={!active}
                      onChange={(event) => void togglePermission(user.id, event.target.checked)}
                    />
                    <span>{allowed ? 'Can view' : 'No access'}</span>
                  </label>
                  <button className="ghost-btn small-btn" onClick={() => void toggleUserActive(user)}>
                    {active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-panel">Create the first viewer account.</div>
        )}
      </section>
    </div>
  )
}
