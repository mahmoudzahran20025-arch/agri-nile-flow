import type { ApiResult, DashboardStats } from '../types'

const BASE = window.location.hostname.endsWith('pages.dev') 
  ? 'https://agri-nile-flow.mahm-zahran22.workers.dev/api' 
  : '/api'

function getToken(): string | null {
  return localStorage.getItem('agro_token')
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const token = getToken()
  const url = `${BASE}${path}`
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  // Debug logging
  console.log(`🌐 [API] ${options.method || 'GET'} ${path}`)
  if (!token) console.warn(`⚠️ [API] No token found for ${path}`)

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    })

    console.log(`📡 [API Response] ${path}:`, res.status, res.statusText)

    if (!res.ok) {
      console.error(`❌ [API Error] ${path}: HTTP ${res.status}`)
    }

    const json = await res.json() as ApiResult<T>
    
    if (!json.success) {
      console.error(`❌ [API Error] ${path}: ${json.error}`)
    }

    return json
  } catch (error) {
    console.error(`💥 [API Exception] ${path}:`, error)
    throw error
  }
}

export const api = {
  get:    <T>(path: string) =>
    request<T>(path),

  post:   <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  patch:  <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

  put:    <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
}

// ─── Typed helpers ────────────────────────────────────────────
export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  try {
    const res = await promise
    if (!res.success) {
      console.error(`❌ [unwrap] API returned error: ${res.error}`)
      throw new Error(res.error || 'API returned success=false')
    }
    if (!res.data) {
      console.warn(`⚠️ [unwrap] API response has no data, returning empty`)
    }
    console.log(`✅ [unwrap] Success, data:`, res.data)
    return res.data
  } catch (error) {
    console.error(`💥 [unwrap] Exception:`, error)
    throw error
  }
}

// For paginated endpoints: backend puts total/page/has_more at the TOP LEVEL of the JSON
// alongside `data`. unwrap() would throw those away; this helper preserves them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function unwrapPaginated<T>(promise: Promise<any>): Promise<{
  data: T[]; total: number; page: number; page_size: number; has_more: boolean
}> {
  const raw = await promise
  if (!raw.success) throw new Error(raw.error || 'API error')
  return {
    data:      raw.data      ?? [],
    total:     raw.total     ?? 0,
    page:      raw.page      ?? 1,
    page_size: raw.page_size ?? 50,
    has_more:  raw.has_more  ?? false,
  }
}

export function paginatedUrl(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  return `${base}?${q.toString()}`
}

// ─── Auth ─────────────────────────────────────────────────────
export const authApi = {
  companies: (email: string) =>
    unwrap(api.get<{ id: number; code: string; name: string }[]>(`/auth/companies?email=${encodeURIComponent(email)}`)),

  login: (email: string, password: string, company_id: number) =>
    api.post<{ token: string; user: { id: number; full_name: string; email: string; company_id: number; role: string }; permissions: string[] }>('/auth/login', { email, password, company_id }),

  me: () =>
    unwrap(api.get<{ user: { id: number; email: string; full_name: string }; company: { id: number; code: string; name: string }; role: string; permissions: string[] }>('/auth/me')),

  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),

  rbacMatrix: () => unwrap(api.get<RbacMatrix>('/auth/rbac-matrix')),
}

// ─── Dashboard ────────────────────────────────────────────────
export const dashboardApi = {
  stats:             () => unwrap(api.get<DashboardStats>('/dashboard/stats')),
  monthlyCashflow:   (months = 12) => unwrap(api.get(`/dashboard/monthly-cashflow?months=${months}`)),
  costByCrop:        (seasonId?: number) => unwrap(api.get(`/dashboard/cost-by-crop${seasonId ? `?season_id=${seasonId}` : ''}`)),
  recentTransactions:(limit = 15) => unwrap(api.get(`/dashboard/recent-transactions?limit=${limit}`)),
  inventoryAlerts:   () => unwrap(api.get('/dashboard/inventory-alerts')),
}

