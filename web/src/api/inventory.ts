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
}
