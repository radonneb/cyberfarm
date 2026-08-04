import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from '../services/api'

type FarmZone = 'maps' | 'pivot' | 'bunker' | 'export'
type FarmRole = 'viewer' | 'editor'

type AccessMember = {
  id: string
  email: string
  name: string
  role: FarmRole
  active: boolean
  zones: Record<FarmZone, boolean> & { access: boolean }
}

type PendingInvitation = {
  id: string
  email: string
  name: string
  role: FarmRole
  zones: FarmZone[]
  expiresAt: string
  emailSent: boolean
  emailError: string | null
  expired: boolean
}

type Props = {
  activeFarmId: string | null
  activeFarmName: string
}

type ZoneOption = { id: FarmZone | 'access'; label: string; description: string }

const zoneOptions: ZoneOption[] = [
  { id: 'maps', label: 'Maps', description: 'Fields, lines, files and planting' },
  { id: 'pivot', label: 'Pivot', description: 'Irrigation design' },
  { id: 'bunker', label: 'Bunker', description: 'Grain calculations' },
  { id: 'export', label: 'Export', description: 'Machine formats' },
  { id: 'access', label: 'Access', description: 'Administrators only' },
]

function isFarmZoneOption(zone: ZoneOption): zone is ZoneOption & { id: FarmZone } {
  return zone.id !== 'access'
}

function roleLabel(role: FarmRole) {
  return role === 'editor' ? 'Moderator' : 'Observer'
}