// ─── Suppliers ────────────────────────────────────────────────
export const suppliersApi = {
  list:       (p: { page?: number; size?: number; q?: string }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl('/suppliers', p))),
  get:        (code: number) => unwrap(api.get(`/suppliers/${code}`)),
  create:     (body: unknown) => api.post('/suppliers', body),
  update:     (code: number, body: unknown) => api.patch(`/suppliers/${code}`, body),
  summary:    (code: number) => unwrap(api.get<{
    invoices_count: number; draft_count: number; posted_count: number
    total_credit: number; total_debit: number; open_balance: number
    payments_count: number; payments_total: number
    gl_debit: number; gl_credit: number
  }>(`/suppliers/${code}/summary`)),
  statement:  (code: number, p: { page?: number; size?: number; season_id?: number; month?: number }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl(`/suppliers/${code}/statement`, p))),
  addTransaction: (code: number, body: unknown) => api.post(`/suppliers/${code}/transactions`, body),
  postTransaction:(code: number, id: number) => unwrap(api.patch<null>(`/suppliers/${code}/transactions/${id}/post`, {})),
  aging:      (asOf?: string) => unwrap(api.get(`/suppliers/aging${asOf ? `?as_of=${asOf}` : ''}`)),
}

// ─── Treasury ─────────────────────────────────────────────────
export const treasuryApi = {
  balance:        () => unwrap(api.get<{ balance: number }>('/treasury/balance')),
  list:           (p: { page?: number; size?: number; direction?: string; month?: number; year?: number; status?: string; search?: string }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl('/treasury/transactions', p))),
  create:         (body: unknown) => api.post('/treasury/transactions', body),
  post:           (id: number) => unwrap(api.patch<{ success: boolean; balance: number }>(`/treasury/transactions/${id}/post`, {})),
  payments:       (supplierCode?: number) =>
    unwrap(api.get(`/treasury/supplier-payments${supplierCode ? `?supplier_code=${supplierCode}` : ''}`)),
  partners:       () => unwrap(api.get('/treasury/partners')),
  createPartner:  (body: unknown) => api.post('/treasury/partners', body),
  updatePartner:  (id: number, body: unknown) => api.patch(`/treasury/partners/${id}`, body),
}

// ─── Inventory ────────────────────────────────────────────────
export const inventoryApi = {
  balances:    (warehouse?: string | number) => {
    const q = typeof warehouse === 'number' ? `warehouse_id=${warehouse}` : `warehouse=${encodeURIComponent(String(warehouse || ''))}`
    return unwrap(api.get<unknown[]>(`/inventory/balances${warehouse ? `?${q}` : ''}`))
  },
  warehouses:  () => unwrap(api.get<string[]>('/inventory/warehouses')),
  warehousesSetup: () => api.get<{ success: boolean; data: string[]; entities: any[] }>('/inventory/warehouses'),
  createWarehouse: (body: unknown) => api.post('/inventory/warehouses', body),
  reorderAlerts: () =>
    unwrap(api.get<Array<{
      item_code: number; item_name: string; unit: string | null
      current_balance: number; consumed_active_orders: number
      consumption_pct: number; active_order_count: number
    }>>('/inventory/reorder-alerts')),
  list:        (p: { page?: number; size?: number; warehouse?: string; item_code?: number; type?: string; start?: string; end?: string; field_id?: number; season_id?: number; work_order_id?: number }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl('/inventory/movements', p))),
  create:      (body: unknown) => api.post('/inventory/movements', body),
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
    movement_date: string; item_code: number; quantity: number;
    from_warehouse: string; to_warehouse: string; notes?: string
  }) => api.post('/inventory/movements/transfer', body),
  costByField: (season_id?: number) =>
    unwrap(api.get<unknown[]>(`/inventory/cost-by-field${season_id ? `?season_id=${season_id}` : ''}`)),
  itemStock:   (code: number, warehouse?: string) =>
    unwrap(api.get<{ by_warehouse: unknown[]; total_qty: number; total_value: number; avg_cost: number }>(
      `/inventory/item/${code}/stock${warehouse ? `?warehouse=${encodeURIComponent(warehouse)}` : ''}`
    )),
  itemCard:    (code: number, warehouse?: string) =>
    unwrap(api.get(`/inventory/item/${code}/card${warehouse ? `?warehouse=${encodeURIComponent(warehouse)}` : ''}`)),

  // New Enterprise Features
  categories: () => unwrap(api.get<any[]>('/inventory/categories')),
  createCategory: (body: any) => api.post('/inventory/categories', body),
  adjustments: () => unwrap(api.get<any[]>('/inventory/adjustments')),
  adjustmentDetail: (id: number) => unwrap(api.get<any>(`/inventory/adjustments/${id}`)),
  createAdjustment: (body: any) => api.post('/inventory/adjustments', body),
  postAdjustment: (id: number) => api.post(`/inventory/adjustments/${id}/post`, {}),
}

