import { AuthProvider, useAuth } from './auth/AuthContext'
import { FarmProvider } from './farms/FarmContext'
import AcceptInvitePage from './pages/AcceptInvitePage'
import LoginPage from './pages/LoginPage'
import WorkspacePage from './pages/WorkspacePage'
import './App.css'

function AppGate() {
  const { user, loading } = useAuth()

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
  if (window.location.pathname === '/accept-invite') {
    return <AcceptInvitePage />
  }

  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  )
}
