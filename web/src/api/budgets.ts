import { api, unwrap } from './core'

export const budgetsApi = {
  list: (season_id?: number) =>
    unwrap(api.get<unknown[]>(`/budgets${season_id ? `?season_id=${season_id}` : ''}`)),
  upsert: (body: {
    field_id: number; season_id: number; budget_per_feddan: number; notes?: string
  }) => api.post('/budgets', body),
  remove: (id: number) => api.delete(`/budgets/${id}`),
}