// ─── Config ───────────────────────────────────────────────────
export const configApi = {
  seasons:          () => unwrap(api.get('/config/seasons')),
  createSeason:     (body: unknown) => api.post('/config/seasons', body),
  updateSeasonStatus:(id: number, status: string) => api.patch(`/config/seasons/${id}/status`, { status }),
  seasonCloseCheck: (id: number) => unwrap(api.get(`/config/seasons/${id}/close-check`)),
  closeSeason:      (id: number, close_notes?: string) => unwrap(api.post<{ id: number; status: string }>(`/config/seasons/${id}/close`, { close_notes })),
  items:            () => unwrap(api.get<any[]>('/config/items')),
  createItem:       (body: unknown) => api.post('/config/items', body),
  updateItem:       (code: number, body: unknown) => api.patch(`/config/items/${code}`, body),
  costCenters:      () => unwrap(api.get('/config/cost_centers')),
  accounts:         () => unwrap(api.get('/config/accounts')),
  expenseTypes:     () => unwrap(api.get('/config/expense_types')),
  companies:        () => unwrap(api.get('/config/companies')),
  integrations:     () => unwrap(api.get<{ module_key: string; is_enabled: number }[]>('/config/gl-integrations')),
  updateIntegration:(key: string, is_enabled: boolean) => api.patch(`/config/gl-integrations/${key}`, { is_enabled }),
}

// ─── Users (admin) ────────────────────────────────────────────
export const usersApi = {
  list:   () => unwrap(api.get<unknown[]>('/users')),
  create: (body: unknown) => api.post('/users', body),
  update: (id: number, body: unknown) => api.patch(`/users/${id}`, body),
}

// ─── Fields (قطع الأراضي) ─────────────────────────────────────
export const fieldsApi = {
  list:   (p?: { season_id?: number; q?: string }) =>
    unwrap(api.get<unknown[]>(paginatedUrl('/fields', p ?? {}))),
  get:    (id: number) => unwrap(api.get(`/fields/${id}`)),
  create: (body: unknown) => api.post('/fields', body),
  update: (id: number, body: unknown) => api.patch(`/fields/${id}`, body),
}

// ─── Employees (الموظفون) ─────────────────────────────────────
export const employeesApi = {
  list:   (q?: string) =>
    unwrap(api.get<unknown[]>(`/employees${q ? `?q=${encodeURIComponent(q)}` : ''}`)),
  get:    (id: number) => unwrap(api.get(`/employees/${id}`)),
  create: (body: unknown) => api.post('/employees', body),
  update: (id: number, body: unknown) => api.patch(`/employees/${id}`, body),
}

// ─── Operations (أوامر العمل) ─────────────────────────────────

export interface WOTemplate {
  id: number; company_id: number
  name: string; operation_type: string; description?: string
  is_active: number; task_count?: number; created_at: string
}

