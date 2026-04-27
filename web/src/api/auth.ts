import { api, unwrap } from './core'

export interface RbacMatrix {
  roles:       string[]
  permissions: { key: string; module: string; action: string }[]
  modules:     string[]
  matrix:      { role: string; permissions: Record<string, boolean> }[]
}

export const authApi = {
  companies: (email: string) =>
    unwrap(api.get<{ id: number; code: string; name: string }[]>(
      `/auth/companies?email=${encodeURIComponent(email)}`
    )),

  login: (email: string, password: string, company_id: number) =>
    api.post<{
      token: string
      user: { id: number; full_name: string; email: string; company_id: number; role: string }
      permissions: string[]
    }>('/auth/login', { email, password, company_id }),

  me: () =>
    unwrap(api.get<{
      user: { id: number; email: string; full_name: string }
      company: { id: number; code: string; name: string }
      role: string
      permissions: string[]
    }>('/auth/me')),

  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),

  rbacMatrix: () => unwrap(api.get<RbacMatrix>('/auth/rbac-matrix')),
}
