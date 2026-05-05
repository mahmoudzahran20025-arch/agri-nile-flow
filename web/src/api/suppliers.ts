import { api, unwrap, unwrapPaginated, paginatedUrl } from './core'

export const suppliersApi = {
  list: (p: { page?: number; size?: number; q?: string }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl('/suppliers', p))),

  get:    (code: number) => unwrap(api.get(`/suppliers/${code}`)),
  create: (body: unknown) => api.post('/suppliers', body),
  update: (code: number, body: unknown) => api.patch(`/suppliers/${code}`, body),

  summary: (code: number) =>
    unwrap(api.get<{
      invoices_count: number; draft_count: number; posted_count: number
      total_credit: number; total_debit: number; open_balance: number
      payments_count: number; payments_total: number
      gl_debit: number; gl_credit: number
    }>(`/suppliers/${code}/summary`)),

  statement: (code: number, p: { page?: number; size?: number; season_id?: number; month?: number }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl(`/suppliers/${code}/statement`, p))),

  addTransaction:  (code: number, body: unknown) =>
    api.post(`/suppliers/${code}/transactions`, body),
  postTransaction: (code: number, id: number) =>
    unwrap(api.patch<null>(`/suppliers/${code}/transactions/${id}/post`, {})),
  deleteTransaction: (code: number, id: number) =>
    unwrap(api.delete<null>(`/suppliers/${code}/transactions/${id}`)),

  aging: (asOf?: string) =>
    unwrap(api.get(`/suppliers/aging${asOf ? `?as_of=${asOf}` : ''}`)),
}