export interface WOTemplateTask {
  id: number; template_id: number; company_id: number
  task_name: string; task_order: number
  estimated_hours?: number; notes?: string
}

export const operationsApi = {
  listOrders:  (p?: { season_id?: number; field_id?: number; status?: string; page?: number; size?: number }) =>
    unwrap(api.get<unknown>(paginatedUrl('/operations/orders', p ?? {}))),
  getOrder:    (id: number) => unwrap(api.get(`/operations/orders/${id}`)),
  createOrder: (body: unknown) => api.post('/operations/orders', body),
  updateStatus:(id: number, status: string, actual_date?: string) =>
    api.patch(`/operations/orders/${id}/status`, { status, actual_date }),
  addTask:     (orderId: number, body: unknown) => api.post(`/operations/orders/${orderId}/tasks`, body),
  deleteTask:  (id: number) => api.delete(`/operations/tasks/${id}`),
  summary:     (season_id?: number) =>
    unwrap(api.get<unknown[]>(`/operations/summary${season_id ? `?season_id=${season_id}` : ''}`)),

  // Templates
  listTemplates: () =>
    unwrap(api.get<WOTemplate[]>('/operations/templates')),
  getTemplate: (id: number) =>
    unwrap(api.get<WOTemplate & { tasks: WOTemplateTask[] }>(`/operations/templates/${id}`)),
  createTemplate: (body: {
    name: string; operation_type: string; description?: string
    tasks?: Array<{ task_name: string; estimated_hours?: number; notes?: string }>
  }) => unwrap(api.post<{ id: number }>('/operations/templates', body)),
  updateTemplate: (id: number, body: { name?: string; description?: string; is_active?: number }) =>
    unwrap(api.patch<null>(`/operations/templates/${id}`, body)),
  deleteTemplate: (id: number) =>
    unwrap(api.delete<null>(`/operations/templates/${id}`)),
  addTemplateTask: (tplId: number, body: { task_name: string; estimated_hours?: number; notes?: string }) =>
    unwrap(api.post<{ id: number }>(`/operations/templates/${tplId}/tasks`, body)),
  updateTemplateTask: (taskId: number, body: { task_name?: string; task_order?: number; estimated_hours?: number }) =>
    unwrap(api.patch<null>(`/operations/template-tasks/${taskId}`, body)),
  deleteTemplateTask: (taskId: number) =>
    unwrap(api.delete<null>(`/operations/template-tasks/${taskId}`)),
  useTemplate: (tplId: number, body: {
    name?: string; planned_date: string
    season_id?: number; field_id?: number; area_feddan?: number; notes?: string
  }) => unwrap(api.post<{ id: number; task_count: number }>(`/operations/templates/${tplId}/use`, body)),
}

// ─── Contracts (العقود) ───────────────────────────────────────
export const contractsApi = {
  listPurchase:   (p?: { season_id?: number; status?: string }) =>
    unwrap(api.get<unknown[]>(paginatedUrl('/contracts/purchase', p ?? {}))),
  getPurchase:    (id: number) => unwrap(api.get(`/contracts/purchase/${id}`)),
  createPurchase: (body: unknown) => api.post('/contracts/purchase', body),
  updatePurchaseStatus: (id: number, status: string, paid_value?: number) =>
    api.patch(`/contracts/purchase/${id}/status`, { status, paid_value }),

  listSales:      (p?: { season_id?: number; status?: string }) =>
    unwrap(api.get<unknown[]>(paginatedUrl('/contracts/sales', p ?? {}))),
  createSales:    (body: unknown) => api.post('/contracts/sales', body),
  updateSalesStatus: (id: number, status: string, advance_paid?: number) =>
    api.patch(`/contracts/sales/${id}/status`, { status, advance_paid }),
  receiveAdvance: (id: number, body: { amount: number; receipt_date: string; notes?: string }) =>
    api.post<{ gl_entry_id: number | null; advance_paid: number }>(`/contracts/sales/${id}/receive-advance`, body),
  listAdvances: (id: number) =>
    unwrap(api.get<unknown[]>(`/contracts/sales/${id}/advances`)),

  summary:        (season_id?: number) =>
    unwrap(api.get(`/contracts/summary${season_id ? `?season_id=${season_id}` : ''}`)),
}

