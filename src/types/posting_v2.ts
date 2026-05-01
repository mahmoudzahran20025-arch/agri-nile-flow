/**
 * src/types/posting_v2.ts
 * 
 * Type definitions for Posting Engine V2
 * Backward compatible with V1 while adding new fields
 */

// ============================================================================
// POSTING RULES
// ============================================================================

export interface PostingRuleV2 {
  id: number
  company_id: number
  rule_type: 'general' | 'inventory' | 'control'

  // Routing Dimensions
  bus_posting_group_code?: string | null
  prod_posting_group_code?: string | null
  inv_posting_group_code?: string | null
  wh_id?: number | null  // Warehouse dimension (NEW)
  material_group_id?: number | null  // Material group (future)

  // For control/singleton mappings
  mapping_key?: string | null
  account_code?: string | null

  // Account slots (V1 compatibility — Phase 1-2)
  sales_account?: string | null
  purchases_account?: string | null
  cogs_account?: string | null
  sales_returns_account?: string | null
  purch_returns_account?: string | null
  expense_account?: string | null

  // Inventory slots
  inventory_account?: string | null
  wip_account?: string | null
  finished_goods_account?: string | null

  // Validity dating (NEW)
  valid_from?: string | null  // YYYY-MM-DD
  valid_to?: string | null    // YYYY-MM-DD

  // Cascade priority
  priority_index: number  // 1=exact, 2=wildcard, 3=default

  priority?: number  // V1 compat
  is_active: number

  // Audit
  last_modified_by?: number
  last_modified_at?: string
  migrated_from_v1?: number

  created_at?: string
  updated_at?: string
}

export interface PostingRuleCreatePayload {
  rule_type: 'general' | 'inventory' | 'control'
  bus_posting_group_code?: string | null
  prod_posting_group_code?: string | null
  inv_posting_group_code?: string | null
  wh_id?: number | null
  mapping_key?: string | null
  account_code?: string | null
  sales_account?: string | null
  purchases_account?: string | null
  cogs_account?: string | null
  sales_returns_account?: string | null
  purch_returns_account?: string | null
  expense_account?: string | null
  inventory_account?: string | null
  valid_from?: string | null
  valid_to?: string | null
}

// ============================================================================
// JOURNAL ENTRIES AND LINES
// ============================================================================

export interface JournalLineV2 {
  id: number
  entry_id: number
  line_number?: number

  // Account
  account_code: string

  // Amounts
  debit: number
  credit: number

  // NEW: Multi-currency support
  currency_code: string  // Defaults to company base currency
  amount_in_base_currency?: number  // Converted to base currency

  // NEW: Dimensions
  business_unit_id?: number | null
  center_code?: number | null
  season_id?: number | null
  field_id?: number | null

  // For Phase 3
  account_role_id?: number | null

  // Description and source
  description?: string
  source_line_id?: number  // Links to source transaction line

  created_at: string
}

export interface JournalEntryV2 {
  id: number
  entry_date: string
  entry_type: string  // 'auto', 'manual', 'reversal', etc.
  period_id?: number
  company_id: number
  currency_id?: string  // NEW: for multi-currency entries

  lines: JournalLineV2[]

  is_posted: number
  posted_date?: string
  posted_by?: number

  ref_type?: string  // 'invoice', 'receipt', 'payment', etc.
  ref_id?: number
  description?: string

  created_at: string
  created_by?: number
}

// ============================================================================
// MASTER DATA
// ============================================================================

export interface MaterialGroup {
  id: number
  company_id: number
  code: string
  name: string
  description?: string
  is_active: number
  created_at?: string
}

export interface BusinessUnit {
  id: number
  company_id: number
  code: string
  name: string
  description?: string
  is_active: number
  created_at?: string
}

export interface AccountRole {
  id: number
  code: string
  name: string
  description?: string
  category: 'INVENTORY' | 'P&L' | 'BALANCE_SHEET' | 'CONTROL'
  is_active: number
}

export interface Currency {
  id: number
  code: string
  name: string
  symbol?: string
  decimal_places: number
  is_active: number
}

export interface CostingMethod {
  id: number
  code: string
  name: string
  description?: string
  is_active: number
}

// ============================================================================
// EXCHANGE RATES (Phase 2)
// ============================================================================

export interface ExchangeRate {
  id: number
  from_currency: string
  to_currency: string
  rate: number
  effective_date: string  // YYYY-MM-DD
  source: 'MANUAL' | 'API' | 'CBE'
  is_active: number
  created_at?: string
}

// ============================================================================
// BUSINESS EVENTS (Event-driven architecture)
// ============================================================================

export interface BusinessEventV2 {
  id: number
  company_id: number
  event_type: string  // Should reference md_event_types.code
  event_date: string
  source_module: string  // inventory, procurement, sales, etc.
  source_id: number
  payload: Record<string, any>
  status: 'pending' | 'posted' | 'error' | 'reversed'
  error_message?: string
  journal_entry_id?: number
  posted_by?: number
  posted_at?: string
  created_at: string
}

export interface EventType {
  id: number
  code: string
  name: string
  description?: string
  affects_inventory: number
  affects_wip: number
  affects_cogs: number
  affects_revenue: number
  affects_expense: number
  is_active: number
}

export interface TransactionType {
  id: number
  code: string
  name: string
  module_name: string
  is_active: number
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================

export interface GLJournalAuditEntry {
  id: number
  journal_entry_id: number
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'POST' | 'REVERSE' | 'CORRECT'
  old_value_json?: string  // JSON
  new_value_json?: string  // JSON
  changed_by?: number
  changed_at: string
  notes?: string
}

// ============================================================================
// RESOLUTION RESULTS
// ============================================================================

export interface PostingResolution {
  rule: PostingRuleV2
  step: number  // 1-4, indicates cascade level
  matched_at: string
  trace: ResolutionTrace
}

export interface ResolutionTrace {
  rule_type: string
  input_bpg?: string | null
  input_ppg?: string | null
  input_ipg?: string | null
  input_wh_id?: number | null
  resolution_step: number
  matched_rule_id: number | null
  resolved_accounts: Record<string, string>  // role → account_code
  resolved_at: string
}

export interface ValidationBlueprint {
  lines: JournalLineV2[]
  validationErrors: string[]
  warnings: string[]
  isBlocked: boolean
  trace: ResolutionTrace | null
}

// ============================================================================
// REQUESTS/RESPONSES
// ============================================================================

export interface CreateMaterialGroupRequest {
  code: string
  name: string
  description?: string
}

export interface CreateBusinessUnitRequest {
  code: string
  name: string
  description?: string
}

export interface UpdatePostingRuleValidityRequest {
  valid_from?: string | null
  valid_to?: string | null
  priority_index?: number
}

export interface ConvertCurrencyRequest {
  amount: number
  from_currency: string
  to_currency: string
  rate_date: string  // YYYY-MM-DD
}

export interface ConvertCurrencyResponse {
  original_amount: number
  original_currency: string
  converted_amount: number
  converted_currency: string
  rate: number
  rate_date: string
}

export interface SetExchangeRateRequest {
  from_currency: string
  to_currency: string
  rate: number
  effective_date: string  // YYYY-MM-DD
  source?: 'MANUAL' | 'API' | 'CBE'
}

// ============================================================================
// API RESPONSE ENVELOPE
// ============================================================================

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
  code?: string
}

export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  total: number
  page: number
  page_size: number
}
