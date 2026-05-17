import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Company, Season } from '../types'

interface AppState {
  // Auth
  token:      string | null
  user:       User   | null
  company:    Company | null
  role:       string | null
  permissions:string[]

  // Active filters (global — all modules respect these)
  activeSeason: Season | null
  seasons:      Season[]

  // Actions
  setAuth:        (token: string, user: User, company: Company, role: string, permissions: string[]) => void
  logout:         () => void
  setSeasons:     (seasons: Season[]) => void
  setActiveSeason:(season: Season | null) => void
  setPermissions: (permissions: string[]) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token:        null,
      user:         null,
      company:      null,
      role:         null,
      permissions:  [],
      activeSeason: null,
      seasons:      [],

      setAuth: (token, user, company, role, permissions) => {
        localStorage.setItem('agro_token', token)
        set({ token, user, company, role, permissions })
      },

      logout: () => {
        localStorage.removeItem('agro_token')
        set({ token: null, user: null, company: null, role: null, permissions: [], activeSeason: null, seasons: [] })
      },

      setSeasons:      (seasons)       => set({ seasons }),
      setActiveSeason: (activeSeason)  => set({ activeSeason }),
      setPermissions:  (permissions)   => set({ permissions }),
    }),
    {
      name:    'agro_app',
      partialize: (s) => ({
        token:        s.token,
        user:         s.user,
        company:      s.company,
        role:         s.role,
        permissions:  s.permissions,
        activeSeason: s.activeSeason,
      }),
    }
  )
)

// Selectors
export const useIsAuth     = ()  => !!useAppStore(s => s.token)
export const useCompanyId  = ()  => useAppStore(s => s.company?.id)
export const useRole       = ()  => useAppStore(s => s.role)
export const usePermissions= ()  => useAppStore(s => s.permissions)
export const useSeasonId   = ()  => useAppStore(s => s.activeSeason?.id)

export const useAbility = (module: string, action: string) => {
  const permissions = usePermissions()
  const role = useRole()
  if (role === 'super_admin' || role === 'company_admin') return true
  return permissions.includes(`${module}.${action}`)
}
