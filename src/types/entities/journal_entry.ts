// D1 row shape for the journal_entries table.
// Use as the generic parameter on db.prepare().first<JournalEntryRow>() or .all<JournalEntryRow>().

export interface JournalEntryRow {
  id:                   number
  company_id:           number
  period_id:            number | null
  entry_number:         string | null
  entry_date:           string           // YYYY-MM-DD
  description:          string
  ref_type:             string | null    // 'cash_transaction' | 'supplier_transaction' | 'inventory_movement' | 'manual' | 'business_event'
  ref_id:               number | null
  is_posted:            number           // SQLite integer boolean: 0 | 1
  status:               string           // 'posted' | 'draft' | 'reversed'
  created_by:           number | null
  created_at:           string           // ISO datetime
  local_id:             string | null
  posting_rule_trace:   string | null    // JSON string
  business_event_id:    string | null
  business_event_type:  string | null
  posting_rule_id:      string | null
  resolution_id:        string | null
  generated_by:         string | null
  trace_checksum:       string | null
  source_link_id:       number | null
}

// D1 row shape for the journal_entry_lines table.
export interface JournalEntryLineRow {
  id:                        number
  entry_id:                  number
  company_id:                number
  account_code:              string
  debit:                     number
  credit:                    number
  description:               string | null
  center_code:               number | null
  season_id:                 number | null
  field_id:                  number | null
  rule_slot:                 string | null
  source_ledger:             'cash' | 'supplier' | 'inventory' | 'manual' | 'adjustment' | 'harvest' | null
  source_record_id:          number | null
  currency_code:             string         // default 'EGP'
  amount_in_base_currency:   number | null
  business_unit_id:          number | null
  account_role_id:           number | null
  business_event_id:         string | null
  posting_rule_id:           string | null
  resolution_id:             string | null
  source_module:             string | null
  rule_classification:       string | null
  generated_at:              string | null  // ISO datetime
}
