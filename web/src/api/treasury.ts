import { api, unwrap, unwrapPaginated, paginatedUrl } from './core'

export const treasuryApi = {
  balance: () => unwrap(api.get<{ balance: number }>('/treasury/balance')),

  list: (p: {
    page?: number; size?: number; direction?: string
    month?: number; year?: number; status?: string; search?: string
  }) => unwrapPaginated<unknown>(api.get(paginatedUrl('/treasury/transactions', p))),

  create:   (body: unknown) => api.post('/treasury/transactions', body),
  post:     (id: number) =>
    unwrap(api.patch<{ success: boolean; balance: number }>(`/treasury/transactions/${id}/post`, {})),

  payments: (supplierCode?: number) =>
    unwrap(api.get(
      `/treasury/supplier-payments${supplierCode ? `?supplier_code=${supplierCode}` : ''}`
    )),

  partners:      () => unwrap(api.get('/treasury/partners')),
  createPartner: (body: unknown) => api.post('/treasury/partners', body),
  updatePartner: (id: number, body: unknown) => api.patch(`/treasury/partners/${id}`, body),
}
