import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await login(email, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual" aria-hidden="true">
        <div className="login-brand-mark">CF</div>
        <div className="login-visual-copy">
          <span className="eyebrow">Precision agriculture workspace</span>
          <h1>CyberFarms</h1>
          <p>Fields, guidance lines and machine-ready files in one controlled workspace.</p>
        </div>
        <div className="login-orbit login-orbit-one" />
        <div className="login-orbit login-orbit-two" />
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-mobile-brand">CyberFarms</div>
          <span className="eyebrow">Secure access</span>
          <h2>Sign in by email</h2>
          <p className="muted-copy">Use the account created for you by the administrator.</p>

          <label className="form-label" htmlFor="login-email">Email</label>
          <input
            id="login-email"
            className="text-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            required
          />

          <label className="form-label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            className="text-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            required
          />

          {error && <div className="inline-alert danger-alert">{error}</div>}

          <button className="primary-btn login-submit" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
