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

  /** @deprecated Use posting groups + posting setup instead. Kept for backward-compat UI only. */
  mappings:     () => unwrap(api.get<unknown[]>('/gl/mappings')),
  /** @deprecated Use posting groups + posting setup instead. Kept for backward-compat UI only. */
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

  // ── Health & Validate ───────────────────────────────────────────────────────
  postingHealth:    () => unwrap(api.get<PostingHealthResult>('/gl/posting-setup/health')),
  validatePosting:  (body: {
    type: 'inventory_in' | 'inventory_out' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
    bpg_code?: string | null; ppg_code?: string | null; ipg_code?: string | null
    ap_code?: string; cash_code?: string; receivable_code?: string; amount?: number
  }) => unwrap(api.post<ValidationBlueprint>('/gl/posting-setup/validate', body)),
}
