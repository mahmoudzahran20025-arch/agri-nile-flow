// D1 row shape for the inventory_movements table.

export type GlPostingStatus = 'posted' | 'pending' | 'failed' | 'skipped'

export interface InventoryMovementRow {
  id:                          number
  company_id:                  number
  season_id:                   number | null
  supplier_code:               number | null
  item_code:                   number
  center_code:                 number | null
  account_code:                number | null
  sub_code:                    number | null
  movement_date:               string             // YYYY-MM-DD
  warehouse_id:                number
  movement_type:               string
  document_number:             string | null
  invoice_number:              string | null
  po_number:                   string | null
  batch_number:                string | null
  expiry_date:                 string | null
  package_type:                string | null
  pack_capacity:               number | null
  pack_count:                  number | null
  quantity:                    number
  unit_price:                  number | null
  qty_in:                      number
  qty_out:                     number
  balance_qty:                 number | null
  value_in:                    number
  value_out:                   number
  balance_value:               number | null
  year:                        number | null
  month:                       number | null
  notes:                       string | null
  field_id:                    number | null
  work_order_id:               number | null
  work_task_id:                number | null
  purchase_delivery_id:        number | null
  sales_delivery_id:           number | null
  created_by_user_id:          number | null
  is_offline_origin:           number             // 0 | 1
  device_id:                   string | null
  local_id:                    string | null
  created_at:                  string             // ISO datetime
  status:                      string | null      // 'posted' | 'draft' | 'void'
  journal_entry_id:            number | null
  dest_warehouse_id:           number | null
  related_movement_id:         number | null
  zero_value_reason:           string | null
  zero_value_approved_by_role: string | null
  posting_mode:                string | null
  gl_posting_status:           GlPostingStatus
  gl_posting_error:            string | null
  gl_posted_at:                string | null
  version:                     number
  transaction_id:              number | null
  statement_text:              string | null
  service_type_code:           string | null
  requires_human_review:       number             // 0 | 1
  blocking_reason:             string | null
  crop_cycle_id:               number | null
}
