import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../auth/AuthContext'
import { apiRequest } from '../services/api'

export type FarmRole = 'admin' | 'editor' | 'viewer'

export type FarmSummary = {
  id: string
  name: string
  role: FarmRole
  archived: boolean
  createdAt: string
  updatedAt: string
}

type FarmContextValue = {
  farms: FarmSummary[]
  activeFarm: FarmSummary | null
  loading: boolean
  error: string | null
  refreshFarms: () => Promise<void>
  createFarm: (name: string) => Promise<FarmSummary>
  switchFarm: (farmId: string) => Promise<FarmSummary>
}

const FarmContext = createContext<FarmContextValue | null>(null)

const LEGACY_LARGE_KEYS = [
  'gargha_import_history',
  'gargha_current_taskdata',
  'gargha_current_file_name',
  'cyberfarm_active_project',
]

function clearLegacyGeometryCache() {
  for (const key of LEGACY_LARGE_KEYS) localStorage.removeItem(key)
}

export function FarmProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [farms, setFarms] = useState<FarmSummary[]>([])
  const [activeFarm, setActiveFarm] = useState<FarmSummary | null>(null)
  const [loading, setLoading] = useState(Boolean(user))
  const [error, setError] = useState<string | null>(null)

  const refreshFarms = useCallback(async () => {
    if (!user) {
      setFarms([])
      setActiveFarm(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await apiRequest<{
        farms: FarmSummary[]
        activeFarmId: string | null
      }>('/api/farms')

      setFarms(response.farms)
      setActiveFarm(
        response.farms.find((farm) => farm.id === response.activeFarmId) ??
          response.farms[0] ??
          null,
      )
      clearLegacyGeometryCache()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load farms.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refreshFarms()
  }, [refreshFarms])

  const createFarm = async (name: string) => {
    const response = await apiRequest<{ farm: FarmSummary }>('/api/farms', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })

    setFarms((current) =>
      [...current.filter((farm) => farm.id !== response.farm.id), response.farm]
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    setActiveFarm(response.farm)
    return response.farm
  }

  const switchFarm = async (farmId: string) => {
    const response = await apiRequest<{ farm: FarmSummary }>('/api/farms/active', {
      method: 'PUT',
      body: JSON.stringify({ farmId }),
    })

    clearLegacyGeometryCache()
    setActiveFarm(response.farm)
    return response.farm
  }

  const value = useMemo<FarmContextValue>(
    () => ({
      farms,
      activeFarm,
      loading,
      error,
      refreshFarms,
      createFarm,
      switchFarm,
    }),
    [farms, activeFarm, loading, error, refreshFarms],
  )

  return <FarmContext.Provider value={value}>{children}</FarmContext.Provider>
}

export function useFarm() {
  const context = useContext(FarmContext)
  if (!context) throw new Error('useFarm must be used inside FarmProvider')
  return context
}