export default function AdminAccessPanel({ activeFarmId, activeFarmName }: Props) {
  const [members, setMembers] = useState<AccessMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<FarmRole>('viewer')
  const [zones, setZones] = useState<FarmZone[]>(['maps', 'export'])
  const [message, setMessage] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const loadAccess = useCallback(async () => {
    if (!activeFarmId) {
      setMembers([])
      setInvitations([])
      return
    }
    const response = await apiRequest<{
      members: AccessMember[]
      invitations: PendingInvitation[]
    }>(`/api/farms/${activeFarmId}/access`)
    setMembers(response.members)
    setInvitations(response.invitations)
  }, [activeFarmId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAccess().catch((error) => setMessage(error.message))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAccess])

  const toggleInviteZone = (zone: FarmZone) => {
    setZones((current) => current.includes(zone)
      ? current.filter((item) => item !== zone)
      : [...current, zone])
  }

  const sendInvitation = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeFarmId) return
    setBusyKey('invite')
    setMessage(null)
    try {
      await apiRequest('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({ email, name, farmId: activeFarmId, role, zones }),
      })
      setEmail('')
      setName('')
      setRole('viewer')
      setZones(['maps', 'export'])
      setMessage('Invitation email sent.')
      await loadAccess()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send invitation.')
      await loadAccess().catch(() => undefined)
    } finally {
      setBusyKey(null)
    }
  }

  const updateMember = async (
    member: AccessMember,
    patch: Partial<Pick<AccessMember, 'role' | 'active'>> & { zones?: FarmZone[] },
  ) => {
    if (!activeFarmId) return
    const nextZones = patch.zones ?? (Object.keys(member.zones) as Array<keyof AccessMember['zones']>)
      .filter((zone): zone is FarmZone => zone !== 'access' && member.zones[zone])
    setBusyKey(member.id)
    setMessage(null)
    try {
      await apiRequest(`/api/farms/${activeFarmId}/access`, {
        method: 'PUT',
        body: JSON.stringify({
          userId: member.id,
          role: patch.role ?? member.role,
          active: patch.active ?? member.active,
          zones: nextZones,
        }),
      })
      setMessage(`${member.name || member.email} updated.`)
      await loadAccess()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update access.')
    } finally {
      setBusyKey(null)
    }
  }

  const revokeInvitation = async (invitation: PendingInvitation) => {
    setBusyKey(invitation.id)
    setMessage(null)
    try {
      await apiRequest(`/api/invitations/${invitation.id}`, { method: 'DELETE' })
      setMessage(`Invitation for ${invitation.email} revoked.`)
      await loadAccess()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to revoke invitation.')
    } finally {
      setBusyKey(null)
    }
  }

  const resendInvitation = async (invitation: PendingInvitation) => {
    if (!activeFarmId) return
    setBusyKey(invitation.id)
    setMessage(null)
    try {
      await apiRequest('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({
          email: invitation.email,
          name: invitation.name,
          farmId: activeFarmId,
          role: invitation.role,
          zones: invitation.zones,
        }),
      })
      setMessage(`A new invitation was sent to ${invitation.email}.`)
      await loadAccess()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to resend invitation.')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="admin-access-layout">
      <section className="page-card access-create-card">
        <span className="section-kicker">Email invitation</span>
        <h2 className="section-title">Invite to {activeFarmName || 'farm'}</h2>
        <p className="muted-copy">
          The user receives a one-time link, creates their own password and is signed in automatically.
        </p>

        <form onSubmit={sendInvitation} className="access-form">
          <label className="form-label" htmlFor="invite-name">Name</label>
          <input id="invite-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Employee name" />

          <label className="form-label" htmlFor="invite-email">Email</label>
          <input id="invite-email" className="text-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="employee@company.com" required />

          <label className="form-label" htmlFor="invite-role">Role</label>
          <select id="invite-role" className="text-input" value={role} onChange={(event) => setRole(event.target.value === 'editor' ? 'editor' : 'viewer')}>
            <option value="viewer">Observer — view only</option>
            <option value="editor">Moderator — can edit allowed zones</option>
          </select>

          <span className="form-label access-zone-label">Accessible zones</span>
          <div className="access-zone-grid">
            {zoneOptions.map((zone) => {
              const editable = isFarmZoneOption(zone)
              const locked = !editable
              const checked = editable && zones.includes(zone.id)
              return (
                <label className={`access-zone-option ${checked ? 'active' : ''} ${locked ? 'locked' : ''}`} key={zone.id}>
                  <input type="checkbox" checked={checked} disabled={locked} onChange={() => editable && toggleInviteZone(zone.id)} />
                  <span><strong>{zone.label}</strong><small>{zone.description}</small></span>
                  <b>{checked ? '+' : '−'}</b>
                </label>
              )
            })}
          </div>

          <button className="primary-btn access-send-button" type="submit" disabled={!activeFarmId || busyKey === 'invite' || !zones.length}>
            {busyKey === 'invite' ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
      </section>

      <section className="page-card access-list-card">
        <div className="access-heading-row">
          <div>
            <span className="section-kicker">Farm access</span>
            <h2 className="section-title">Members and invitations</h2>
          </div>
          <span className="status-chip">{members.length} members</span>
        </div>

        {message && <div className="inline-alert">{message}</div>}

        {!activeFarmId ? (
          <div className="empty-panel">Select a farm before assigning access.</div>
        ) : (
          <>
            {invitations.length > 0 && (
              <div className="access-group">
                <div className="access-group-title"><strong>Pending invitations</strong><span>{invitations.length}</span></div>
                <div className="access-invitation-list">
                  {invitations.map((invitation) => (
                    <article className="access-invitation-row" key={invitation.id}>
                      <div className="user-avatar">{(invitation.name || invitation.email).slice(0, 1).toUpperCase()}</div>
                      <div className="access-user-copy">
                        <strong>{invitation.name || invitation.email}</strong>
                        <span>{invitation.email} · {roleLabel(invitation.role)}</span>
                        <small>{invitation.zones.map((zone) => zoneOptions.find((item) => item.id === zone)?.label).join(', ')}</small>
                      </div>
                      <span className={`invite-status ${invitation.expired || !invitation.emailSent ? 'warning' : ''}`}>
                        {invitation.expired ? 'Expired' : invitation.emailSent ? 'Email sent' : 'Send failed'}
                      </span>
                      <div className="access-row-actions">
                        <button className="ghost-btn small-btn" disabled={busyKey === invitation.id} onClick={() => void resendInvitation(invitation)}>Resend</button>
                        <button className="ghost-btn small-btn danger" disabled={busyKey === invitation.id} onClick={() => void revokeInvitation(invitation)}>Revoke</button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}

            <div className="access-group">
              <div className="access-group-title"><strong>Active members</strong><span>{members.length}</span></div>
              {members.length ? (
                <div className="access-member-list">
                  {members.map((member) => (
                    <article className={`access-member-card ${member.active ? '' : 'disabled'}`} key={member.id}>
                      <div className="access-member-head">
                        <div className="user-avatar">{(member.name || member.email).slice(0, 1).toUpperCase()}</div>
                        <div className="access-user-copy"><strong>{member.name || member.email}</strong><span>{member.email}</span></div>
                        <select className="access-role-select" value={member.role} disabled={busyKey === member.id || !member.active} onChange={(event) => void updateMember(member, { role: event.target.value === 'editor' ? 'editor' : 'viewer' })}>
                          <option value="viewer">Observer</option>
                          <option value="editor">Moderator</option>
                        </select>
                        <button className="ghost-btn small-btn" disabled={busyKey === member.id} onClick={() => void updateMember(member, { active: !member.active })}>{member.active ? 'Disable' : 'Enable'}</button>
                      </div>
                      <div className="access-member-zones">
                        {zoneOptions.map((zone) => {
                          const locked = zone.id === 'access'
                          const checked = locked ? false : member.zones[zone.id]
                          return (
                            <label className={`${checked ? 'active' : ''} ${locked ? 'locked' : ''}`} key={zone.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked || !member.active || busyKey === member.id}
                                onChange={() => {
                                  if (locked) return
                                  const next = zoneOptions
                                    .filter(isFarmZoneOption)
                                    .filter((item) => item.id === zone.id ? !checked : member.zones[item.id])
                                    .map((item) => item.id)
                                  void updateMember(member, { zones: next })
                                }}
                              />
                              <span>{zone.label}</span>
                              <b>{checked ? '+' : '−'}</b>
                            </label>
                          )
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-panel">No accepted invitations yet.</div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
