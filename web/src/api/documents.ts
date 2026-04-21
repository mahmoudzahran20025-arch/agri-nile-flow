// ── Documents API Client ──────────────────────────────────────
import { api, unwrap } from './client'

export interface Document {
  id: number
  company_id: number
  title: string
  doc_type: string
  ref_table?: string
  ref_id?: number
  issue_date?: string
  expiry_date?: string
  responsible_user_id?: number
  responsible_name?: string
  file_r2_key?: string
  file_name?: string
  file_size_kb?: number
  file_mime_type?: string
  status: 'active' | 'expired' | 'renewed' | 'cancelled'
  notes?: string
  created_by?: number
  created_by_name?: string
  created_at: string
  updated_at: string
}

export interface DocumentAlert {
  id: number
  title: string
  doc_type: string
  expiry_date: string
  ref_table?: string
  ref_id?: number
  responsible_name?: string
  days_remaining: number
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  commercial_reg:    'سجل تجاري',
  trade_license:     'رخصة تجارية',
  safety_cert:       'شهادة سلامة',
  civil_defense:     'دفاع مدني',
  employee_contract: 'عقد عمل',
  insurance:         'تأمين',
  vehicle_license:   'رخصة مركبة',
  other:             'أخرى',
}

export const DOC_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active:    { label: 'ساري',   color: 'bg-emerald-100 text-emerald-700' },
  expired:   { label: 'منتهي', color: 'bg-red-100 text-red-700' },
  renewed:   { label: 'مجدد',  color: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'ملغي',  color: 'bg-gray-100 text-gray-600' },
}

export const documentsApi = {
  list: (params?: {
    doc_type?: string; status?: string; ref_table?: string
    ref_id?: number; expiring_days?: number
  }) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      )
    ).toString() : ''
    return unwrap(api.get<Document[]>(`/documents${qs}`))
  },

  alerts: () => unwrap(api.get<DocumentAlert[]>('/documents/alerts')),

  get: (id: number) => unwrap(api.get<Document>(`/documents/${id}`)),

  create: (b: {
    title: string; doc_type: string; ref_table?: string; ref_id?: number
    issue_date?: string; expiry_date?: string; responsible_user_id?: number
    file_name?: string; file_size_kb?: number; notes?: string
  }) => unwrap(api.post<{ id: number }>('/documents', b)),

  update: (id: number, b: Partial<Document>) =>
    unwrap(api.patch<null>(`/documents/${id}`, b)),

  remove: (id: number) => unwrap(api.delete<null>(`/documents/${id}`)),

  renew: (id: number, issue_date?: string, expiry_date?: string) =>
    unwrap(api.patch<null>(`/documents/${id}/renew`, { issue_date, expiry_date })),

  // R2 file upload — sends multipart/form-data
  uploadFile: async (id: number, file: File): Promise<{ r2Key: string; file_name: string; file_size_kb: number }> => {
    const token = localStorage.getItem('agro_token')
    const BASE = window.location.hostname.endsWith('pages.dev')
      ? 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'
      : '/api'
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/documents/${id}/upload`, {
      method: 'PUT',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    const json = await res.json() as { success: boolean; data?: { r2Key: string; file_name: string; file_size_kb: number }; error?: string }
    if (!json.success) throw new Error(json.error ?? 'فشل الرفع')
    return json.data!
  },

  // Get download URL (uses the /download endpoint which streams from R2)
  downloadUrl: (id: number): string => {
    const BASE = window.location.hostname.endsWith('pages.dev')
      ? 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'
      : '/api'
    return `${BASE}/documents/${id}/download`
  },

  removeFile: (id: number) => unwrap(api.delete<null>(`/documents/${id}/file`)),
}
