// D1 row shape for the posting_rules table.

export type PostingRuleType = 'general' | 'inventory' | 'control'

export interface PostingRuleRow {
  id:                      number
  company_id:              number
  rule_type:               PostingRuleType

  // Routing dimensions — NULL means wildcard
  bus_posting_group_code:  string | null
  prod_posting_group_code: string | null
  inv_posting_group_code:  string | null
  wh_id:                   number | null
  movement_type:           string | null

  // Control/singleton mappings
  mapping_key:             string | null
  account_code:            string | null

  // General posting slots
  sales_account:           string | null
  purchases_account:       string | null
  cogs_account:            string | null
  sales_returns_account:   string | null
  purch_returns_account:   string | null
  expense_account:         string | null

  // Inventory posting slots
  inventory_account:       string | null
  wip_account:             string | null
  finished_goods_account:  string | null

  // Validity and priority
  valid_from:              string | null   // YYYY-MM-DD
  valid_to:                string | null   // YYYY-MM-DD
  priority:                number          // legacy, default 100
  priority_index:          number          // 1=exact, 2=wildcard, 3=default
  is_active:               number          // 0 | 1

  // Audit
  migrated_from_v1:        number          // 0 | 1
  last_modified_by:        number | null
  last_modified_at:        string | null
  created_at:              string
  updated_at:              string
}
