import { api, unwrap, unwrapPaginated, paginatedUrl } from './core'
import type { BankAccount } from './finance'
export type { BankAccount }

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

export interface IntegrityIssue {
  name: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  count: number
  details?: unknown[]
}

export interface IntegrityCheckV2Result {
  success: true
  health_score: number
  summary: {
    total_issues: number
    critical: number
    high: number
    medium: number
  }
  checks: IntegrityIssue[]
}

export interface SystemIntegrityScoreResult {
  success: true
  overall_score: number
  score: number
  status: 'excellent' | 'good' | 'fair' | 'poor'
  alerts?: { message: string; severity: string }[]
  metrics: {
    total_entries: number
    posted_entries: number
    unbalanced_entries: number
    orphan_lines: number
    missing_periods: number
    invalid_accounts: number
  }
}

export interface FinancialPeriod {
  id: number
  company_id: number
  name: string
  period_type: string
  start_date: string
  end_date: string
  is_closed: number
  status?: 'open' | 'closed' | 'locked'
  closed_at?: string | null
  closed_by?: number | null
  created_at?: string
}

export interface PeriodCloseChecklistStep {
  step_key: string
  step_order: number
  step_label: string
  is_critical: boolean
  status: 'pending' | 'running' | 'passed' | 'failed' | 'warning'
  count_blocked: number
  details: string
  completed_at?: string | null
}

export interface PeriodCloseChecklistResult {
  period: FinancialPeriod
  checks: PeriodCloseChecklistStep[]
  all_critical_passed: boolean
}

export interface PeriodCloseRunResult {
  checks: Array<{
    step_key: string
    step_order: number
    step_label: string
    is_critical: boolean
    status: 'pending' | 'running' | 'passed' | 'failed' | 'warning'
    count_blocked: number
    details: string
    action_url?: string
  }>
  all_critical_passed: boolean
  blockers: string[]
}

export interface GlAuditLogRow {
  id: number
  user_id: number | null
  company_id: number
  action: string
  table_name: string
  record_id: number | null
  old_value: string | null
  new_value: string | null
  created_at: string
  user_email?: string | null
  user_name?: string | null
}

export interface GlAuditLogResult {
  success: true
  data: GlAuditLogRow[]
  total: number
  page: number
  page_size: number
  has_more?: boolean
}

export interface BatchPostJobRow {
  id: number
  company_id: number
  event_type: string
  source_module: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  priority: number
  total_items: number
  processed_items: number
  failed_items: number
  retry_count: number
  last_error: string | null
  created_by: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface BatchPostJobsResult {
  success: true
  data: BatchPostJobRow[]
  total: number
  page: number
  page_size: number
}

export interface EntryTraceResult {
  entry: {
    id: number
    entry_number: string | null
    entry_date: string
    description: string
    ref_type: string | null
    ref_id: number | null
    is_posted: number
    created_by: number | null
    created_at: string
  }
  lines: Array<{
    id: number
    account_code: string
    account_name?: string
    account_type?: string
    debit: number
    credit: number
    description?: string
    rule_slot?: string | null
    center_code?: number | null
    season_id?: number | null
    field_id?: number | null
  }>
  trace: Record<string, unknown> | null
  source_event: {
    id: number
    event_type: string
    event_date: string
    source_module: string
    source_id: number
    status: string
    payload: string | Record<string, unknown> | null
  } | null
  source_document: {
    id: number
    source_module: string
    source_id: number
    document_type: string
    event_id: number | null
    event_date: string | null
    status: string | null
    link_type: string | null
  } | null
  has_trace: boolean
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
  wip_account:             string | null
  finished_goods_account:  string | null
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
  wip_account:              string | null
  finished_goods_account:   string | null
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

// ── Phase 2+3 Types ──────────────────────────────────────────────────────────

export interface ExchangeRateRow {
  id: number
  from_currency: string
  to_currency:   string
  rate:          number
  effective_date: string
  source:        string
  is_active:     number
  created_at?:   string
}

export interface EventTypeRow {
  id:               number
  code:             string
  name:             string
  description?:     string
  module_name?:     string
  affects_inventory: number
  affects_wip:      number
  affects_cogs:     number
  affects_revenue:  number
  affects_expense:  number
  debit_role?:      string | null
  credit_role?:     string | null
  is_active:        number
}

export interface RolePolicyRow {
  id:           number
  role_code:    string
  account_code: string
  priority:     number
  notes?:       string | null
  is_active:    number
  role_name?:   string
  role_category?: string
  account_name?:  string
  account_type?:  string
}

export interface RoleCoverageRow {
  role_code:  string
  role_name:  string
  category:   string
  is_mapped:  boolean
}

export interface RoleCoverageMeta {
  total_roles:    number
  mapped_roles:   number
  unmapped_roles: number
  coverage_pct:   number
  gaps:           string[]
}

export interface RoleResolutionRow {
  role_code:      string
  role_name:      string
  category:       string
  account_code:   string
  account_name:   string
  account_type:   string
  normal_balance: string
  notes?:         string | null
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

