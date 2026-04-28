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

export type PgType = 'business' | 'product' | 'inventory'

export interface PostingGroup {
  code:        string
  name:        string
  description: string | null
  is_active:   number
  created_at:  string
}

export interface GeneralSetupRow {
  id:                      number
  bus_posting_group_code:  string | null
  prod_posting_group_code: string | null
  sales_account:           string | null
  purchases_account:       string | null
  cogs_account:            string | null
  sales_returns_account:   string | null
  purch_returns_account:   string | null
  expense_account:         string | null
  is_active:               number
}

export interface InventorySetupRow {
  id:                      number
  inv_posting_group_code:  string | null
  prod_posting_group_code: string | null
  inventory_account:       string | null
  is_active:               number
}

export interface PostingHealthResult {
  groups: {
    business_posting_groups:  number
    product_posting_groups:   number
    inventory_posting_groups: number
  }
  setup: {
    general_rows:             number
    inventory_rows:           number
    has_catch_all_general:    boolean
    has_catch_all_inventory:  boolean
  }
  entities: {
    suppliers_missing_group:  number
    items_missing_group:      number
    warehouses_missing_group: number
  }
  issues:   string[]
  warnings: string[]
  is_ready: boolean
}

export interface JournalLine {
  account_code: string
  debit:        number
  credit:       number
  description?: string
}

export interface ValidationBlueprint {
  lines:            JournalLine[]
  validationErrors: string[]
  warnings:         string[]
  isBlocked:        boolean
}

export interface AccountUsageMetadata {
  account_code:   string
  usage_count:    number
  last_used_date: string | null
  is_locked:      number
}

export type PostingRuleType = 'general' | 'inventory' | 'control'

export interface PostingRule {
  id:                       number
  company_id:               number
  rule_type:                PostingRuleType
  bus_posting_group_code:   string | null
  prod_posting_group_code:  string | null
  inv_posting_group_code:   string | null
  mapping_key:              string | null
  account_code:             string | null
  sales_account:            string | null
  purchases_account:        string | null
  cogs_account:             string | null
  sales_returns_account:    string | null
  purch_returns_account:    string | null
  expense_account:          string | null
  inventory_account:        string | null
  priority:                 number
  is_active:                number
  created_at:               string
  updated_at:               string
}

export interface PostingRuleFilters {
  rule_type?:                PostingRuleType
  active?:                   0 | 1
  mapping_key?:              string
  bus_posting_group_code?:   string
  prod_posting_group_code?:  string
  inv_posting_group_code?:   string
  page?:                     number
  size?:                     number
}