// ─── Budgets (ميزانيات الحقول) ────────────────────────────────
export const budgetsApi = {
  list:   (season_id?: number) =>
    unwrap(api.get<unknown[]>(`/budgets${season_id ? `?season_id=${season_id}` : ''}`)),
  upsert: (body: { field_id: number; season_id: number; budget_per_feddan: number; notes?: string }) =>
    api.post('/budgets', body),
  remove: (id: number) => api.delete(`/budgets/${id}`),
}

// ─── Reports (التقارير التحليلية) ──────────────────────────────
export const reportsApi = {
  costCenters: (season_id?: number) =>
    unwrap(api.get<{
      data: Array<{
        center_code: number; center_name: string | null
        cash_total: number; cash_count: number
        supplier_total: number; supplier_count: number
        inventory_total: number; inventory_count: number
        grand_total: number
      }>
      grand_total: number
    }>(`/reports/cost-centers${season_id ? `?season_id=${season_id}` : ''}`)),

  costCenterDetail: (code: number, season_id?: number) =>
    unwrap(api.get<{
      cash_by_category: Array<{ expense_code: number; expense_name: string; total: number; cnt: number }>
      sup_by_supplier:  Array<{ supplier_code: number; supplier_name: string; total: number; cnt: number }>
      cash_timeline:    Array<{ year: number; month: number; total: number }>
    }>(`/reports/cost-centers/${code}/detail${season_id ? `?season_id=${season_id}` : ''}`)),

  supplierPayments: (p?: { supplier_code?: number; season_id?: number }) =>
    unwrap(api.get<{
      data:    unknown[]
      summary: Array<{ supplier_code: number; supplier_name: string; total_credit: number; total_debit: number; balance: number }>
    }>(paginatedUrl('/reports/supplier-payments', p ?? {}))),

  suppliersBalance: (season_id?: number) =>
    unwrap(api.get<Array<{
      code: number; name: string; activity: string | null
      total_credit: number; total_debit: number; balance: number; last_balance: number; tx_count: number
    }>>(`/reports/suppliers-balance${season_id ? `?season_id=${season_id}` : ''}`)),

  seasonSummary: (season_id: number) =>
    unwrap(api.get<{
      season:              unknown
      by_cost_center:      Array<{ center_code: number; center_name: string; cash_total: number; supplier_total: number; inventory_total: number; grand_total: number }>
      by_expense_type:     Array<{ expense_code: number; expense_name: string; total: number; cnt: number }>
      by_supplier:         Array<{ supplier_code: number; supplier_name: string; activity: string | null; total_credit: number; total_debit: number; balance: number; tx_count: number }>
      by_inventory_item:   Array<{ item_code: number; item_name: string; unit: string | null; total_qty_out: number; total_value_out: number }>
      monthly_timeline:    Array<{ year: number; month: number; cash_out: number; supplier_credit: number }>
      totals: { cash_out: number; supplier_credit: number; supplier_debit: number; inventory_consumed: number; grand_total: number }
    }>(`/reports/season-summary?season_id=${season_id}`)),

  seasonPnL: (season_id: number) =>
    unwrap(api.get<{
      season:            { id: number; name: string; season_type: string; start_date: string; end_date: string; status: string } | null
      revenue:           { contracts_value: number; advance_collected: number; contracts_count: number }
      costs:             { inventory: number; labor: number; cash_out: number; supplier_credit: number; land_rent: number; payroll: number; total: number }
      net_margin:        number
      total_area:        number
      margin_per_feddan: number | null
      margin_pct:        number | null
      by_field:          Array<{
        id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
        field_revenue: number; inv_cost: number; labor_cost: number
        field_cost: number; field_margin: number; margin_per_feddan: number | null
      }>
    }>(`/reports/season-pnl?season_id=${season_id}`)),

  budgetVsActual: (season_id: number) =>
    unwrap(api.get<{
      season: unknown
      totals: {
        budget: number; actual: number; variance: number
        variance_pct: number | null; utilization_pct: number | null
        budgeted_fields: number; over_budget_count: number; total_fields: number
      }
      rows: Array<{
        id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
        budget_per_feddan: number; budget_total: number
        inv_cost: number; labor_cost: number; cash_cost: number; actual_total: number; actual_per_feddan: number
        variance: number; variance_pct: number | null; utilization_pct: number | null
        status: 'on_track' | 'at_risk' | 'over_budget' | 'no_budget'
      }>
    }>(`/reports/budget-vs-actual?season_id=${season_id}`)),

  seasonReadiness: (season_id: number) =>
    unwrap(api.get<{
      season:  { id: number; name: string; season_type: string; start_date: string; end_date: string; status: string }
      checks:  Array<{
        key: string; label: string; description: string
        count: number; ok: boolean; blocker: boolean; action_url: string
      }>
      summary: {
        blockers_failed: number; warnings_failed: number; passing: number
        total: number; score: number; ready: boolean
        total_fields: number; total_harvests: number
      }
    }>(`/reports/season-readiness?season_id=${season_id}`)),
}

