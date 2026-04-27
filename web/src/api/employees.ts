import { api, unwrap } from './core'

export const employeesApi = {
  list:   (q?: string) =>
    unwrap(api.get<unknown[]>(`/employees${q ? `?q=${encodeURIComponent(q)}` : ''}`)),
  get:    (id: number) => unwrap(api.get(`/employees/${id}`)),
  create: (body: unknown) => api.post('/employees', body),
  update: (id: number, body: unknown) => api.patch(`/employees/${id}`, body),
}
