import type { ApiResult, Paginated } from '../types'

const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('agro_token')
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const token = getToken()
  const res   = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  const json = await res.json() as ApiResult<T>
  return json
}

export const api = {
  get:    <T>(path: string) =>
    request<T>(path),

  post:   <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  patch:  <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

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
  balance:    () => unwrap(api.get<{ balance: number }>('/treasury/balance')),
  list:       (p: { page?: number; size?: number; direction?: string; month?: number; year?: number }) =>
    unwrap(api.get<Paginated<unknown>>(paginatedUrl('/treasury/transactions', p))),
  create:     (body: unknown) => api.post('/treasury/transactions', body),
  payments:   (supplierCode?: number) =>
    unwrap(api.get(`/treasury/supplier-payments${supplierCode ? `?supplier_code=${supplierCode}` : ''}`)),
  partners:   () => unwrap(api.get('/treasury/partners')),
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
  seasons:     () => unwrap(api.get('/config/seasons')),
  createSeason:(body: unknown) => api.post('/config/seasons', body),
  items:       () => unwrap(api.get('/config/items')),
  createItem:  (body: unknown) => api.post('/config/items', body),
  costCenters: () => unwrap(api.get('/config/cost_centers')),
  accounts:    () => unwrap(api.get('/config/accounts')),
  companies:   () => unwrap(api.get('/config/companies')),
}
