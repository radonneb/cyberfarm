import { AuthProvider, useAuth } from './auth/AuthContext'
import { FarmProvider } from './farms/FarmContext'
import LoginPage from './pages/LoginPage'
import InvitePage from './pages/InvitePage'
import WorkspacePage from './pages/WorkspacePage'
import './App.css'

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
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  )
}
