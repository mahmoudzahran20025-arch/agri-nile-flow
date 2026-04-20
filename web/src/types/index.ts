// ─── Auth ─────────────────────────────────────────────────────
export interface User {
  id:         number
  email:      string
  full_name:  string
  phone?:     string
}

export interface Company {
  id:   number
  code: string
  name: string
}

export interface AuthState {
  token:      string | null
  user:       User | null
  company:    Company | null
  role:       string | null
}

// ─── API ──────────────────────────────────────────────────────
export type ApiOk<T>  = { success: true;  data: T; message?: string }
export type ApiErr    = { success: false; error: string; code?: string }
export type ApiResult<T> = ApiOk<T> | ApiErr

export interface Paginated<T> {
  data:      T[]
  total:     number
  page:      number
  page_size: number
  has_more:  boolean
}

// ─── Domain ───────────────────────────────────────────────────
export interface Supplier {
  code:            number
  company_id:      number
  name:            string
  activity:        string | null
  notes:           string | null
  is_active:       number
  total_credit?:   number
  total_debit?:    number
  current_balance?: number
}

export interface SupplierTransaction {
  id:                  number
  transaction_date:    string
  entry_type:          string
  document_type:       string | null
  document_number:     number | null
  expense_category:    string | null
  unit:                string | null
  quantity:            number | null
  unit_price:          number | null
  amount:              number
  credit:              number
  debit:               number
  check_amount:        number
  balance_no_checks:   number | null
  balance_with_checks: number | null
  notes:               string | null
  year:                number | null
  month:               number | null
}

export interface CashTransaction {
  id:              number
  transaction_date: string
  direction:       string
  document_number: number | null
  recipient_name:  string | null
  narration:       string | null
  amount:          number
  debit:           number
  credit:          number
  running_balance: number | null
  year:            number | null
  month:           number | null
  notes:           string | null
}

export interface InventoryBalance {
  warehouse:     string
  item_code:     number
  item_name:     string | null
  unit:          string | null
  total_in:      number
  total_out:     number
  balance_qty:   number
  balance_value: number
}

export interface InventoryMovement {
  id:            number
  movement_date: string
  warehouse:     string
  movement_type: string
  item_code:     number
  item_name:     string | null
  unit:          string | null
  quantity:      number
  unit_price:    number | null
  qty_in:        number
  qty_out:       number
  balance_qty:   number | null
  value_in:      number
  value_out:     number
  balance_value: number | null
  supplier_name: string | null
  document_number: number | null
  notes:         string | null
}

export interface DashboardStats {
  cash_balance:    number
  net_payable:     number
  inventory_value: number
  partners_equity: number
}

export interface Season {
  id:          number
  company_id:  number
  name:        string
  season_type: string
  start_date:  string
  end_date:    string
  status:      string
}

export interface Item {
  code:              number
  company_id:        number
  name:              string
  unit:              string | null
  warehouse:         string | null
  reorder_threshold: number
  is_active:         number
}

export interface CostCenter {
  code:       number
  company_id: number
  name:       string
}

export interface Partner {
  id:           number
  company_id:   number
  name:         string
  capital_paid: number
  current_acct: number
}
