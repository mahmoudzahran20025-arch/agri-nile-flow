export type Env = {
  DB:         D1Database
  JWT_SECRET: string
  APP_ENV:    string
}

export type JwtPayload = {
  sub:        number     // user_id
  company_id: number
  role:       string
  exp:        number
}

export type ApiResponse<T = unknown> =
  | { success: true;  data: T;      message?: string }
  | { success: false; error: string; code?: string }

export type PaginatedResponse<T> = {
  data:       T[]
  total:      number
  page:       number
  page_size:  number
  has_more:   boolean
}

// ─── DB Row Shapes ────────────────────────────────────────────
export type DbUser = {
  id:            number
  email:         string
  password_hash: string
  password_salt: string
  full_name:     string
  phone:         string | null
  is_active:     number
  last_login:    string | null
  created_at:    string
}

export type DbSupplier = {
  code:       number
  company_id: number
  name:       string
  activity:   string | null
  notes:      string | null
  is_active:  number
  created_at: string
}

export type DbCashTransaction = {
  id:              number
  company_id:      number
  season_id:       number | null
  supplier_code:   number | null
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
  created_at:      string
}

export type DbInventoryBalance = {
  company_id:   number
  warehouse:    string
  item_code:    number
  item_name:    string
  unit:         string | null
  total_in:     number
  total_out:    number
  balance_qty:  number
  balance_value: number
}

export type DbSupplierTransaction = {
  id:                   number
  company_id:           number
  season_id:            number | null
  supplier_code:        number | null
  supplier_name:        string | null
  account_code:         number | null
  center_code:          number | null
  transaction_date:     string
  entry_type:           string
  document_type:        string | null
  document_number:      number | null
  expense_category:     string | null
  unit:                 string | null
  quantity:             number | null
  unit_price:           number | null
  amount:               number
  credit:               number
  debit:                number
  check_amount:         number
  balance_no_checks:    number | null
  balance_with_checks:  number | null
  notes:                string | null
  created_at:           string
}
