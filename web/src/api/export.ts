import { BASE_URL } from './core'

export function exportUrl(
  path: string,
  params?: Record<string, string | number | undefined>,
): string {
  const token = localStorage.getItem('agro_token')
  const url   = new URL(`${BASE_URL}/export${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  if (token) url.searchParams.set('_t', token)
  return url.toString()
}

export async function downloadCsv(
  path: string,
  filename: string,
  params?: Record<string, string | number | undefined>,
): Promise<void> {
  const token = localStorage.getItem('agro_token')
  const url   = new URL(`${BASE_URL}/export${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  const res  = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const blob = await res.blob()
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
