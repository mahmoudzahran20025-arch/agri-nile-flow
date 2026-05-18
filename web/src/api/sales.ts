import { api, unwrap } from './client'

export interface SaleItem {
  item_code:    number
  quantity:     number
  unit_price:   number
  discount_pct?: number
}

export interface CreateSaleBody {
  sale_date:       string
  warehouse_id:    number
  customer_id?:    number
  payment_method?: 'cash' | 'card' | 'credit'
  session_id?:     number
  branch_id?:      number
  notes?:          string
  items:           SaleItem[]
}

export interface SaleOrder {
  id:             number
  company_id:     number
  session_id:     number | null
  branch_id:      number | null
  warehouse_id:   number
  customer_id:    number
  order_date:     string
  subtotal:       number
  tax_amount:     number
  total:          number
  payment_method: 'cash' | 'card' | 'credit'
  status:         'open' | 'paid' | 'voided'
  notes:          string | null
  created_at:     string
  customer_name:  string | null
  customer_code:  string | null
  warehouse_name: string | null
}

export interface SaleOrderItem {
  id:           number
  order_id:     number
  company_id:   number
  item_code:    number
  quantity:     number
  unit_price:   number
  discount_pct: number
  line_total:   number
  item_name:    string | null
  unit:         string | null
}

export interface SaleOrderDetail extends SaleOrder {
  items: SaleOrderItem[]
}

export interface DailyPaymentBreakdown {
  payment_method: string
  order_count:    number
  revenue:        number
}

export interface DailyHourBreakdown {
  hour:        string
  order_count: number
  revenue:     number
}

export interface DailySummary {
  date:         string
  branch_id:    number | null
  gross_sales:  number
  voided_total: number
  net_sales:    number
  order_count:  number
  voided_count: number
  by_payment:   DailyPaymentBreakdown[]
  by_hour:      DailyHourBreakdown[]
}

export interface SalesTrendRow {
  period_label:  string
  order_count:   number
  revenue:       number
  subtotal:      number
  tax_amount:    number
  voided_count:  number
}

export interface SalesTopItem {
  item_code:     number
  item_name:     string | null
  unit:          string | null
  order_count:   number
  total_qty:     number
  total_revenue: number
  avg_price:     number
}

export interface SalesReturnsTrendRow {
  period_label:  string
  return_count:  number
  return_total:  number
}

export interface SalesAnalytics {
  period:       'daily' | 'monthly'
  date_from:    string
  date_to:      string
  summary: {
    total_revenue:   number
    total_orders:    number
    total_returns:   number
    net_revenue:     number
    avg_order_value: number
  }
  trend:         SalesTrendRow[]
  top_items:     SalesTopItem[]
  returns_trend: SalesReturnsTrendRow[]
}

export interface SalesReturnRow {
  id:                number
  original_order_id: number
  return_date:       string
  subtotal:          number
  total:             number
  refund_method:     'cash' | 'card' | 'store_credit' | 'credit_adjustment'
  reason:            string | null
  journal_entry_id:  number | null
  created_at:        string
  customer_name:     string | null
  customer_code:     string | null
}

export interface CreateReturnBody {
  original_order_id: number
  items: Array<{ item_code: number; quantity: number; unit_price: number }>
  refund_method?: 'cash' | 'card' | 'store_credit' | 'credit_adjustment'
  reason?: string
  notes?: string
  return_date?: string
}

export const salesApi = {
  createSale: (body: CreateSaleBody) =>
    unwrap(api.post<{ order_id: number; total: number; subtotal: number; tax_amount: number; movement_ids: number[] }>('/sales', body)),

  listSales: (params?: { page?: number; size?: number; date_from?: string; date_to?: string; status?: string }) => {
    const qs = new URLSearchParams()
    if (params?.page)      qs.set('page',      String(params.page))
    if (params?.size)      qs.set('size',       String(params.size))
    if (params?.date_from) qs.set('date_from',  params.date_from)
    if (params?.date_to)   qs.set('date_to',    params.date_to)
    if (params?.status)    qs.set('status',     params.status)
    const q = qs.toString()
    return unwrap(api.get<SaleOrder[]>(`/sales${q ? `?${q}` : ''}`))
  },

  getSale: (id: number) =>
    unwrap(api.get<SaleOrderDetail>(`/sales/${id}`)),

  voidSale: (id: number) =>
    unwrap(api.patch<{ voided: boolean; order_id: number }>(`/sales/${id}/void`, {})),

  getAnalytics: (params?: { period?: 'daily' | 'monthly'; date_from?: string; date_to?: string; top_n?: number }) => {
    const qs = new URLSearchParams()
    if (params?.period)    qs.set('period',    params.period)
    if (params?.date_from) qs.set('date_from', params.date_from)
    if (params?.date_to)   qs.set('date_to',   params.date_to)
    if (params?.top_n)     qs.set('top_n',     String(params.top_n))
    const q = qs.toString()
    return unwrap(api.get<SalesAnalytics>(`/sales/analytics${q ? `?${q}` : ''}`))
  },

  getDailySummary: (params?: { date?: string; branch_id?: number }) => {
    const qs = new URLSearchParams()
    if (params?.date)      qs.set('date',      params.date)
    if (params?.branch_id) qs.set('branch_id', String(params.branch_id))
    const q = qs.toString()
    return unwrap(api.get<DailySummary>(`/sales/daily${q ? `?${q}` : ''}`))
  },

  listReturns: (params?: { page?: number; size?: number; order_id?: number; start?: string; end?: string }) => {
    const qs = new URLSearchParams()
    if (params?.page)     qs.set('page',     String(params.page))
    if (params?.size)     qs.set('size',      String(params.size))
    if (params?.order_id) qs.set('order_id', String(params.order_id))
    if (params?.start)    qs.set('start',    params.start)
    if (params?.end)      qs.set('end',      params.end)
    const q = qs.toString()
    return unwrap(api.get<{ total: number; page: number; size: number; rows: SalesReturnRow[] }>(`/sales/returns${q ? `?${q}` : ''}`))
  },

  createReturn: (body: CreateReturnBody) =>
    unwrap(api.post<{ return_id: number; order_id: number; total: number; refund_method: string; gl_entry_id: number | null; gl_orphan_warning: string | null }>('/sales/returns', body)),
}
