import { api, unwrap, unwrapPaginated, paginatedUrl } from './core'

export const treasuryApi = {
  balance: (account_id?: number) =>
    unwrap(api.get<{ balance: number }>(`/treasury/balance${account_id ? `?account_id=${account_id}` : ''}`)),

  list: (p: {
    page?: number; size?: number; direction?: string
    month?: number; year?: number; status?: string; search?: string
    account_id?: number; supplier_code?: number; expense_code?: number
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

  /* Cross-module finance dashboard */
  apAging: () =>
    unwrap(api.get<{
      buckets: Array<{ label: string; total: number; count: number }>
      total: number
      overdue: number
    }>('/treasury/ap-aging')),

  bankBalances: () =>
    unwrap(api.get<Array<{ id: number; name: string; balance: number; currency: string }>>('/treasury/bank-balances')),
}
