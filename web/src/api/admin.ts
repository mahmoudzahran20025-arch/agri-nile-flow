import { api, unwrap } from './core'

export interface CompanyOverview {
  id: number; code: string; name: string; is_active: number
  cash_balance:    number | null
  active_season:   string | null; season_status: string | null
  open_wo:         number; open_po_count: number; open_po_value: number
  employee_count:  number; low_stock_count: number
  last_activity:   string | null; health_score: number
}

export interface SwitchedUser {
  id:         number
  email:      string
  full_name:  string
  role:       string
  company_id: number
}

export interface SwitchedCompany {
  id:   number
  code: string
  name: string
}

export interface AdminSwitchPayload {
  token:       string
  user:        SwitchedUser
  company:     SwitchedCompany
  permissions: string[]
}

export const adminApi = {
  companies:     () => unwrap(api.get<unknown[]>('/admin/companies')),

  // Used by the onboarding wizard (full unwrapped response)
  createCompany: (body: { code: string; name: string; address?: string; phone?: string; fiscal_year?: number }) =>
    unwrap(api.post<{ id: number; seeding: Record<string, number | string> }>('/admin/companies', body)),

  // Legacy raw form used by SuperAdminPage quick-add modal
  createCompanyRaw: (body: unknown) => api.post('/admin/companies', body),

  updateCompany: (id: number, body: unknown) => api.patch(`/admin/companies/${id}`, body),

  seedServiceTypes: (id: number) =>
    unwrap(api.post<{ company_id: number; seeded: number }>(`/admin/companies/${id}/seed-service-types`, {})),

  inviteUser: (id: number, body: { email: string; full_name: string; role?: string }) =>
    unwrap(api.post<{ user_id: number; company_id: number; role: string; created_new_user: boolean }>(
      `/admin/companies/${id}/invite-user`, body
    )),

  switchCompany: async (
    companyId: number,
    setAuth: (
      token: string,
      user: SwitchedUser,
      company: SwitchedCompany,
      role: string,
      permissions: string[],
    ) => void,
  ) => {
    const res = await api.post<AdminSwitchPayload>(`/admin/switch/${companyId}`, {})
    if (res.success) {
      const d = res.data
      setAuth(d.token, d.user, d.company, d.user.role, d.permissions ?? [])
    }
    return res
  },

  companyUsers: (id: number) => unwrap(api.get<unknown[]>(`/admin/companies/${id}/users`)),
  overview:     () => unwrap(api.get<CompanyOverview[]>('/admin/overview')),
}
