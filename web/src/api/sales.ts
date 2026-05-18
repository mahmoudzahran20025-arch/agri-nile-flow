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

  getDailySummary: (params?: { date?: string; branch_id?: number }) => {
    const qs = new URLSearchParams()
    if (params?.date)      qs.set('date',      params.date)
    if (params?.branch_id) qs.set('branch_id', String(params.branch_id))
    const q = qs.toString()
    return unwrap(api.get<DailySummary>(`/sales/daily${q ? `?${q}` : ''}`))
  },
}
