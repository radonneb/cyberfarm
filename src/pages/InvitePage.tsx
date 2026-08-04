import { useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from '../services/api'

type FarmZone = 'maps' | 'pivot' | 'bunker' | 'export'

type Invitation = {
  email: string
  name: string
  farmName: string
  role: 'editor' | 'viewer'
  zones: FarmZone[]
  expiresAt: string
}

const zoneLabels: Record<FarmZone, string> = {
  maps: 'Maps',
  pivot: 'Pivot',
  bunker: 'Bunker',
  export: 'Export',
}

export default function InvitePage({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiRequest<{ invitation: Invitation }>('/api/invitations/inspect', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((response) => {
        if (!cancelled) setInvitation(response.invitation)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to open invitation.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const acceptInvitation = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must contain at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    try {
      await apiRequest('/api/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      })
      setComplete(true)
      window.setTimeout(() => window.location.assign('/'), 850)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to accept invitation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="invite-page">
      <section className="invite-card glass-panel">
        <div className="invite-brand"><span>CF</span><strong>CyberFarms</strong></div>

        {loading ? (
          <div className="invite-loading">Checking invitation…</div>
        ) : complete ? (
          <div className="invite-success">
            <span>✓</span>
            <h1>Account created</h1>
            <p>You are being signed in to CyberFarms.</p>
          </div>
        ) : invitation ? (
          <>
            <span className="section-kicker">Farm invitation</span>
            <h1>Join {invitation.farmName}</h1>
            <p className="invite-intro">
              Welcome, {invitation.name}. Create your password to activate <strong>{invitation.email}</strong>.
            </p>

            <div className="invite-summary">
              <div><span>Role</span><strong>{invitation.role === 'editor' ? 'Moderator' : 'Observer'}</strong></div>
              <div><span>Available zones</span><strong>{invitation.zones.map((zone) => zoneLabels[zone]).join(', ')}</strong></div>
              <div><span>Expires</span><strong>{new Date(invitation.expiresAt).toLocaleDateString('en-GB')}</strong></div>
            </div>

            <form className="invite-form" onSubmit={acceptInvitation}>
              <label>
                <span className="form-label">Password</span>
                <input className="text-input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
              </label>
              <label>
                <span className="form-label">Confirm password</span>
                <input className="text-input" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              </label>
              {error && <div className="inline-alert">{error}</div>}
              <button className="primary-btn" type="submit" disabled={busy}>
                {busy ? 'Creating account…' : 'Create account and sign in'}
              </button>
            </form>
          </>
        ) : (
          <div className="invite-error-state">
            <span>!</span>
            <h1>Invitation unavailable</h1>
            <p>{error ?? 'The invitation link is invalid.'}</p>
            <a href="/">Return to sign in</a>
          </div>
        )}
      </section>
    </main>
  )
}
