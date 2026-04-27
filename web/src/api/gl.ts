import { api, unwrap, unwrapPaginated, paginatedUrl } from './core'

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

export const glApi = {
  accounts:      (type?: string) =>
    unwrap(api.get<unknown[]>(`/gl/accounts${type ? `?type=${type}` : ''}`)),
  createAccount: (body: unknown) => api.post('/gl/accounts', body),
  updateAccount: (code: string, body: unknown) => api.patch(`/gl/accounts/${code}`, body),

  mappings:     () => unwrap(api.get<unknown[]>('/gl/mappings')),
  saveMappings: (body: unknown) => api.put('/gl/mappings', body),

  periods:      () => unwrap(api.get<unknown[]>('/gl/periods')),
  createPeriod: (body: unknown) => api.post('/gl/periods', body),
  closePeriod:  (id: number) => api.patch(`/gl/periods/${id}/close`, {}),
  reopenPeriod: (id: number) => api.patch(`/gl/periods/${id}/reopen`, {}),

  entries:     (p?: { page?: number; size?: number; start?: string; end?: string; ref_type?: string }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl('/gl/entries', p ?? {}))),
  getEntry:    (id: number) => unwrap(api.get(`/gl/entries/${id}`)),
  createEntry: (body: unknown) => api.post('/gl/entries', body),
  reverseEntry: (id: number) =>
    unwrap(api.post<{ reversal_entry_id: number }>(`/gl/entries/${id}/reverse`, {})),

  ledger: (code: string, start?: string, end?: string) =>
    unwrap(api.get(`/gl/ledger/${code}${start ? `?start=${start}${end ? `&end=${end}` : ''}` : ''}`)),

  trialBalance:    (start?: string, end?: string) =>
    unwrap(api.get(`/gl/trial-balance${start ? `?start=${start}${end ? `&end=${end}` : ''}` : ''}`)),
  incomeStatement: (start?: string, end?: string) =>
    unwrap(api.get(`/gl/income-statement${start ? `?start=${start}${end ? `&end=${end}` : ''}` : ''}`)),
  balanceSheet:    (asOf?: string) =>
    unwrap(api.get(`/gl/balance-sheet${asOf ? `?as_of=${asOf}` : ''}`)),

  integrityCheck: () => unwrap(api.get<IntegrityCheckResult>('/gl/integrity-check')),

  // Note: bankAccounts lives in finance domain but kept here for backward compat
  bankAccounts: () => unwrap(api.get<unknown[]>('/finance/bank-accounts')),
}
