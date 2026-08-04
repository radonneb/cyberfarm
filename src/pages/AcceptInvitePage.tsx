import { useMemo, useState, type FormEvent } from 'react'
import { apiRequest } from '../services/api'

export default function AcceptInvitePage() {
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get('token') ?? '',
    [],
  )
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!token) {
      setError('Invitation token is missing.')
      return
    }
    if (password.length < 10) {
      setError('Password must contain at least 10 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      await apiRequest('/api/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      })
      window.location.replace('/')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to activate account.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual" aria-hidden="true">
        <div className="login-brand-mark">CF</div>
        <div className="login-visual-copy">
          <span className="eyebrow">Invitation-only workspace</span>
          <h1>Join CyberFarm</h1>
          <p>Set your password to activate access to the farm assigned by the administrator.</p>
        </div>
        <div className="login-orbit login-orbit-one" />
        <div className="login-orbit login-orbit-two" />
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-mobile-brand">CyberFarm</div>
          <span className="eyebrow">Account activation</span>
          <h2>Create your password</h2>
          <p className="muted-copy">The invitation link can be used once and expires after 72 hours.</p>

          <label className="form-label" htmlFor="invite-password">Password</label>
          <input
            id="invite-password"
            className="text-input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 10 characters"
            minLength={10}
            required
          />

          <label className="form-label" htmlFor="invite-confirm">Confirm password</label>
          <input
            id="invite-confirm"
            className="text-input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repeat password"
            minLength={10}
            required
          />

          {error && <div className="inline-alert danger-alert">{error}</div>}

          <button className="primary-btn login-submit" type="submit" disabled={submitting}>
            {submitting ? 'Activating…' : 'Activate account'}
          </button>
        </form>
      </section>
    </main>
  )
}
