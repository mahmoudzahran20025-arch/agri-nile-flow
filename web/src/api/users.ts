import { api, unwrap } from './core'

export const usersApi = {
  list:   () => unwrap(api.get<unknown[]>('/users')),
  create: (body: unknown) => api.post('/users', body),
  update: (id: number, body: unknown) => api.patch(`/users/${id}`, body),
}
