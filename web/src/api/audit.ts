import { api, unwrap, unwrapPaginated, paginatedUrl } from './core'

export interface AuditLogRow {
  id:           number
  action:       string
  table_name:   string
  record_id:    number | null
  old_value:    string | null
  new_value:    string | null
  source:       string
  created_at:   string
  user_name:    string
  user_email:   string
  company_name: string
  company_id:   number
}

export interface ErrorLogEntry {
  id:              number
  company_id:      number
  user_id:         number | null
  endpoint:        string
  method:          string
  error_message:   string
  stack_trace:     string | null
  request_payload: string | null
  created_at:      string
  user_name:       string | null
  company_name:    string | null
}

export interface AuditStats {
  total_logs?:  number
  total_errors?: number
  today_logs?:  number
  [key: string]: unknown
}

export const auditApi = {
  list: (p: {
    page?: number; size?: number; table?: string; action?: string
    user_id?: number; start?: string; end?: string
  }) => unwrapPaginated<AuditLogRow>(api.get(paginatedUrl('/audit', p))),

  errors: (p: { page?: number; size?: number; company_id?: string }) =>
    unwrapPaginated<ErrorLogEntry>(api.get(paginatedUrl('/audit/errors', p))),

  stats: () => unwrap(api.get<AuditStats>('/audit/stats')),
}