  periods:      () => unwrap(api.get<FinancialPeriod[]>('/gl/periods')),
  createPeriod: (body: unknown) => api.post('/gl/periods', body),
  closePeriod:  (id: number) => api.patch(`/gl/periods/${id}/close`, {}),
  closePeriodForce: (id: number) => api.patch(`/gl/periods/${id}/close?force=1`, {}),
  reopenPeriod: (id: number) => api.patch(`/gl/periods/${id}/reopen`, {}),
  periodChecklist: (id: number) => unwrap(api.get<PeriodCloseChecklistResult>(`/gl/periods/${id}/checklist`)),
  runPeriodChecklist: (id: number) => unwrap(api.post<PeriodCloseRunResult>(`/gl/periods/${id}/checklist/run`, {})),
  runPeriodChecklistStep: (id: number, stepKey: string) =>
    unwrap(api.post<PeriodCloseChecklistStep>(`/gl/periods/${id}/checklist/run/${stepKey}`, {})),

  entries:     (p?: { page?: number; size?: number; start?: string; end?: string; ref_type?: string; search?: string; expense_code?: number; center_code?: string }) =>
    unwrapPaginated<unknown>(api.get(paginatedUrl('/gl/entries', p ?? {}))),
  getEntry:    (id: number) => unwrap(api.get(`/gl/entries/${id}`)),
  createEntry: (body: unknown) => api.post('/gl/entries/manual-entries', body),
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
  integrityCheckV2: (detailed = false) =>
    unwrap(api.get<IntegrityCheckV2Result>(`/gl/integrity-check?detailed=${detailed ? '1' : '0'}`)),
  systemIntegrityScore: () => unwrap(api.get<SystemIntegrityScoreResult>('/gl/system-integrity-score')),
  integrityScore: () => unwrap(api.get<SystemIntegrityScoreResult>('/gl/system-integrity-score')),
  recomputeIntegrityScore: () => unwrap(api.post<SystemIntegrityScoreResult>('/gl/system-integrity-score/recompute', {})),

  auditLog: (p?: { page?: number; size?: number; table?: string; action?: string; from?: string; to?: string }) =>
    unwrap(api.get<GlAuditLogResult>(paginatedUrl('/gl/audit-log', p ?? {}))),

  batchPostJobs: (p?: {
    page?: number
    size?: number
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  }) => unwrap(api.get<BatchPostJobsResult>(paginatedUrl('/gl/batch-post/jobs', p ?? {}))),

  getBatchPostJob: (id: number) => unwrap(api.get<{ success: true; data: BatchPostJobRow & { items: unknown[] } }>(`/gl/batch-post/jobs/${id}`)),

  createBatchPostJob: (body: {
    event_type: string; source_module: string; priority?: number; payload?: unknown
    items: Array<{ source_id: number; payload?: unknown }>
  }) => unwrap(api.post<{ success: true; data: { job_id: number } }>('/gl/batch-post/jobs', body)),

  updateBatchPostJobStatus: (id: number, body: { status: BatchPostJobRow['status']; last_error?: string }) =>
    unwrap(api.patch(`/gl/batch-post/jobs/${id}/status`, body)),

  claimNextBatchPostJob: () =>
    unwrap(api.post<{ success: true; data: BatchPostJobRow | null }>('/gl/batch-post/jobs/claim-next', {})),

  processBatchPostJob: (id: number, body?: { max_items?: number }) =>
    unwrap(api.post<{ success: true; data: { processed: number; failed: number; errors: string[] } }>(`/gl/batch-post/jobs/${id}/process`, body ?? {})),

  entryTrace: (id: number) => unwrap(api.get<EntryTraceResult>(`/gl/entries/${id}/trace`)),

  // Note: bankAccounts lives in finance domain but kept here for backward compat
  bankAccounts: () => unwrap(api.get<BankAccount[]>('/finance/bank-accounts')),

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
    type: 'inventory_in' | 'inventory_out' | 'harvest' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
    bpg_code?: string | null; ppg_code?: string | null; ipg_code?: string | null
    ap_code?: string; cash_code?: string; receivable_code?: string; amount?: number
  }) => unwrap(api.post<ValidationBlueprint>('/gl/posting-setup/validate', body)),

