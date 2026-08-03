import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiRequest } from '../services/api'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'viewer'
  active: boolean
}

type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const USER_CACHE_KEY = 'cyberfarm_signed_user'
const TASK_KEYS = [
  'gargha_current_taskdata',
  'gargha_current_file_name',
  'cyberfarm_active_project',
]

function clearWorkspaceCache() {
  for (const key of TASK_KEYS) localStorage.removeItem(key)
}

function rememberUser(user: AuthUser) {
  const previousId = localStorage.getItem(USER_CACHE_KEY)
  if (previousId && previousId !== user.id) clearWorkspaceCache()
  localStorage.setItem(USER_CACHE_KEY, user.id)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    apiRequest<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/session')
      .then((response) => {
        if (cancelled) return
        if (response.authenticated && response.user) {
          rememberUser(response.user)
          setUser(response.user)
        } else {
          setUser(null)
        }
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const login = async (email: string, password: string) => {
    const response = await apiRequest<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    rememberUser(response.user)
    setUser(response.user)
  }

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
    } finally {
      clearWorkspaceCache()
      localStorage.removeItem(USER_CACHE_KEY)
      setUser(null)
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
