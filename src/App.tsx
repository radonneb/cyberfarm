import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { FarmProvider } from './farms/FarmContext'
import LoginPage from './pages/LoginPage'
import InvitePage from './pages/InvitePage'
import WorkspacePage from './pages/WorkspacePage'
import './App.css'

function reloadCyberFarms() {
  const url = new URL(window.location.href)
  url.searchParams.set('reload', Date.now().toString())
  window.location.replace(url.toString())
}

class RuntimeErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CyberFarms UI crashed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="app-loading-screen runtime-error-screen">
        <section className="glass-panel runtime-error-card">
          <div className="loading-mark">CF</div>
          <h1>CyberFarms needs to reload</h1>
          <p>A saved farm contains data from an older version. Your cloud files were not deleted.</p>
          <button className="primary-btn" onClick={reloadCyberFarms}>Reload CyberFarms</button>
        </section>
      </main>
    )
  }
}

function AppGate() {
  const { user, loading } = useAuth()
  const invitationToken = new URLSearchParams(window.location.search).get('invite')

  if (invitationToken) return <InvitePage token={invitationToken} />

  if (loading) {
    return (
      <main className="app-loading-screen">
        <div className="loading-mark">CF</div>
        <span>Loading CyberFarm…</span>
      </main>
    )
  }

  return user ? (
    <FarmProvider>
      <WorkspacePage />
    </FarmProvider>
  ) : (
    <LoginPage />
  )
}

export default function App() {
  return (
    <RuntimeErrorBoundary>
      <AuthProvider>
        <AppGate />
      </AuthProvider>
    </RuntimeErrorBoundary>
  )
}
