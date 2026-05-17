export type HarvestSettlementStatus = 'draft' | 'posted' | 'reversed'
export type HarvestDisposition = 'stored' | 'sold'
export type HarvestSettlementMode = 'inventory' | 'direct_sale'

export interface HarvestSettlementRow {
  id:                     number
  company_id:             number
  crop_cycle_id:          number
  harvest_record_id:      number | null
  disposition:            HarvestDisposition
  settlement_mode:        HarvestSettlementMode
  total_wip_cost:         number
  qty_tons:               number | null
  cost_per_ton:           number | null
  // Stored disposition
  inventory_value:        number | null
  warehouse_id:           number | null
  item_code:              number | null
  // Sold disposition
  revenue:                number | null
  buyer_name:             string | null
  // GL trace
  wip_gl_entry_id:        number | null
  inventory_gl_entry_id:  number | null
  cogs_gl_entry_id:       number | null
  revenue_gl_entry_id:    number | null
  settlement_date:        string        // YYYY-MM-DD
  status:                 HarvestSettlementStatus
  notes:                  string | null
  created_by:             number | null
  created_at:             string
}