  // ── Reconciliation ──────────────────────────────────────────────────────────
  reconciliationSourceDocs: (p?: {
    page?: number; size?: number; source_module?: string; status?: string
    from?: string; to?: string; mismatch_only?: '1'
  }) => api.get<SourceDocRow[]>(paginatedUrl('/gl/reconciliation/source-documents', p ?? {})).then((raw) => {
    const response = raw as unknown as {
      success: boolean
      error?: string
      data?: SourceDocRow[]
      total?: number
      page?: number
      page_size?: number
      summary?: ReconciliationSummary
    }

    if (!response.success) throw new Error(response.error || 'API returned success=false')

    return {
      data: response.data ?? [],
      total: response.total ?? 0,
      page: response.page ?? 1,
      page_size: response.page_size ?? 50,
      summary: response.summary ?? {
        total: 0,
        missing_business_event: 0,
        missing_journal_link: 0,
        event_link_mismatch: 0,
        posted_without_journal: 0,
        fully_linked: 0,
      },
    } satisfies ReconciliationResult
  }),

  // ── Master Data (Phase 1) ───────────────────────────────────────────────────
  // Material Groups
  materialGroups: (active?: boolean) =>
    unwrap(api.get<{ success: boolean; data: unknown[]; count: number }>(`/gl/master-data/material-groups${active ? '?active=1' : ''}`)),
  getMaterialGroup: (id: number) =>
    unwrap(api.get<{ success: boolean; data: unknown }>(`/gl/master-data/material-groups/${id}`)),
  createMaterialGroup: (body: { code: string; name: string; description?: string }) =>
    unwrap(api.post<{ success: boolean; data: unknown }>('/gl/master-data/material-groups', body)),
  updateMaterialGroup: (id: number, body: Partial<{ code: string; name: string; description: string }>) =>
    unwrap(api.patch<{ success: boolean; data: unknown }>(`/gl/master-data/material-groups/${id}`, body)),

  // Business Units
  businessUnits: (active?: boolean) =>
    unwrap(api.get<{ success: boolean; data: unknown[]; count: number }>(`/gl/master-data/business-units${active ? '?active=1' : ''}`)),
  getBusinessUnit: (id: number) =>
    unwrap(api.get<{ success: boolean; data: unknown }>(`/gl/master-data/business-units/${id}`)),
  createBusinessUnit: (body: { code: string; name: string; description?: string }) =>
    unwrap(api.post<{ success: boolean; data: unknown }>('/gl/master-data/business-units', body)),
  updateBusinessUnit: (id: number, body: Partial<{ code: string; name: string; description: string }>) =>
    unwrap(api.patch<{ success: boolean; data: unknown }>(`/gl/master-data/business-units/${id}`, body)),

  // Account Roles (read-only reference data)
  accountRoles: (category?: string) =>
    unwrap(api.get<{ success: boolean; data: unknown[]; count: number }>(`/gl/master-data/account-roles${category ? `?category=${category}` : ''}`)),

  // Currencies (read-only reference data)
  currencies: () =>
    unwrap(api.get<{ success: boolean; data: unknown[]; count: number }>('/gl/master-data/currencies')),

  // Costing Methods (read-only reference data)
  costingMethods: () =>
    unwrap(api.get<{ success: boolean; data: unknown[]; count: number }>('/gl/master-data/costing-methods')),

  // ── Exchange Rates (Phase 2) ─────────────────────────────────────────────────
  exchangeRates: (p?: { from?: string; to?: string; date?: string }) => {
    const params = new URLSearchParams()
    if (p?.from)  params.set('from',  p.from)
    if (p?.to)    params.set('to',    p.to)
    if (p?.date)  params.set('date',  p.date)
    const qs = params.toString()
    return unwrap(api.get<{ success: boolean; data: ExchangeRateRow[]; meta: { count: number } }>(
      `/gl/exchange-rates${qs ? `?${qs}` : ''}`
    ))
  },
  convertCurrency: (from: string, to: string, amount: number, date?: string) => {
    const params = new URLSearchParams({ from, to, amount: String(amount) })
    if (date) params.set('date', date)
    return unwrap(api.get<{ success: boolean; data: { from: string; to: string; amount: number; converted: number; rate: number } }>(
      `/gl/exchange-rates/convert?${params.toString()}`
    ))
  },
  createExchangeRate: (body: { from_currency: string; to_currency: string; rate: number; effective_date: string; source?: string }) =>
    unwrap(api.post<{ success: boolean; data: ExchangeRateRow }>('/gl/exchange-rates', body)),

  // ── Event Types (Phase 2) ────────────────────────────────────────────────────
  eventTypes: () =>
    unwrap(api.get<{ success: boolean; data: EventTypeRow[]; meta: { count: number } }>('/gl/event-types')),
  eventTypeModules: () =>
    unwrap(api.get<{ success: boolean; data: string[] }>('/gl/event-types/modules')),

