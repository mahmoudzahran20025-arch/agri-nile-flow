import { api, unwrap, unwrapPaginated, paginatedUrl } from './core'

export const inventoryApi = {
  balances: (warehouse?: string | number) => {
    const q = typeof warehouse === 'number'
      ? `warehouse_id=${warehouse}`
      : `warehouse=${encodeURIComponent(String(warehouse || ''))}`
    return unwrap(api.get<unknown[]>(`/inventory/balances${warehouse ? `?${q}` : ''}`))
  },

  warehouses:      () => unwrap(api.get<string[]>('/inventory/warehouses')),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warehousesSetup: () => api.get<{ success: boolean; data: string[]; entities: any[] }>('/inventory/warehouses'),
  createWarehouse: (body: unknown) => api.post('/inventory/warehouses', body),

  reorderAlerts: () =>
    unwrap(api.get<Array<{
      item_code: number; item_name: string; unit: string | null
      current_balance: number; consumed_active_orders: number
      consumption_pct: number; active_order_count: number
    }>>('/inventory/reorder-alerts')),

  list: (p: {
    page?: number; size?: number; warehouse?: string; item_code?: number
    type?: string; start?: string; end?: string
    field_id?: number; season_id?: number; work_order_id?: number
  }) => unwrapPaginated<unknown>(api.get(paginatedUrl('/inventory/movements', p))),

  create: (body: unknown) => api.post('/inventory/movements', body),

  createBatch: (body: {
    movement_date:    string
    warehouse:        string
    movement_type:    string
    supplier_code?:   number
    document_number?: number
    season_id?:       number
    field_id?:        number
    work_order_id?:   number
    notes?:           string
    payment_method?:  'cash' | 'credit'
    center_code?:     number
    items: Array<{ item_code: number; quantity: number; unit_price?: number; notes?: string }>
  }) => api.post('/inventory/movements/batch', body),

  transfer: (body: {
    movement_date: string; item_code: number; quantity: number
    from_warehouse: string; to_warehouse: string; notes?: string
  }) => api.post('/inventory/movements/transfer', body),

  transferBatch: (body: {
    movement_date: string; from_warehouse: string; to_warehouse: string; notes?: string
    items: Array<{ item_code: number; quantity: number }>
  }) => api.post('/inventory/movements/transfer-batch', body),

  costByField: (season_id?: number) =>
    unwrap(api.get<unknown[]>(`/inventory/cost-by-field${season_id ? `?season_id=${season_id}` : ''}`)),

  itemStock: (code: number, warehouse?: string) =>
    unwrap(api.get<{ by_warehouse: unknown[]; total_qty: number; total_value: number; avg_cost: number }>(
      `/inventory/item/${code}/stock${warehouse ? `?warehouse=${encodeURIComponent(warehouse)}` : ''}`
    )),

  itemCard: (code: number, warehouse?: string) =>
    unwrap(api.get(
      `/inventory/item/${code}/card${warehouse ? `?warehouse=${encodeURIComponent(warehouse)}` : ''}`
    )),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  categories:       () => unwrap(api.get<any[]>('/inventory/categories')),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCategory:   (body: any) => api.post('/inventory/categories', body),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adjustments:      () => unwrap(api.get<any[]>('/inventory/adjustments')),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adjustmentDetail: (id: number) => unwrap(api.get<any>(`/inventory/adjustments/${id}`)),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createAdjustment: (body: any) => api.post('/inventory/adjustments', body),
  postAdjustment:   (id: number) => api.post(`/inventory/adjustments/${id}/post`, {}),

  // ── Governance / Financial Integrity ────────────────────────────────────

  glPreview: (body: {
    warehouse:       string
    item_code:       number
    movement_type:   'اضافة' | 'صرف'
    quantity:        number
    unit_price?:     number
    payment_method?: 'cash' | 'credit'
    center_code?:    number
  }) => unwrap(api.post<{
    item_name:   string
    item_unit:   string | null
    ipg:         string | null
    ppg:         string | null
    unit_price:  number
    value:       number
    is_balanced: boolean
    warnings:    string[]
    lines: Array<{
      side:          'DR' | 'CR'
      account_code:  string
      account_label: string
      amount:        number
      narration:     string
    }>
  }>('/inventory/gl-preview', body)),

  itemsMaster: () => unwrap(api.get<Array<{
    code:                    number
    name:                    string
    unit:                    string | null
    category_id:             number | null
    prod_posting_group_code: string | null
    inv_posting_group_code:  string | null
    standard_cost:           number | null
    reorder_threshold:       number | null
    category_name:           string | null
    total_qty:               number
    total_value:             number
    warehouse_count:         number
  }>>('/inventory/items-master')),

  updateItemMaster: (code: number, body: {
    prod_posting_group_code?: string | null
    inv_posting_group_code?:  string | null
    standard_cost?:           number | null
    reorder_threshold?:       number | null
    name?:                    string
    unit?:                    string
  }) => api.patch(`/inventory/items-master/${code}`, body),

  postingHealth: () => unwrap(api.get<{
    data: Array<{
      warehouse:         string
      ipg:               string | null
      ppg:               string | null
      movement_count:    number
      total_value:       number
      has_exact_setup:   boolean
      has_fallback_setup: boolean
      is_covered:        boolean
      gaps:              string[]
    }>
    summary: {
      total_combos:  number
      covered:       number
      exact_setup:   number
      missing_setup: number
      health_pct:    number
    }
  }>('/inventory/posting-health')),
}
