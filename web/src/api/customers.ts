import { api, unwrap } from './client'

export interface Customer {
  id:           number
  code:         string
  name:         string
  phone:        string | null
  credit_limit: number
  balance:      number
  is_active:    number
  created_at:   string
  tier_id:      number | null
  tier_name:    string | null
  order_count?: number
}

export interface CustomerListResponse {
  data:  Customer[]
  total: number
}

export interface CustomerLedgerOrder {
  id:             number
  order_date:     string
  subtotal:       number
  tax_amount:     number
  total:          number
  payment_method: string | null
  status:         string
  notes:          string | null
}

export interface CustomerLedgerResponse {
  summary: {
    order_count:  number
    total_spent:  number
    voided_count: number
  } | null
  orders: CustomerLedgerOrder[]
}

export const customersApi = {
  list: (params?: { q?: string; tier_id?: number; is_active?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.q)                        qs.set('q',         params.q)
    if (params?.tier_id != null)          qs.set('tier_id',   String(params.tier_id))
    if (params?.is_active != null)        qs.set('is_active', params.is_active)
    if (params?.limit != null)            qs.set('limit',     String(params.limit))
    if (params?.offset != null)           qs.set('offset',    String(params.offset))
    const q = qs.toString()
    return unwrap(api.get<CustomerListResponse>(`/customers${q ? `?${q}` : ''}`))
  },

  get: (id: number) =>
    unwrap(api.get<Customer>(`/customers/${id}`)),

  create: (body: { code: string; name: string; phone?: string; credit_limit?: number; tier_id?: number | null }) =>
    unwrap(api.post<{ success: boolean; id: number }>('/customers', body)),

  update: (id: number, body: { name?: string; phone?: string | null; credit_limit?: number; tier_id?: number | null; is_active?: 0 | 1 }) =>
    unwrap(api.patch<{ success: boolean }>(`/customers/${id}`, body)),

  remove: (id: number) =>
    unwrap(api.delete<{ success: boolean }>(`/customers/${id}`)),

  getLedger: (id: number, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.limit != null)  qs.set('limit',  String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    const q = qs.toString()
    return unwrap(api.get<CustomerLedgerResponse>(`/customers/${id}/ledger${q ? `?${q}` : ''}`))
  },
}
