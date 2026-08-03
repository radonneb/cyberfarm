import { AuthProvider, useAuth } from './auth/AuthContext'
import LoginPage from './pages/LoginPage'
import WorkspacePage from './pages/WorkspacePage'
import './App.css'

function AppGate() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <main className="app-loading-screen">
        <div className="loading-mark">CF</div>
        <span>Loading CyberFarms…</span>
      </main>
    )
  }

  return user ? <WorkspacePage /> : <LoginPage />
}

export default function App() {
  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  )
}
