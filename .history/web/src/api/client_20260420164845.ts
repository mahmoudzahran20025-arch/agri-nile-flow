import type { ApiResult, Paginated } from '../types'

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
  const res = await promise
  if (!res.success) throw new Error(res.error)
  return res.data
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
    api.post<{ token: string; user: { id: number; full_name: string; email: string; company_id: number; role: string } }>('/auth/login', { email, password, company_id }),

  me: () =>
    unwrap(api.get<{ user: { id: number; email: string; full_name: string }; company: { id: number; code: string; name: string }; role: string }>('/auth/me')),

  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),
}

// ─── Dashboard ────────────────────────────────────────────────
export const dashboardApi = {
  stats:             () => unwrap(api.get('/dashboard/stats')),
  monthlyCashflow:   (months = 12) => unwrap(api.get(`/dashboard/monthly-cashflow?months=${months}`)),
  costByCrop:        (seasonId?: number) => unwrap(api.get(`/dashboard/cost-by-crop${seasonId ? `?season_id=${seasonId}` : ''}`)),
  recentTransactions:(limit = 15) => unwrap(api.get(`/dashboard/recent-transactions?limit=${limit}`)),
  inventoryAlerts:   () => unwrap(api.get('/dashboard/inventory-alerts')),
}

// ─── Suppliers ────────────────────────────────────────────────
export const suppliersApi = {
  list:       (p: { page?: number; size?: number; q?: string }) =>
    unwrap(api.get<Paginated<unknown>>(paginatedUrl('/suppliers', p))),
  get:        (code: number) => unwrap(api.get(`/suppliers/${code}`)),
  create:     (body: unknown) => api.post('/suppliers', body),
  update:     (code: number, body: unknown) => api.patch(`/suppliers/${code}`, body),
  statement:  (code: number, p: { page?: number; size?: number; season_id?: number; month?: number }) =>
    unwrap(api.get<Paginated<unknown>>(paginatedUrl(`/suppliers/${code}/statement`, p))),
  addTransaction: (code: number, body: unknown) => api.post(`/suppliers/${code}/transactions`, body),
}

// ─── Treasury ─────────────────────────────────────────────────
export const treasuryApi = {
  balance:        () => unwrap(api.get<{ balance: number }>('/treasury/balance')),
  list:           (p: { page?: number; size?: number; direction?: string; month?: number; year?: number }) =>
    unwrap(api.get<Paginated<unknown>>(paginatedUrl('/treasury/transactions', p))),
  create:         (body: unknown) => api.post('/treasury/transactions', body),
  payments:       (supplierCode?: number) =>
    unwrap(api.get(`/treasury/supplier-payments${supplierCode ? `?supplier_code=${supplierCode}` : ''}`)),
  partners:       () => unwrap(api.get('/treasury/partners')),
  createPartner:  (body: unknown) => api.post('/treasury/partners', body),
  updatePartner:  (id: number, body: unknown) => api.patch(`/treasury/partners/${id}`, body),
}

// ─── Inventory ────────────────────────────────────────────────
export const inventoryApi = {
  balances:   (warehouse?: string) =>
    unwrap(api.get<unknown[]>(`/inventory/balances${warehouse ? `?warehouse=${encodeURIComponent(warehouse)}` : ''}`)),
  warehouses: () => unwrap(api.get<string[]>('/inventory/warehouses')),
  list:       (p: { page?: number; size?: number; warehouse?: string; item_code?: number; type?: string }) =>
    unwrap(api.get<Paginated<unknown>>(paginatedUrl('/inventory/movements', p))),
  create:     (body: unknown) => api.post('/inventory/movements', body),
  itemCard:   (code: number, warehouse?: string) =>
    unwrap(api.get(`/inventory/item/${code}/card${warehouse ? `?warehouse=${encodeURIComponent(warehouse)}` : ''}`)),
}

// ─── Config ───────────────────────────────────────────────────
export const configApi = {
  seasons:          () => unwrap(api.get('/config/seasons')),
  createSeason:     (body: unknown) => api.post('/config/seasons', body),
  updateSeasonStatus:(id: number, status: string) => api.patch(`/config/seasons/${id}/status`, { status }),
  items:            () => unwrap(api.get('/config/items')),
  createItem:       (body: unknown) => api.post('/config/items', body),
  costCenters:      () => unwrap(api.get('/config/cost_centers')),
  accounts:         () => unwrap(api.get('/config/accounts')),
  expenseTypes:     () => unwrap(api.get('/config/expense_types')),
  companies:        () => unwrap(api.get('/config/companies')),
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

  summary:        (season_id?: number) =>
    unwrap(api.get(`/contracts/summary${season_id ? `?season_id=${season_id}` : ''}`)),
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
    unwrap(api.get<unknown>(paginatedUrl('/gl/entries', p ?? {}))),
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