  // ── Account Role Policy (Phase 3) ────────────────────────────────────────────
  accountRolePolicy: (active = true) =>
    unwrap(api.get<{ success: boolean; data: RolePolicyRow[]; meta: { count: number } }>(
      `/gl/account-role-policy${active ? '?active=1' : ''}`
    )),
  accountRolePolicyCoverage: () =>
    unwrap(api.get<{ success: boolean; data: RoleCoverageRow[]; meta: RoleCoverageMeta }>('/gl/account-role-policy/coverage')),
  resolveAccountByRole: (role: string) =>
    unwrap(api.get<{ success: boolean; data: RoleResolutionRow }>(`/gl/account-role-policy/resolve/${role}`)),
  createRoleMapping: (body: { role_code: string; account_code: string; priority?: number; notes?: string }) =>
    unwrap(api.post<{ success: boolean; data: RolePolicyRow }>('/gl/account-role-policy', body)),
  deleteRoleMapping: (id: number) =>
    unwrap(api.delete<{ success: boolean; data: { id: number; deactivated: boolean } }>(`/gl/account-role-policy/${id}`)),

  // ── GL Integrity Audit ───────────────────────────────────────────────────────
  glIntegrity: () => unwrap(api.get<{
    health: 'clean' | 'warning' | 'critical'
    critical_issues: number
    generated_at: string
    unbalanced_entries: {
      count: number
      rows: Array<{ id: number; entry_number: string | null; entry_date: string; description: string | null; source_module: string | null; total_dr: number; total_cr: number; imbalance: number }>
    }
    phantom_accounts: {
      count: number
      rows: Array<{ account_code: string; line_count: number; net_impact: number; first_seen: string; last_seen: string }>
      note: string | null
    }
    ops_vs_gl: {
      cash:      { ops_total: number; gl_total: number; gap: number; ok: boolean }
      suppliers: { ops_total: number; gl_total: number; gap: number; ok: boolean }
      inventory: { ops_total: number; gl_total: number; gap: number; ok: boolean }
      note: string
    }
    missing_period: { entry_count: number; total_debit: number; note: string | null }
    duplicate_events: {
      count: number
      rows: Array<{ event_type: string; source_module: string; source_id: number; entry_count: number }>
      note: string | null
    }
  }>('/gl/reconciliation/integrity')),

  glTrialBalance: (p?: { from?: string; to?: string }) => {
    const params = new URLSearchParams()
    if (p?.from) params.set('from', p.from)
    if (p?.to)   params.set('to',   p.to)
    const qs = params.toString()
    return unwrap(api.get<{
      rows: Array<{
        account_code: string; account_name: string | null
        account_type: string | null; normal_balance: string | null
        total_debit: number; total_credit: number
        net_balance: number; entry_count: number
      }>
      totals: { total_debit: number; total_credit: number }
      is_balanced: boolean
      phantom_count: number
      date_range: { from: string | null; to: string | null }
    }>(`/gl/reconciliation/trial-balance${qs ? '?' + qs : ''}`))
  },

  repairPhantomAccounts: () => unwrap(api.post<{
    inserted: number; codes: string[]; message: string
  }>('/gl/reconciliation/repair-phantom-accounts', {})),

  backfillAccountCodes: () => unwrap(api.post<{
    total_lines_updated: number
    detail: Array<{ from: string; to: string; label: string; rows_updated: number; skipped: boolean }>
    message: string
  }>('/gl/reconciliation/backfill-account-codes', {})),

  orphans: () => unwrap(api.get<{
    total: number
    rows: Array<{
      id: number
      entry_date: string
      description: string | null
      ref_type: string | null
      ref_id: number | null
      debit_total: number
      credit_total: number
      diff: number
    }>
  }>('/gl/orphans')),
}

// ── Reconciliation types (shared with ReconciliationPage, PeriodCloseCockpit) ─

export interface SourceDocRow {
  id: number
  source_module: string
  source_id: number
  document_type: string
  event_id: number | null
  event_date: string
  source_document_status: string
  business_event_status: string | null
  business_event_journal_entry_id: number | null
  linked_journal_entry_id: number | null
  linked_entry_date: string | null
  linked_entry_description: string | null
  has_business_event: number
  has_journal_link: number
  reconciliation_status: 'ok' | 'missing_business_event' | 'missing_journal_link' | 'event_link_mismatch' | 'posted_without_journal'
}

export interface ReconciliationSummary {
  total: number
  missing_business_event: number
  missing_journal_link: number
  event_link_mismatch: number
  posted_without_journal: number
  fully_linked: number
}

export interface ReconciliationResult {
  data: SourceDocRow[]
  total: number
  page: number
  page_size: number
  summary: ReconciliationSummary
}
