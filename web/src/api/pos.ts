import { api, unwrap } from './client'

export interface PosSession {
  id:              number
  company_id:      number
  branch_id:       number | null
  cashier_user_id: number
  opened_at:       string
  closed_at:       string | null
  opening_float:   number
  closing_count:   number | null
  status:          'open' | 'closed' | 'reconciled'
  cashier_name:    string | null
  branch_name:     string | null
}

export interface PosReceiptLine {
  item_code:  number
  item_name:  string
  unit:       string | null
  qty:        number
  unit_price: number
  discount:   number
  total:      number
}

export interface PosReceipt {
  date:       string
  cashier:    number
  lines:      PosReceiptLine[]
  subtotal:   number
  tax:        number
  total:      number
  tendered:   number | null
  change:     number | null
}

export interface PosSaleResult {
  order_id:       number
  session_id:     number
  subtotal:       number
  tax_amount:     number
  total:          number
  tendered:       number | null
  change:         number | null
  payment_method: string
  movement_ids:   number[]
  receipt:        PosReceipt
}

export const posApi = {
  openSession: (body: { branch_id?: number; opening_float?: number }) =>
    unwrap(api.post<{ session_id: number; opened_at: string }>('/pos/sessions', body)),

  listSessions: (params?: { status?: string; branch_id?: number }) => {
    const qs = new URLSearchParams()
    if (params?.status)    qs.set('status',    params.status)
    if (params?.branch_id) qs.set('branch_id', String(params.branch_id))
    const q = qs.toString()
    return unwrap(api.get<PosSession[]>(`/pos/sessions${q ? `?${q}` : ''}`))
  },

  closeSession: (id: number, closing_count?: number) =>
    unwrap(api.patch<{ session_id: number; status: string }>(`/pos/sessions/${id}/close`, { closing_count })),

  createSale: (body: {
    session_id:      number
    warehouse_id:    number
    customer_id?:    number
    payment_method?: 'cash' | 'card' | 'credit'
    tendered?:       number
    notes?:          string
    items: Array<{
      item_code:     number
      quantity:      number
      unit_price?:   number
      discount_pct?: number
    }>
  }) => unwrap(api.post<PosSaleResult>('/pos/sales', body)),

  getSessionSummary: (id: number) =>
    unwrap(api.get<{
      session: PosSession & { cashier_name: string | null; branch_name: string | null }
      totals: {
        gross_sales:    number
        voided_total:   number
        cash_sales:     number
        card_sales:     number
        credit_sales:   number
      }
      order_count: number
    }>(`/pos/sessions/${id}/summary`)),
}
