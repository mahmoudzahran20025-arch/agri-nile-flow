export type WipSourceModule = 'inventory' | 'hr' | 'operations' | 'assets' | 'manual'
export type WipAllocationMethod = 'percentage' | 'machine_hours' | 'acreage' | 'manual'

export interface WipLedgerRow {
  id:                number
  company_id:        number
  crop_cycle_id:     number
  season_id:         number
  transaction_date:  string        // YYYY-MM-DD
  // Legacy enum column — kept for backwards compat; new code writes cost_category_code too
  cost_category:     string
  // FK to cost_categories.code — authoritative from Phase 3 onward
  cost_category_code: string | null
  subcategory_code:  string | null
  debit:             number
  credit:            number
  running_balance:   number
  description:       string | null
  source_module:     WipSourceModule | null
  source_id:         number | null
  transaction_ref:   string | null
  journal_entry_id:  number | null
  allocation_method: WipAllocationMethod | null
  allocation_share:  number | null   // 0.0–1.0
  created_by:        number | null
  created_at:        string
}
