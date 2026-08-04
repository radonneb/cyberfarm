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

type FarmRow = {
  id: string
  name: string
}

type InvitationRow = {
  id: string
  email: string
  name: string
  role: 'editor' | 'viewer'
  farm_id: string
  farm_name: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
}

type Props = {
  activeProjectId: string | null
  activeProjectName: string
}

export default function AdminAccessPanel({ activeProjectId, activeProjectName }: Props) {
  const [users, setUsers] = useState<ViewerUser[]>([])
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [farms, setFarms] = useState<FarmRow[]>([])
  const [invitations, setInvitations] = useState<InvitationRow[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer')
  const [farmId, setFarmId] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadUsers = async () => {
    const response = await apiRequest<{ users: ViewerUser[] }>('/api/users')
    setUsers(response.users.filter((user) => user.role === 'viewer'))
  }

  const loadFarms = async () => {
    const response = await apiRequest<{ farms: FarmRow[] }>('/api/farms')
    setFarms(response.farms)
    setFarmId((current) => current || response.farms[0]?.id || '')
  }

  const loadInvitations = async () => {
    const response = await apiRequest<{ invitations: InvitationRow[] }>('/api/invitations')
    setInvitations(response.invitations)
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
    void Promise.all([loadUsers(), loadFarms(), loadInvitations()]).catch((error) =>
      setMessage(error.message),
    )
  }, [])

  useEffect(() => {
    void loadPermissions().catch((error) => setMessage(error.message))
  }, [activeProjectId])

  const permissionByUser = useMemo(
    () => new Map(permissions.map((item) => [item.id, item])),
    [permissions],
  )

  const createInvitation = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    setInviteLink(null)
    try {
      const response = await apiRequest<{
        delivery: { sent: boolean; reason?: string }
        inviteUrl?: string
      }>('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({ email, name, role, farmId }),
      })
      setEmail('')
      setName('')
      setMessage(
        response.delivery.sent
          ? 'Invitation email sent.'
          : response.delivery.reason || 'Invitation created, but email was not sent.',
      )
      setInviteLink(response.inviteUrl ?? null)
      await loadInvitations()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create invitation.')
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

  const invitationStatus = (invitation: InvitationRow) => {
    if (invitation.accepted_at) return 'Accepted'
    if (invitation.revoked_at) return 'Revoked'
    if (new Date(invitation.expires_at).getTime() <= Date.now()) return 'Expired'
    return 'Pending'
  }

  return (
    <div className="admin-access-layout">
      <section className="page-card access-create-card">
        <span className="section-kicker">Invitation-only access</span>
        <h2 className="section-title">Invite a farm member</h2>
        <p className="muted-copy">
          CyberFarm sends a one-time link. The recipient creates their own password before the account becomes active.
        </p>

        <form onSubmit={createInvitation} className="access-form">
          <label className="form-label" htmlFor="invite-name">Name</label>
          <input
            id="invite-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Employee name"
            required
          />

          <label className="form-label" htmlFor="invite-email">Email</label>
          <input
            id="invite-email"
            className="text-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="employee@company.com"
            required
          />

          <label className="form-label" htmlFor="invite-farm">Farm</label>
          <select
            id="invite-farm"
            className="text-input"
            value={farmId}
            onChange={(event) => setFarmId(event.target.value)}
            required
          >
            {farms.map((farm) => (
              <option key={farm.id} value={farm.id}>{farm.name}</option>
            ))}
          </select>

          <label className="form-label" htmlFor="invite-role">Role</label>
          <select
            id="invite-role"
            className="text-input"
            value={role}
            onChange={(event) => setRole(event.target.value === 'editor' ? 'editor' : 'viewer')}
          >
            <option value="viewer">Viewer — read-only</option>
            <option value="editor">Editor — create and manage</option>
          </select>

          <button className="primary-btn" type="submit" disabled={busy || !farmId}>
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        </form>

        {message && <div className="inline-alert">{message}</div>}
        {inviteLink && (
          <div className="inline-alert">
            Email delivery is unavailable. Copy this one-time link:
            <input className="text-input" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} />
          </div>
        )}

        <div className="access-user-list">
          {invitations.slice(0, 8).map((invitation) => (
            <div className="access-user-row" key={invitation.id}>
              <div className="user-avatar">{invitation.name.slice(0, 1).toUpperCase()}</div>
              <div className="access-user-copy">
                <strong>{invitation.name}</strong>
                <span>{invitation.email} · {invitation.farm_name} · {invitation.role}</span>
              </div>
              <span className="status-chip">{invitationStatus(invitation)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="page-card access-list-card">
        <div className="access-heading-row">
          <div>
            <span className="section-kicker">Existing project permissions</span>
            <h2 className="section-title">{activeProjectName || 'Select a project'}</h2>
          </div>
          <span className="status-chip">{users.length} active accounts</span>
        </div>

        {!activeProjectId ? (
          <div className="empty-panel">Open a project before assigning legacy project access.</div>
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
          <div className="empty-panel">No activated invited accounts yet.</div>
        )}
      </section>
    </div>
  )
}