// ─── GL (دفتر الأستاذ العام) ──────────────────────────────────
export const glApi = {
  accounts:     (type?: string) =>
    unwrap(api.get<unknown[]>(`/gl/accounts${type ? `?type=${type}` : ''}`)),
  createAccount:(body: unknown) => api.post('/gl/accounts', body),
  updateAccount:(code: string, body: unknown) => api.patch(`/gl/accounts/${code}`, body),

  mappings:     () => unwrap(api.get<unknown[]>('/gl/mappings')),
  saveMappings: (body: unknown) => api.put('/gl/mappings', body),

  periods:      () => unwrap(api.get<unknown[]>('/gl/periods')),
  createPeriod: (body: unknown) => api.post('/gl/periods', body),
  closePeriod:  (id: number)    => api.patch(`/gl/periods/${id}/close`, {}),
  reopenPeriod: (id: number)    => api.patch(`/gl/periods/${id}/reopen`, {}),

  entries:     (p?: { page?: number; size?: number; start?: string; end?: string; ref_type?: string }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl('/gl/entries', p ?? {}))),
  getEntry:    (id: number) => unwrap(api.get(`/gl/entries/${id}`)),
  createEntry: (body: unknown) => api.post('/gl/entries', body),

  ledger:      (code: string, start?: string, end?: string) =>
    unwrap(api.get(`/gl/ledger/${code}${start ? `?start=${start}${end ? `&end=${end}` : ''}` : ''}`)),

  trialBalance:     (start?: string, end?: string) =>
    unwrap(api.get(`/gl/trial-balance${start ? `?start=${start}${end ? `&end=${end}` : ''}` : ''}`)),
  incomeStatement:  (start?: string, end?: string) =>
    unwrap(api.get(`/gl/income-statement${start ? `?start=${start}${end ? `&end=${end}` : ''}` : ''}`)),
  balanceSheet:     (asOf?: string) =>
    unwrap(api.get(`/gl/balance-sheet${asOf ? `?as_of=${asOf}` : ''}`)),

  integrityCheck: () => unwrap(api.get<IntegrityCheckResult>('/gl/integrity-check')),

  reverseEntry: (id: number) =>
    unwrap(api.post<{ reversal_entry_id: number }>(`/gl/entries/${id}/reverse`, {})),

  bankAccounts: () => unwrap(api.get<unknown[]>('/finance/bank-accounts')),
}

export interface IntegrityCheck {
  key:         string
  label:       string
  description: string
  count:       number
  ok:          boolean
  blocker:     boolean
  action_url:  string
}

