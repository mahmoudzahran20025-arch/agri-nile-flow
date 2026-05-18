/**
 * HTTP core — base URL, request(), api verbs, unwrap helpers.
 * Import from here in domain API files; do NOT import from client.ts.
 */
import type { ApiResult } from '../types'

export const BASE_URL =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL as string | undefined) ||
  `${window.location.origin}/api`

// Registered by App.tsx so core.ts doesn't import the store (avoids circular deps)
let _onUnauthorized: (() => void) | null = null
export function registerUnauthorizedHandler(fn: () => void) {
  _onUnauthorized = fn
}

function getToken(): string | null {
  return localStorage.getItem('agro_token')
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const token = getToken()
  const url   = `${BASE_URL}${path}`
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(url, { ...options, headers })

  if (res.status === 401 && _onUnauthorized) {
    _onUnauthorized()
    // Return a synthetic failure so callers don't throw on missing .json()
    return { success: false, error: 'Session expired. Please log in again.' } as ApiResult<T>
  }

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
  put:    <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
}

export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  const res = await promise
  if (!res.success) throw new Error(res.error || 'API returned success=false')
  return res.data
}

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
