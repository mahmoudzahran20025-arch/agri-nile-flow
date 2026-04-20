import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Company, Season } from '../types'

interface AppState {
  // Auth
  token:      string | null
  user:       User   | null
  company:    Company | null
  role:       string | null

  // Active filters (global — all modules respect these)
  activeSeason: Season | null
  seasons:      Season[]

  // Actions
  setAuth:        (token: string, user: User, company: Company, role: string) => void
  logout:         () => void
  setSeasons:     (seasons: Season[]) => void
  setActiveSeason:(season: Season | null) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token:        null,
      user:         null,
      company:      null,
      role:         null,
      activeSeason: null,
      seasons:      [],

      setAuth: (token, user, company, role) => {
        localStorage.setItem('agro_token', token)
        set({ token, user, company, role })
      },

      logout: () => {
        localStorage.removeItem('agro_token')
        set({ token: null, user: null, company: null, role: null, activeSeason: null, seasons: [] })
      },

      setSeasons:      (seasons)       => set({ seasons }),
      setActiveSeason: (activeSeason)  => set({ activeSeason }),
    }),
    {
      name:    'agro_app',
      partialize: (s) => ({
        token:        s.token,
        user:         s.user,
        company:      s.company,
        role:         s.role,
        activeSeason: s.activeSeason,
      }),
    }
  )
)

// Selectors
export const useIsAuth     = ()  => !!useAppStore(s => s.token)
export const useCompanyId  = ()  => useAppStore(s => s.company?.id)
export const useRole       = ()  => useAppStore(s => s.role)
export const useSeasonId   = ()  => useAppStore(s => s.activeSeason?.id)
