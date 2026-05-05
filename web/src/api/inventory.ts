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

  createBatch: (body: {
    movement_date:    string
    warehouse:        string
    movement_type:    string
    supplier_code?:   number
    document_number?: number
    field_id?:        number
    work_order_id?:   number
    notes?:           string
    payment_method?:  'cash' | 'credit'
    center_code?:     number
    items: Array<{ item_code: number; quantity: number; unit_price?: number; notes?: string }>
  }) => api.post('/inventory/movements/batch', body),

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveAdjustmentLines: (id: number, lines: any[]) => api.put(`/inventory/adjustments/${id}/lines`, { lines }),
  postAdjustment:   (id: number) => api.post(`/inventory/adjustments/${id}/post`, {}),

  // ── Governance / Financial Integrity ────────────────────────────────────

  glPreview: (body: {
    warehouse:       string
    item_code:       number
    movement_type:   'GRN' | 'ISSUE' | 'RETURN_SUPPLIER' | 'RETURN_CUSTOMER' | 'ADJUSTMENT_PROFIT' | 'ADJUSTMENT_LOSS' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'PRODUCTION_INPUT' | 'PRODUCTION_OUTPUT'
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

  itemsMaster: async (params?: {
    page?: number
    size?: number
    search?: string
    filter_status?: 'all' | 'missing_ppg' | 'missing_ipg' | 'below_reorder'
  }): Promise<{
    data: Array<{
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
    }>
    total:      number
    page:       number
    page_size:  number
    page_count: number
  }> => {
    const q = new URLSearchParams()
    if (params?.page)          q.set('page',          String(params.page))
    if (params?.size)          q.set('size',          String(params.size))
    if (params?.search)        q.set('search',        params.search)
    if (params?.filter_status) q.set('filter_status', params.filter_status)
    const qs = q.toString()
    // Backend returns pagination fields (total, page, page_count) at top level
    // alongside data[], so we bypass unwrap and return the full response body.
    const raw = await api.get<unknown>(`/inventory/items-master${qs ? `?${qs}` : ''}`)
    if (!raw.success) throw new Error((raw as { error?: string }).error || 'API error')
    return raw as unknown as {
      data: Array<{
        code: number; name: string; unit: string | null; category_id: number | null
        prod_posting_group_code: string | null; inv_posting_group_code: string | null
        standard_cost: number | null; reorder_threshold: number | null
        category_name: string | null; total_qty: number; total_value: number; warehouse_count: number
      }>
      total: number; page: number; page_size: number; page_count: number
    }
  },

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

  healthSummary: () => unwrap(api.get<{
    movement: {
      total: number
      unlinked_total: number
      unlinked_non_zero: number
      unlinked_zero: number
    }
    posting: {
      total_combos: number
      covered: number
      missing_setup: number
      health_pct: number
    }
    item_risk: {
      active_items: number
      items_without_standard_cost: number
      items_without_ppg: number
      items_without_ipg: number
      items_without_reorder_threshold: number
      below_reorder_count: number
    }
    stock_risk: {
      negative_balance_rows: number
      negative_balance_items: number
    }
    generated_at: string
  }>('/inventory/health-summary')),

  // ── Phase 4: Transaction Headers ────────────────────────────────────────

  transactions: (p: {
    transaction_type?: string; warehouse?: string
    start?: string; end?: string; page?: number; size?: number
    work_order_id?: number; gl_posting_status?: string
  } = {}) =>
    unwrapPaginated<{
      id: number; transaction_type: string; document_number: number | null
      movement_date: string; warehouse: string; to_warehouse: string | null
      notes: string | null; status: string
      line_count: number; total_qty: number; total_value: number
      created_by_user_id: string | null; created_at: string
      unposted_lines: number
    }>(api.get(paginatedUrl('/inventory/transactions', p))),

  transactionsSummary: (p: {
    transaction_type?: string; warehouse?: string
    start?: string; end?: string; work_order_id?: number; gl_posting_status?: string
  } = {}) =>
    unwrap(api.get<Array<{
      transaction_type: string
      doc_count: number; total_lines: number
      total_qty: number; total_value: number
    }>>(paginatedUrl('/inventory/transactions/summary', p))),

  glTrace: (p: { status?: string; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (p.status) params.set('status', p.status)
    if (p.limit)  params.set('limit', String(p.limit))
    const qs = params.toString()
    return unwrap(api.get<{
      summary: {
        ghost_posted: number; pending: number; failed: number
        exempt: number; clean_posted: number; total: number
        traceability_pct: number
      }
      filter: string
      rows: Array<{
        id: number; movement_date: string; warehouse: string; movement_type: string
        item_code: number; item_name: string | null; quantity: number; unit_price: number
        value_in: number; value_out: number; gl_posting_status: string
        journal_entry_id: number | null; gl_posting_error: string | null; gl_posted_at: string | null
        transaction_id: number | null; document_number: string | null; supplier_code: number | null
        zero_value_reason: string | null; outbox_status: string | null; outbox_attempts: number | null
        outbox_last_error: string | null; outbox_updated_at: string | null
        je_number: string | null; je_date: string | null; je_description: string | null
      }>
    }>(`/inventory/gl-trace${qs ? '?' + qs : ''}`))
  },

  // ── Phase 4: Inventory Balances ─────────────────────────────────────────────

  balancesList: async (p: {
    page?: number; size?: number; warehouse?: string; search?: string; stale?: boolean
  } = {}): Promise<{
    data: Array<{
      item_code: number; item_name: string | null; unit: string | null
      category_id: number | null; ppg: string | null; ipg: string | null
      standard_cost: number | null; reorder_threshold: number | null
      warehouse: string; balance_qty: number; balance_value: number
      is_stale: number; updated_at: string | null
    }>
    warehouses: string[]
    pagination: { page: number; size: number; total: number; pages: number }
    stale_count: number
  }> => {
    const params = new URLSearchParams()
    if (p.page)      params.set('page',      String(p.page))
    if (p.size)      params.set('size',      String(p.size))
    if (p.warehouse) params.set('warehouse', p.warehouse)
    if (p.search)    params.set('search',    p.search)
    if (p.stale)     params.set('stale',     '1')
    const qs = params.toString()
    // The backend returns { success, data: rows[], warehouses, pagination, stale_count }
    // We must NOT unwrap() here — unwrap() would strip to just res.data (the rows array),
    // breaking all consumers that access balancesResp?.data, .warehouses, .pagination.
    const res = await api.get<unknown>(`/inventory/stock-balances${qs ? '?' + qs : ''}`) as {
      success: boolean; error?: string
      data: Array<{
        item_code: number; item_name: string | null; unit: string | null
        category_id: number | null; ppg: string | null; ipg: string | null
        standard_cost: number | null; reorder_threshold: number | null
        warehouse: string; balance_qty: number; balance_value: number
        is_stale: number; updated_at: string | null
      }>
      warehouses: string[]
      pagination: { page: number; size: number; total: number; pages: number }
      stale_count: number
    }
    if (!res.success) throw new Error(res.error || 'API error')
    return res
  },

  balanceItem: (code: number) =>
    unwrap(api.get<{
      item: {
        code: number; name: string; unit: string | null; category_id: number | null
        prod_posting_group_code: string | null; inv_posting_group_code: string | null
        standard_cost: number | null; reorder_threshold: number | null
      }
      by_warehouse: Array<{
        warehouse: string; balance_qty: number; balance_value: number
        is_stale: number; updated_at: string | null
      }>
      totals: { total_qty: number; total_value: number; avg_cost: number }
      recent_movements: Array<{
        movement_date: string; movement_type: string; warehouse: string
        quantity: number; unit_price: number; gl_posting_status: string
      }>
    }>(`/inventory/balances/${code}`)),

  resolveGlTrace: (id: number, action: 'exempt' | 'retry', reason?: string) =>
    unwrap(api.post<{ action: string; movement_id: number; outbox?: string }>(
      `/inventory/gl-trace/${id}/resolve`, { action, reason }
    )),

  transactionDetail: (id: number) =>
    unwrap(api.get<{
      id: number; transaction_type: string; document_number: number | null
      movement_date: string; warehouse: string; to_warehouse: string | null
      notes: string | null; status: string
      line_count: number; total_qty: number; total_value: number
      created_by_user_id: string | null; created_at: string
      lines: Array<{
        id: number; item_code: number; item_name: string | null; unit: string | null
        warehouse: string; movement_type: string
        quantity: number; unit_price: number | null
        qty_in: number; qty_out: number; balance_qty: number
        value_in: number; value_out: number; balance_value: number
        gl_posting_status: string | null; journal_entry_id: number | null
        movement_date: string; notes: string | null
      }>
    }>(`/inventory/transactions/${id}`)),
}
