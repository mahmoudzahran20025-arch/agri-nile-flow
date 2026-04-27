import { api, unwrap, paginatedUrl } from './core'

export const contractsApi = {
  listPurchase: (p?: { season_id?: number; status?: string }) =>
    unwrap(api.get<unknown[]>(paginatedUrl('/contracts/purchase', p ?? {}))),
  getPurchase:  (id: number) => unwrap(api.get(`/contracts/purchase/${id}`)),
  createPurchase: (body: unknown) => api.post('/contracts/purchase', body),
  updatePurchaseStatus: (id: number, status: string, paid_value?: number) =>
    api.patch(`/contracts/purchase/${id}/status`, { status, paid_value }),

  listSales:   (p?: { season_id?: number; status?: string }) =>
    unwrap(api.get<unknown[]>(paginatedUrl('/contracts/sales', p ?? {}))),
  createSales: (body: unknown) => api.post('/contracts/sales', body),
  updateSalesStatus: (id: number, status: string, advance_paid?: number) =>
    api.patch(`/contracts/sales/${id}/status`, { status, advance_paid }),
  receiveAdvance: (id: number, body: {
    amount: number; receipt_date: string; notes?: string
  }) => api.post<{ gl_entry_id: number | null; advance_paid: number }>(
    `/contracts/sales/${id}/receive-advance`, body
  ),
  listAdvances: (id: number) =>
    unwrap(api.get<unknown[]>(`/contracts/sales/${id}/advances`)),

  summary: (season_id?: number) =>
    unwrap(api.get(`/contracts/summary${season_id ? `?season_id=${season_id}` : ''}`)),
}