export const glApi = {
  /**
   * Fetch chart-of-accounts entries.
   * @param type - filter by account_type (asset|liability|equity|revenue|expense)
   * @param leafOnly - when true, add leaf=1 to skip header/summary accounts
   */
  accounts:      (type?: string, leafOnly = true) =>
    unwrap(api.get<unknown[]>(`/gl/accounts?${type ? `type=${type}&` : ''}${leafOnly ? 'leaf=1' : ''}`)),
  accountUsageMetadata: () => unwrap(api.get<AccountUsageMetadata[]>('/gl/accounts/usage-metadata')),
  createAccount: (body: unknown) => api.post('/gl/accounts', body),
  updateAccount: (code: string, body: unknown) => api.patch(`/gl/accounts/${code}`, body),

  periods:      () => unwrap(api.get<unknown[]>('/gl/periods')),
  createPeriod: (body: unknown) => api.post('/gl/periods', body),
  closePeriod:  (id: number) => api.patch(`/gl/periods/${id}/close`, {}),
  reopenPeriod: (id: number) => api.patch(`/gl/periods/${id}/reopen`, {}),

  entries:     (p?: { page?: number; size?: number; start?: string; end?: string; ref_type?: string }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl('/gl/entries', p ?? {}))),
  getEntry:    (id: number) => unwrap(api.get(`/gl/entries/${id}`)),
  createEntry: (body: unknown) => api.post('/gl/manual-entries', body),
  reverseEntry: (id: number) =>
    unwrap(api.post<{ reversal_entry_id: number }>(`/gl/entries/${id}/reverse`, {})),

  ledger: (code: string, start?: string, end?: string, page = 1, size = 100) => {
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end)   params.set('end',   end)
    params.set('page', String(page))
    params.set('size', String(size))
    return unwrap(api.get(`/gl/ledger/${code}?${params.toString()}`))
  },

  trialBalance:    (start?: string, end?: string) =>
    unwrap(api.get(`/gl/trial-balance${start ? `?start=${start}${end ? `&end=${end}` : ''}` : ''}`)),
  incomeStatement: (start?: string, end?: string) =>
    unwrap(api.get(`/gl/income-statement${start ? `?start=${start}${end ? `&end=${end}` : ''}` : ''}`)),
  balanceSheet:    (asOf?: string) =>
    unwrap(api.get(`/gl/balance-sheet${asOf ? `?as_of=${asOf}` : ''}`)),

  integrityCheck: () => unwrap(api.get<IntegrityCheckResult>('/gl/integrity-check')),

  integrityScore: () => unwrap(api.get<{
    overall_score: number
    status: 'healthy' | 'warning' | 'critical' | 'emergency'
    components: {
      balance_integrity:  { score: number; weight: string; detail: string }
      posting_coverage:   { score: number; weight: string; detail: string }
      orphan_score:       { score: number; weight: string; detail: string }
      inv_reconciliation: { score: number; weight: string; detail: string }
      rule_coverage:      { score: number; weight: string; detail: string }
    }
    alerts: Array<{ level: 'error' | 'warning' | 'info'; message: string; action: string }>
    computed_at: string
  }>('/gl/integrity/score')),
  recomputeIntegrityScore: () => unwrap(api.post<{
    overall_score: number
    status: 'healthy' | 'warning' | 'critical' | 'emergency'
    components: {
      balance_integrity:  { score: number; weight: string; detail: string }
      posting_coverage:   { score: number; weight: string; detail: string }
      orphan_score:       { score: number; weight: string; detail: string }
      inv_reconciliation: { score: number; weight: string; detail: string }
      rule_coverage:      { score: number; weight: string; detail: string }
    }
    alerts: Array<{ level: 'error' | 'warning' | 'info'; message: string; action: string }>
    computed_at: string
  }>('/gl/integrity/score', {})),

  entryTrace: (id: number) => unwrap(api.get<{
    entry_id:     number
    rule_trace:   Record<string, unknown> | null
    lines:        Array<{ account_code: string; account_name?: string; debit: number; credit: number; rule_slot?: string }>
    business_event: { id: number; event_type: string; source_module: string; source_id: number; event_date: string } | null
  }>(`/gl/entries/${id}/trace`)),

  // Note: bankAccounts lives in finance domain but kept here for backward compat
  bankAccounts: () => unwrap(api.get<unknown[]>('/finance/bank-accounts')),

  // ── Posting Groups ──────────────────────────────────────────────────────────
  postingGroups:       (type: PgType) => unwrap(api.get<PostingGroup[]>(`/gl/posting-groups/${type}`)),
  createPostingGroup:  (type: PgType, body: { code: string; name: string; description?: string }) =>
    api.post(`/gl/posting-groups/${type}`, body),
  updatePostingGroup:  (type: PgType, code: string, body: { name?: string; description?: string; is_active?: boolean }) =>
    api.patch(`/gl/posting-groups/${type}/${code}`, body),

  // ── General Posting Setup ───────────────────────────────────────────────────
  generalSetup:       () => unwrap(api.get<GeneralSetupRow[]>('/gl/posting-setup/general')),
  createGeneralSetup: (body: Partial<GeneralSetupRow>) => api.post('/gl/posting-setup/general', body),
  updateGeneralSetup: (id: number, body: Partial<GeneralSetupRow>) =>
    api.patch(`/gl/posting-setup/general/${id}`, body),

  // ── Inventory Posting Setup ─────────────────────────────────────────────────
  inventorySetup:       () => unwrap(api.get<InventorySetupRow[]>('/gl/posting-setup/inventory')),
  createInventorySetup: (body: Partial<InventorySetupRow>) => api.post('/gl/posting-setup/inventory', body),
  updateInventorySetup: (id: number, body: Partial<InventorySetupRow>) =>
    api.patch(`/gl/posting-setup/inventory/${id}`, body),

  // ── Posting Rules (admin/debug listing) ────────────────────────────────────
  postingRules: (filters: PostingRuleFilters = {}) => {
    const p = new URLSearchParams()
    if (filters.rule_type !== undefined)               p.set('rule_type',               filters.rule_type)
    if (filters.active !== undefined)                  p.set('active',                  String(filters.active))
    if (filters.mapping_key)                           p.set('mapping_key',             filters.mapping_key)
    if (filters.bus_posting_group_code)                p.set('bus_posting_group_code',  filters.bus_posting_group_code)
    if (filters.prod_posting_group_code)               p.set('prod_posting_group_code', filters.prod_posting_group_code)
    if (filters.inv_posting_group_code)                p.set('inv_posting_group_code',  filters.inv_posting_group_code)
    if (filters.page !== undefined)                    p.set('page',                    String(filters.page))
    if (filters.size !== undefined)                    p.set('size',                    String(filters.size))
    const qs = p.toString()
    return unwrap(api.get<{ data: PostingRule[]; total: number; page: number; page_size: number }>(
      `/gl/posting-rules${qs ? `?${qs}` : ''}`
    ))
  },

  // ── Health & Validate ───────────────────────────────────────────────────────
  postingHealth:    () => unwrap(api.get<PostingHealthResult>('/gl/posting-setup/health')),
  validatePosting:  (body: {
    type: 'inventory_in' | 'inventory_out' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
    bpg_code?: string | null; ppg_code?: string | null; ipg_code?: string | null
    ap_code?: string; cash_code?: string; receivable_code?: string; amount?: number
  }) => unwrap(api.post<ValidationBlueprint>('/gl/posting-setup/validate', body)),
}