export interface IntegrityCheckResult {
  checks:       IntegrityCheck[]
  overall_ok:   boolean
  has_blockers: boolean
  score:        number
}

export interface RbacMatrix {
  roles:       string[]
  permissions: { key: string; module: string; action: string }[]
  modules:     string[]
  matrix:      { role: string; permissions: Record<string, boolean> }[]
}

// ─── Audit Log ────────────────────────────────────────────────
export const auditApi = {
  list: (p: { page?: number; size?: number; table?: string; action?: string; user_id?: number; start?: string; end?: string }) =>
    unwrapPaginated<AuditLogRow>(api.get(paginatedUrl('/audit', p))),
  errors: (p: { page?: number; size?: number; company_id?: string }) =>
    unwrapPaginated<ErrorLogEntry>(api.get(paginatedUrl('/audit/errors', p))),
  stats: () => unwrap(api.get<AuditStats>('/audit/stats')),
}

// ─── Admin (super_admin only) ─────────────────────────────────
export const adminApi = {
  companies:     () => unwrap(api.get<unknown[]>('/admin/companies')),
  createCompany: (body: unknown) => api.post('/admin/companies', body),
  updateCompany: (id: number, body: unknown) => api.patch(`/admin/companies/${id}`, body),
  switchCompany: async (
    companyId: number,
    setAuth: (token: string, user: SwitchedUser, company: SwitchedCompany, role: string, permissions: string[]) => void,
  ) => {
    const res = await api.post<AdminSwitchPayload>(`/admin/switch/${companyId}`, {})
    if (res.success) {
      const d = res.data
      setAuth(d.token, d.user, d.company, d.user.role, d.permissions ?? [])
    }
    return res
  },
  companyUsers:  (id: number) => unwrap(api.get<unknown[]>(`/admin/companies/${id}/users`)),
  overview:      () => unwrap(api.get<CompanyOverview[]>('/admin/overview')),
}

export interface CompanyOverview {
  id: number; code: string; name: string; is_active: number
  cash_balance:    number | null
  active_season:   string | null; season_status: string | null
  open_wo:         number; open_po_count: number; open_po_value: number
  employee_count:  number; low_stock_count: number
  last_activity:   string | null; health_score: number
}

export interface AuditLogRow {
  id: number
  action: string
  table_name: string
  record_id: number | null
  old_value: string | null
  new_value: string | null
  source: string
  created_at: string
  user_name: string
  user_email: string
  company_name: string
  company_id: number
}

export interface ErrorLogEntry {
  id: number
  company_id: number
  user_id: number | null
  endpoint: string
  method: string
  error_message: string
  stack_trace: string | null
  request_payload: string | null
  created_at: string
  user_name: string | null
  company_name: string | null
}

export interface AuditStats {
  total_logs?: number
  total_errors?: number
  today_logs?: number
  [key: string]: unknown
}

export interface SwitchedUser {
  id: number
  email: string
  full_name: string
  role: string
  company_id: number
}

export interface SwitchedCompany {
  id: number
  code: string
  name: string
}

export interface AdminSwitchPayload {
  token: string
  user: SwitchedUser
  company: SwitchedCompany
  permissions: string[]
}

// ─── Export (CSV) ─────────────────────────────────────────────
export function exportUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const token = localStorage.getItem('agro_token')
  const base  = window.location.hostname.endsWith('pages.dev')
    ? 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'
    : '/api'
  const url   = new URL(`${base}/export${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  if (token) url.searchParams.set('_t', token)
  return url.toString()
}

export async function downloadCsv(path: string, filename: string, params?: Record<string, string | number | undefined>) {
  const token = localStorage.getItem('agro_token')
  const base  = window.location.hostname.endsWith('pages.dev')
    ? 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'
    : '/api'
  const url = new URL(`${base}/export${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  const res  = await fetch(url.toString(), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const blob = await res.blob()
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
