PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE companies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    UNIQUE NOT NULL,
  name         TEXT    NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
, costing_method TEXT DEFAULT 'ACTUAL' CHECK(costing_method IN ('ACTUAL', 'STANDARD', 'FIFO', 'MOVING_AVERAGE', 'LIFO')), base_currency_code TEXT DEFAULT 'EGP');
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  phone         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    UNIQUE NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT,
  UNIQUE (module, action)
);
CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_companies (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id),
  is_active  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, company_id, role_id)
);
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  company_id  INTEGER REFERENCES companies(id),
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  record_id   INTEGER,
  old_value   TEXT,
  new_value   TEXT,
  ip_address  TEXT,
  device_id   TEXT,
  source      TEXT NOT NULL DEFAULT 'web',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE seasons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  season_type  TEXT    NOT NULL DEFAULT 'winter',
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'planning',
  notes        TEXT, closed_at TEXT, closed_by TEXT, close_notes TEXT,
  UNIQUE (company_id, name)
);
CREATE TABLE suppliers (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  activity     TEXT,
  notes        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')), bus_posting_group_code TEXT, phone         TEXT, email         TEXT, address       TEXT, tax_number    TEXT, credit_limit  REAL, payment_terms INTEGER NOT NULL DEFAULT 30, supplier_type TEXT NOT NULL DEFAULT 'supplier', gl_account_code        INTEGER,
  PRIMARY KEY (code, company_id)
);
CREATE TABLE expense_types (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL, gl_account_code TEXT DEFAULT NULL, asset_nature TEXT DEFAULT 'expense'
                           CHECK(asset_nature IN ('expense', 'capital_asset', 'consumable_asset')),
  PRIMARY KEY (code, company_id)
);
CREATE TABLE sub_locations (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  PRIMARY KEY (code, company_id)
);
CREATE TABLE items (
  code              INTEGER NOT NULL,
  company_id        INTEGER NOT NULL REFERENCES companies(id),
  name              TEXT    NOT NULL,
  unit              TEXT,
  warehouse         TEXT,
  reorder_threshold REAL    NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1, category_id INTEGER REFERENCES item_categories(id), track_lots INTEGER NOT NULL DEFAULT 0, prod_posting_group_code TEXT, inv_posting_group_code TEXT, posting_group_code TEXT, bus_posting_group_code TEXT, standard_cost REAL, costing_method TEXT NOT NULL DEFAULT 'moving_average'
  CHECK(costing_method IN ('moving_average', 'fifo')),
  PRIMARY KEY (code, company_id)
);
CREATE TABLE partners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  name          TEXT    NOT NULL,
  capital_paid  REAL    NOT NULL DEFAULT 0,
  current_acct  REAL    NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE supplier_transactions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            INTEGER NOT NULL REFERENCES companies(id),
  season_id             INTEGER REFERENCES seasons(id),
  supplier_code         INTEGER,
  account_code          INTEGER,
  center_code           INTEGER,
  sub_code              INTEGER,
  transaction_date      TEXT    NOT NULL,
  entry_type            TEXT    NOT NULL,
  document_type         TEXT,
  document_number       INTEGER,
  expense_category      TEXT,
  equipment             TEXT,
  unit                  TEXT,
  quantity              REAL,
  unit_price            REAL,
  amount                REAL    NOT NULL DEFAULT 0,
  credit                REAL    NOT NULL DEFAULT 0,
  debit                 REAL    NOT NULL DEFAULT 0,
  check_amount          REAL    NOT NULL DEFAULT 0,
  due_date              TEXT,
  balance_no_checks     REAL,
  balance_with_checks   REAL,
  check_clearance_date  TEXT,
  year                  INTEGER,
  month                 INTEGER,
  notes                 TEXT,
  work_order_id         INTEGER,
  employee_id           INTEGER,
  purchase_contract_id  INTEGER,
  sales_contract_id     INTEGER,
  created_by_user_id    INTEGER REFERENCES users(id),
  is_offline_origin     INTEGER NOT NULL DEFAULT 0,
  device_id             TEXT,
  local_id              TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
, status TEXT NOT NULL DEFAULT 'posted', journal_entry_id INTEGER, description TEXT DEFAULT NULL, financial_account_id INTEGER, equipment_type_id INTEGER, equipment_usage_mode TEXT
  CHECK(equipment_usage_mode IN ('owned', 'rental')));
CREATE TABLE cash_transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  season_id        INTEGER REFERENCES seasons(id),
  supplier_code    INTEGER,
  center_code      INTEGER,
  expense_code     INTEGER,
  sub_code         INTEGER,
  transaction_date TEXT    NOT NULL,
  direction        TEXT    NOT NULL,
  document_number  INTEGER,
  recipient_name   TEXT,
  narration        TEXT,
  season_service   TEXT,
  unit             TEXT,
  quantity         REAL,
  unit_price       REAL,
  amount           REAL    NOT NULL DEFAULT 0,
  debit            REAL    NOT NULL DEFAULT 0,
  credit           REAL    NOT NULL DEFAULT 0,
  running_balance  REAL,
  year             INTEGER,
  month            INTEGER,
  notes            TEXT,
  work_order_id    INTEGER,
  employee_id      INTEGER,
  purchase_contract_id INTEGER,
  created_by_user_id   INTEGER REFERENCES users(id),
  is_offline_origin    INTEGER NOT NULL DEFAULT 0,
  device_id            TEXT,
  local_id             TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
, journal_entry_id INTEGER REFERENCES journal_entries(id), status TEXT NOT NULL DEFAULT 'posted', document_type TEXT, field_id INTEGER REFERENCES fields(id), financial_account_id INTEGER REFERENCES bank_accounts(id), partner_id           INTEGER REFERENCES partners(id));
CREATE TABLE inventory_movements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  season_id        INTEGER REFERENCES seasons(id),
  supplier_code    INTEGER,
  item_code        INTEGER,
  center_code      INTEGER,
  account_code     INTEGER,
  sub_code         INTEGER,
  movement_date    TEXT    NOT NULL,
  warehouse        TEXT    NOT NULL,
  movement_type    TEXT    NOT NULL,
  document_number  INTEGER,
  invoice_number   INTEGER,
  po_number        INTEGER,
  package_type     TEXT,
  pack_capacity    REAL,
  pack_count       REAL,
  quantity         REAL    NOT NULL DEFAULT 0,
  unit_price       REAL,
  qty_in           REAL    NOT NULL DEFAULT 0,
  qty_out          REAL    NOT NULL DEFAULT 0,
  balance_qty      REAL,
  value_in         REAL    NOT NULL DEFAULT 0,
  value_out        REAL    NOT NULL DEFAULT 0,
  balance_value    REAL,
  year             INTEGER,
  month            INTEGER,
  notes            TEXT,
  field_id         INTEGER,
  work_order_id    INTEGER,
  work_task_id     INTEGER,
  purchase_delivery_id INTEGER,
  sales_delivery_id    INTEGER,
  created_by_user_id   INTEGER REFERENCES users(id),
  is_offline_origin    INTEGER NOT NULL DEFAULT 0,
  device_id            TEXT,
  local_id             TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
, status TEXT DEFAULT 'posted', journal_entry_id INTEGER, warehouse_id INTEGER REFERENCES warehouses(id), dest_warehouse_id INTEGER REFERENCES warehouses(id), related_movement_id INTEGER REFERENCES inventory_movements(id), zero_value_reason TEXT, zero_value_approved_by_role TEXT, posting_mode TEXT, gl_posting_status TEXT NOT NULL DEFAULT 'posted', gl_posting_error TEXT, gl_posted_at TEXT, version INTEGER NOT NULL DEFAULT 0, transaction_id INTEGER REFERENCES inventory_transactions(id));
CREATE TABLE employees (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  national_id     TEXT,
  name            TEXT    NOT NULL,
  role_title      TEXT,
  phone           TEXT,
  hire_date       TEXT,
  daily_wage      REAL    NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE work_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  season_id       INTEGER REFERENCES seasons(id),
  field_id        INTEGER REFERENCES fields(id),
  code            TEXT,
  name            TEXT    NOT NULL,
  operation_type  TEXT    NOT NULL, -- ري / تسميد / رش / حصاد / حراثة / زراعة / أخرى
  planned_date    TEXT    NOT NULL,
  actual_date     TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending/in_progress/done/cancelled
  area_feddan     REAL,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
, center_code INTEGER);
CREATE TABLE work_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id   INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  employee_id     INTEGER REFERENCES employees(id),
  task_date       TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  quantity        REAL,
  unit            TEXT,
  unit_cost       REAL    NOT NULL DEFAULT 0,
  total_cost      REAL    GENERATED ALWAYS AS (COALESCE(quantity,1) * unit_cost) STORED,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
, journal_entry_id INTEGER);
CREATE TABLE purchase_contracts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  season_id        INTEGER REFERENCES seasons(id),
  supplier_code    INTEGER,
  contract_number  TEXT    NOT NULL,
  contract_date    TEXT    NOT NULL,
  subject          TEXT    NOT NULL,
  total_value      REAL    NOT NULL DEFAULT 0,
  paid_value       REAL    NOT NULL DEFAULT 0,
  delivery_date    TEXT,
  status           TEXT    NOT NULL DEFAULT 'draft', -- draft/active/partial/completed/cancelled
  notes            TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (contract_number, company_id)
);
CREATE TABLE sales_contracts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  season_id        INTEGER REFERENCES seasons(id),
  buyer_name       TEXT    NOT NULL,
  buyer_phone      TEXT,
  contract_number  TEXT    NOT NULL,
  contract_date    TEXT    NOT NULL,
  crop_type        TEXT    NOT NULL,
  quantity_ton     REAL    NOT NULL DEFAULT 0,
  unit_price       REAL    NOT NULL DEFAULT 0,
  total_value      REAL    GENERATED ALWAYS AS (quantity_ton * unit_price) STORED,
  advance_paid     REAL    NOT NULL DEFAULT 0,
  delivery_date    TEXT,
  field_id         INTEGER REFERENCES fields(id),
  status           TEXT    NOT NULL DEFAULT 'draft', -- draft/active/partial/completed/cancelled
  notes            TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')), advance_gl_entry_id INTEGER REFERENCES journal_entries(id),
  UNIQUE (contract_number, company_id)
);
CREATE TABLE chart_of_accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  code           TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  account_type   TEXT    NOT NULL CHECK(account_type IN ('asset','liability','equity','revenue','expense')),
  normal_balance TEXT    NOT NULL CHECK(normal_balance IN ('debit','credit')),
  parent_code    TEXT,
  level          INTEGER NOT NULL DEFAULT 1,
  is_header      INTEGER NOT NULL DEFAULT 0,  -- 1 = رأس مجموعة / لا يُقيَّد عليه مباشرة
  is_active      INTEGER NOT NULL DEFAULT 1,
  notes          TEXT, mapping TEXT, mapping_detailed TEXT, updated_at TEXT,
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE TABLE financial_periods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  period_type TEXT    NOT NULL DEFAULT 'monthly'
              CHECK(period_type IN ('monthly','quarterly','annual')),
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  is_closed   INTEGER NOT NULL DEFAULT 0,
  closed_at   TEXT,
  closed_by   INTEGER, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','locked')),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE TABLE journal_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  period_id    INTEGER,
  entry_number TEXT,
  entry_date   TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  ref_type     TEXT,   -- cash_transaction | supplier_transaction | inventory_movement | manual
  ref_id       INTEGER,
  is_posted    INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')), local_id TEXT, posting_rule_trace TEXT,
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(period_id)  REFERENCES financial_periods(id)
);
CREATE TABLE journal_entry_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id     INTEGER NOT NULL,
  company_id   INTEGER NOT NULL,
  account_code TEXT    NOT NULL,
  debit        REAL    NOT NULL DEFAULT 0,
  credit       REAL    NOT NULL DEFAULT 0,
  description  TEXT, center_code INTEGER, season_id INTEGER REFERENCES seasons(id), field_id INTEGER REFERENCES fields(id), rule_slot TEXT, source_ledger TEXT DEFAULT 'manual'
CHECK (source_ledger IN ('cash', 'supplier', 'inventory', 'manual', 'adjustment', 'harvest')), source_record_id INTEGER DEFAULT NULL, currency_code TEXT DEFAULT 'EGP', amount_in_base_currency REAL, business_unit_id INTEGER, account_role_id INTEGER,
  FOREIGN KEY(entry_id)   REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE TABLE staging_movements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  batch_id         TEXT    NOT NULL,             -- groups rows from one import session
  status           TEXT    NOT NULL DEFAULT 'pending',
                                                  -- pending | approved | rejected | promoted
  rejection_reason TEXT,
  -- Movement data (mirrors inventory_movements)
  movement_date    TEXT    NOT NULL,
  warehouse        TEXT    NOT NULL,
  movement_type    TEXT    NOT NULL,
  item_code        INTEGER,
  item_name_raw    TEXT,                          -- original text if item_code not resolved
  quantity         REAL    NOT NULL DEFAULT 0,
  unit_price       REAL,
  supplier_code    INTEGER,
  supplier_name_raw TEXT,
  document_number  INTEGER,
  season_id        INTEGER REFERENCES seasons(id),
  notes            TEXT,
  -- Validation state
  validation_errors TEXT,                         -- JSON array: ["ERR_MISSING_ITEM", ...]
  is_valid         INTEGER NOT NULL DEFAULT 0,    -- 1 if passed all validations
  -- Lifecycle
  created_by       INTEGER REFERENCES users(id),
  reviewed_by      INTEGER REFERENCES users(id),
  reviewed_at      TEXT,
  promoted_id      INTEGER,                       -- → inventory_movements.id after promotion
  promoted_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE offline_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  device_id     TEXT    NOT NULL,
  local_id      TEXT    NOT NULL,               -- client-generated UUID
  operation     TEXT    NOT NULL,               -- 'inventory_movement' | 'cash_tx' | 'supplier_tx'
  payload       TEXT    NOT NULL,               -- JSON of the operation
  status        TEXT    NOT NULL DEFAULT 'pending',
                                                -- pending | processing | done | error
  error_message TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT,
  UNIQUE (device_id, local_id)                  -- idempotent replay
);
CREATE TABLE item_units (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  item_code       INTEGER NOT NULL,
  unit_name       TEXT    NOT NULL,             -- e.g. 'كرتون', 'علبة', 'كجم'
  conversion_qty  REAL    NOT NULL DEFAULT 1,  -- 1 كرتون = 12 علبة → conversion_qty = 12
  is_base_unit    INTEGER NOT NULL DEFAULT 0,  -- the base unit has conversion_qty = 1
  UNIQUE (company_id, item_code, unit_name)
);
CREATE TABLE reorder_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id),
  item_code         INTEGER NOT NULL,
  warehouse         TEXT    NOT NULL,
  reorder_threshold REAL    NOT NULL DEFAULT 0,  -- trigger alert below this
  reorder_qty       REAL    NOT NULL DEFAULT 0,  -- suggested order quantity
  lead_time_days    INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  UNIQUE (company_id, item_code, warehouse)
);
CREATE TABLE branches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id),
  code              TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  address           TEXT,
  city              TEXT,
  country           TEXT    DEFAULT 'SA',
  phone             TEXT,
  manager_id        INTEGER REFERENCES employees(id),
  lat               REAL,
  lng               REAL,
  geofence_radius_m INTEGER DEFAULT 200,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(code, company_id)
);
CREATE TABLE employee_job_details (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id     INTEGER NOT NULL REFERENCES employees(id),
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  department      TEXT,
  branch_id       INTEGER REFERENCES branches(id),
  position_level  TEXT    DEFAULT 'junior',
  -- junior / mid / senior / manager
  contract_type   TEXT    DEFAULT 'full_time',
  -- full_time / part_time / seasonal / contractor
  shift_type      TEXT    DEFAULT 'morning',
  -- morning / evening / night / flexible
  base_salary     REAL    NOT NULL DEFAULT 0,
  housing_allow   REAL    DEFAULT 0,
  transport_allow REAL    DEFAULT 0,
  other_allows    REAL    DEFAULT 0,
  social_insur    REAL    DEFAULT 0,
  income_tax_pct  REAL    DEFAULT 0,
  bank_name       TEXT,
  bank_iban       TEXT,
  start_date      TEXT    NOT NULL DEFAULT (date('now')),
  end_date        TEXT,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id)
);
CREATE TABLE attendance_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    INTEGER NOT NULL REFERENCES employees(id),
  company_id     INTEGER NOT NULL REFERENCES companies(id),
  work_date      TEXT    NOT NULL,
  check_in       TEXT,
  check_out      TEXT,
  check_in_lat   REAL,
  check_in_lng   REAL,
  status         TEXT    NOT NULL DEFAULT 'present',
  -- present / absent / late / half_day / holiday / sick / leave
  late_minutes   INTEGER DEFAULT 0,
  overtime_hours REAL    DEFAULT 0,
  notes          TEXT,
  recorded_by    INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')), location_status  TEXT DEFAULT 'unverified', gps_accuracy_m  REAL, field_id         INTEGER REFERENCES fields(id),
  UNIQUE(employee_id, work_date)
);
CREATE TABLE leave_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  name          TEXT    NOT NULL,
  -- سنوية / مرضية / طارئة / بدون راتب
  days_per_year INTEGER DEFAULT 0,
  is_paid       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE leave_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  start_date    TEXT    NOT NULL,
  end_date      TEXT    NOT NULL,
  days_count    INTEGER NOT NULL DEFAULT 1,
  reason        TEXT,
  status        TEXT    NOT NULL DEFAULT 'pending',
  -- pending / approved / rejected / cancelled
  approved_by   INTEGER REFERENCES users(id),
  approved_at   TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE salary_advances (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  request_date TEXT    NOT NULL,
  amount       REAL    NOT NULL,
  reason       TEXT,
  repay_months INTEGER DEFAULT 1,
  status       TEXT    NOT NULL DEFAULT 'pending',
  -- pending / approved / rejected / paid
  approved_by  INTEGER REFERENCES users(id),
  approved_at  TEXT,
  cash_tx_id   INTEGER REFERENCES cash_transactions(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE payroll_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  period_year      INTEGER NOT NULL,
  period_month     INTEGER NOT NULL,
  run_date         TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'draft',
  -- draft / approved / paid / cancelled
  total_gross      REAL    NOT NULL DEFAULT 0,
  total_deductions REAL    NOT NULL DEFAULT 0,
  total_net        REAL    NOT NULL DEFAULT 0,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  approved_by      INTEGER REFERENCES users(id),
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')), payment_date TEXT, payment_gl_entry_id INTEGER REFERENCES journal_entries(id), season_id INTEGER REFERENCES seasons(id),
  UNIQUE(company_id, period_year, period_month)
);
CREATE TABLE payroll_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_run_id   INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id      INTEGER NOT NULL REFERENCES employees(id),
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  working_days     INTEGER NOT NULL DEFAULT 0,
  absent_days      INTEGER NOT NULL DEFAULT 0,
  overtime_hours   REAL    DEFAULT 0,
  base_salary      REAL    NOT NULL DEFAULT 0,
  housing_allow    REAL    DEFAULT 0,
  transport_allow  REAL    DEFAULT 0,
  other_allows     REAL    DEFAULT 0,
  gross_salary     REAL    NOT NULL DEFAULT 0,
  advance_deduct   REAL    DEFAULT 0,
  social_insur     REAL    DEFAULT 0,
  income_tax       REAL    DEFAULT 0,
  other_deductions REAL    DEFAULT 0,
  net_salary       REAL    NOT NULL DEFAULT 0,
  notes            TEXT
);
CREATE TABLE employee_assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  asset_name    TEXT    NOT NULL,
  asset_type    TEXT,
  -- laptop / car / phone / other
  serial_number TEXT,
  assigned_date TEXT    NOT NULL,
  return_date   TEXT,
  condition_in  TEXT,
  condition_out TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE documents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies(id),
  title               TEXT    NOT NULL,
  doc_type            TEXT    NOT NULL,
  -- commercial_reg / trade_license / safety_cert / civil_defense
  -- employee_contract / insurance / vehicle_license / other
  ref_table           TEXT,     -- employees / suppliers / companies / fields / vehicles
  ref_id              INTEGER,  -- FK to ref_table.id
  issue_date          TEXT,
  expiry_date         TEXT,     -- alerts generated from this
  responsible_user_id INTEGER   REFERENCES users(id),
  file_r2_key         TEXT,     -- Cloudflare R2 object key (future upload)
  file_name           TEXT,     -- original file name
  file_size_kb        INTEGER,
  status              TEXT    NOT NULL DEFAULT 'active',
  -- active / expired / renewed / cancelled
  notes               TEXT,
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE location_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  employee_id     INTEGER NOT NULL REFERENCES employees(id),
  assigned_by     INTEGER NOT NULL REFERENCES users(id),

  -- الموضع: إما حقل موجود أو موقع مخصص (الاثنان اختياريان — واحد منهم مطلوب)
  field_id        INTEGER REFERENCES fields(id),   -- ربط بحقل زراعي
  custom_lat      REAL,                             -- موقع مخصص (lat)
  custom_lng      REAL,                             -- موقع مخصص (lng)
  custom_name     TEXT,                             -- اسم الموقع المخصص

  -- إعدادات المهمة
  tolerance_m     INTEGER NOT NULL DEFAULT 150,     -- نطاق القبول (متر) — يُحدده المدير
  task_date       TEXT    NOT NULL,                 -- تاريخ المهمة
  task_notes      TEXT,                             -- ملاحظات المدير

  -- النتيجة بعد وصول الموظف
  status          TEXT    NOT NULL DEFAULT 'pending',
  -- pending = لم يصل بعد
  -- arrived = وصل داخل النطاق ✅
  -- outside  = وصل لكن خارج النطاق ⚠️ (تم التسجيل مع إشارة)
  -- missed   = لم يصل (انتهى اليوم)

  arrived_at      TEXT,     -- وقت الوصول
  arrived_lat     REAL,     -- GPS عند الوصول
  arrived_lng     REAL,
  distance_m      REAL,     -- المسافة الفعلية عند التسجيل
  gps_accuracy_m  REAL,     -- دقة GPS عند الوصول

  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE calendar_events (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id              INTEGER NOT NULL REFERENCES companies(id),
  created_by              INTEGER NOT NULL REFERENCES users(id),

  -- Ownership / assignment
  assigned_to_user        INTEGER REFERENCES users(id),
  assigned_to_employee    INTEGER REFERENCES employees(id),

  -- Content
  title                   TEXT    NOT NULL,
  description             TEXT,
  event_type              TEXT    NOT NULL DEFAULT 'task',
  -- Values: task | meeting | visit | reminder | other

  -- Priority
  priority                TEXT    NOT NULL DEFAULT 'normal',
  -- Values: low | normal | high | urgent

  -- Timing
  start_datetime          TEXT    NOT NULL,   -- ISO-8601 e.g. "2025-07-10T09:00"
  end_datetime            TEXT,               -- NULL = open-ended / all-day
  all_day                 INTEGER NOT NULL DEFAULT 0,  -- 1 = all-day event

  -- Status
  status                  TEXT    NOT NULL DEFAULT 'pending',
  -- Values: pending | in_progress | done | cancelled

  -- Optional GPS location (meeting room, field, client site …)
  location_name           TEXT,             -- human-readable label
  location_lat            REAL,
  location_lng            REAL,
  location_tolerance_m    INTEGER DEFAULT 150,   -- GPS check-in acceptance radius (metres)

  -- GPS check-in result (filled by employee when they "arrive")
  checkin_lat             REAL,
  checkin_lng             REAL,
  checkin_at              TEXT,             -- ISO-8601 timestamp
  location_verified       INTEGER DEFAULT 0,     -- 1 = within tolerance
  checkin_distance_m      REAL,

  -- Cross-reference to other modules (optional)
  -- e.g. link a visit task to a specific field or supplier
  ref_table               TEXT,   -- 'fields' | 'suppliers' | 'employees' | …
  ref_id                  INTEGER,

  -- Soft link to location_tasks (auto-created for visits with GPS)
  location_task_id        INTEGER REFERENCES location_tasks(id),

  -- Colour for calendar display (hex)
  color                   TEXT    DEFAULT '#3B82F6',

  -- Recurrence (future use — store RRULE string)
  recurrence_rule         TEXT,

  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE event_attendees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  employee_id INTEGER REFERENCES employees(id),
  name        TEXT,            -- free-text name (for external guests)
  email       TEXT,
  response    TEXT NOT NULL DEFAULT 'pending',
  -- Values: pending | accepted | declined
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE bank_accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  bank_name       TEXT    NOT NULL,             -- اسم البنك
  account_name    TEXT    NOT NULL,             -- اسم الحساب
  account_number  TEXT    NOT NULL,             -- رقم الحساب
  iban            TEXT,                         -- IBAN (اختياري)
  currency        TEXT    NOT NULL DEFAULT 'EGP',
  gl_account_code TEXT,                         -- ربط بشجرة الحسابات
  opening_balance REAL    NOT NULL DEFAULT 0,   -- الرصيد الافتتاحي
  is_active       INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE bank_statements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  statement_date  TEXT    NOT NULL,             -- تاريخ الحركة في البنك
  value_date      TEXT,                         -- تاريخ القيمة
  description     TEXT    NOT NULL,             -- البيان كما يظهر في البنك
  ref_number      TEXT,                         -- رقم المرجع من البنك
  amount_in       REAL    NOT NULL DEFAULT 0,   -- إيداع
  amount_out      REAL    NOT NULL DEFAULT 0,   -- سحب
  bank_balance    REAL,                         -- الرصيد بعد الحركة
  is_matched      INTEGER NOT NULL DEFAULT 0,   -- هل تمت المطابقة؟
  matched_tx_id   INTEGER,                      -- معرّف حركة الخزينة المقابلة
  matched_at      TEXT,
  matched_by      INTEGER REFERENCES users(id),
  import_batch_id TEXT,                         -- للاستيراد الجماعي
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE bank_reconciliations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies(id),
  bank_account_id     INTEGER NOT NULL REFERENCES bank_accounts(id),
  period_start        TEXT    NOT NULL,
  period_end          TEXT    NOT NULL,
  bank_closing_bal    REAL    NOT NULL DEFAULT 0,   -- رصيد البنك في نهاية الفترة
  book_closing_bal    REAL    NOT NULL DEFAULT 0,   -- رصيد الدفاتر
  outstanding_checks  REAL    NOT NULL DEFAULT 0,   -- شيكات صادرة لم تُصرف
  deposits_in_transit REAL    NOT NULL DEFAULT 0,   -- إيداعات قيد التحصيل
  bank_errors         REAL    NOT NULL DEFAULT 0,   -- فروق بنكية
  book_errors         REAL    NOT NULL DEFAULT 0,   -- فروق دفترية
  adjusted_bank_bal   REAL    GENERATED ALWAYS AS (bank_closing_bal - outstanding_checks + deposits_in_transit + bank_errors) STORED,
  adjusted_book_bal   REAL    GENERATED ALWAYS AS (book_closing_bal + book_errors) STORED,
  difference          REAL    GENERATED ALWAYS AS (bank_closing_bal - outstanding_checks + deposits_in_transit + bank_errors - book_closing_bal - book_errors) STORED,
  status              TEXT    NOT NULL DEFAULT 'draft'  CHECK(status IN ('draft','reconciled','closed')),
  notes               TEXT,
  created_by          INTEGER REFERENCES users(id),
  closed_by           INTEGER REFERENCES users(id),
  closed_at           TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE harvest_records (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), field_id INTEGER NOT NULL REFERENCES fields(id), season_id INTEGER REFERENCES seasons(id), harvest_date TEXT NOT NULL, crop_name TEXT NOT NULL, variety TEXT, qty_tons REAL NOT NULL DEFAULT 0, qty_feddan REAL, quality_grade TEXT DEFAULT 'standard', moisture_pct REAL, impurity_pct REAL, actual_cost REAL DEFAULT 0, sell_price_ton REAL, revenue REAL, profit REAL, cost_per_feddan REAL, notes TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE wo_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, operation_type TEXT, description TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE field_season_budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), field_id INTEGER NOT NULL REFERENCES fields(id), season_id INTEGER REFERENCES seasons(id), budget_per_feddan REAL, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(company_id, field_id, season_id));
CREATE TABLE wo_template_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES wo_templates(id) ON DELETE CASCADE, task_name TEXT NOT NULL, task_order INTEGER NOT NULL DEFAULT 0, description TEXT, estimated_hours REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE system_error_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id       INTEGER,
    user_id          INTEGER,
    endpoint         TEXT NOT NULL,
    method           TEXT NOT NULL,
    error_message    TEXT NOT NULL,
    stack_trace      TEXT,
    request_payload  TEXT, -- JSON string of the request body
    created_at       DATETIME DEFAULT (datetime('now'))
);
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE gl_integration_settings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  module_key   TEXT NOT NULL, -- 'harvest', 'hr_payroll', 'inventory', 'purchasing', 'operations'
  is_enabled   INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, module_key)
);
CREATE TABLE warehouses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'internal', -- 'internal', 'view', 'vendor', 'customer', 'inventory', 'production'
  location     TEXT,
  manager_id   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_active    INTEGER NOT NULL DEFAULT 1, inv_posting_group_code  TEXT,
  UNIQUE(company_id, name)
);
CREATE TABLE stock_quants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  item_code    INTEGER NOT NULL,
  quantity     REAL NOT NULL DEFAULT 0,
  value        REAL NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, warehouse_id, item_code),
  FOREIGN KEY(item_code, company_id) REFERENCES items(code, company_id)
);
CREATE TABLE item_categories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  name           TEXT NOT NULL,
  parent_id      INTEGER,
  expense_account_code TEXT,
  inventory_account_code TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')), prod_posting_group_code TEXT,
  UNIQUE(company_id, name),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(parent_id) REFERENCES item_categories(id)
);
CREATE TABLE contract_advances (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  contract_id  INTEGER NOT NULL REFERENCES sales_contracts(id),
  amount       REAL NOT NULL,
  receipt_date TEXT NOT NULL,
  notes        TEXT,
  gl_entry_id  INTEGER REFERENCES journal_entries(id),
  created_by   INTEGER NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE business_posting_groups (
    code         TEXT NOT NULL,
    company_id   INTEGER NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (code, company_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE TABLE product_posting_groups (
    code         TEXT NOT NULL,
    company_id   INTEGER NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (code, company_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE TABLE inventory_posting_groups (
    code         TEXT NOT NULL,
    company_id   INTEGER NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (code, company_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE TABLE purchase_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  po_number       TEXT    NOT NULL,
  supplier_code   INTEGER,                             -- intentionally nullable: draft POs
  supplier_name   TEXT,                                -- cached name for display
  order_date      TEXT    NOT NULL,
  expected_date   TEXT,
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','sent','partial','received','cancelled','closed')),
  total_amount    REAL    NOT NULL DEFAULT 0,
  notes           TEXT,
  requested_by    INTEGER REFERENCES users(id),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TEXT,
  received_by     INTEGER REFERENCES users(id),
  received_at     TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, po_number),
  -- Correct composite FK — matches suppliers' PRIMARY KEY (code, company_id)
  FOREIGN KEY (supplier_code, company_id) REFERENCES suppliers(code, company_id) ON DELETE RESTRICT
);
CREATE TABLE purchase_order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id           INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  item_code       INTEGER,                             -- FK to items(code) if present
  item_name       TEXT    NOT NULL,
  unit            TEXT,
  qty_ordered     REAL    NOT NULL DEFAULT 1,
  qty_received    REAL    NOT NULL DEFAULT 0,
  unit_price      REAL    NOT NULL DEFAULT 0,
  total_price     REAL    GENERATED ALWAYS AS (qty_ordered * unit_price) STORED,
  notes           TEXT,
  warehouse       TEXT,
  center_code     INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE supplier_invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  po_id           INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  invoice_number  TEXT    NOT NULL,
  invoice_date    TEXT    NOT NULL,
  supplier_code   INTEGER,
  total_amount    REAL    NOT NULL DEFAULT 0,
  paid_amount     REAL    NOT NULL DEFAULT 0,
  due_date_days   INTEGER DEFAULT 30,
  payment_date    TEXT,
  payment_ref     TEXT,
  notes           TEXT,
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','approved','paid','cancelled')),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Correct composite FK to suppliers
  FOREIGN KEY (supplier_code, company_id) REFERENCES suppliers(code, company_id) ON DELETE RESTRICT,
  UNIQUE(company_id, invoice_number)
);
CREATE TABLE supplier_invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  po_item_id    INTEGER REFERENCES purchase_order_items(id),
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  item_code     INTEGER,
  item_name     TEXT,
  qty_invoiced  REAL    NOT NULL,
  unit_price    REAL    NOT NULL DEFAULT 0,
  total_amount  REAL    GENERATED ALWAYS AS (qty_invoiced * unit_price) STORED
);
CREATE TABLE inventory_audit_trail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  movement_id   INTEGER,
  action        TEXT NOT NULL,   -- CREATE / UPDATE / DELETE / POST / REVERSE
  table_name    TEXT NOT NULL DEFAULT 'inventory_movements',
  record_id     INTEGER,
  before_value  TEXT,            -- JSON
  after_value   TEXT,            -- JSON
  user_id       TEXT,
  ip_address    TEXT,
  session_id    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE p_l_mapping_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  account_type TEXT NOT NULL CHECK (account_type IN ('REVENUE', 'EXPENSE', 'FINANCE')),
  sort_order INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE supplier_code_bridge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  treasury_code TEXT NOT NULL,
  -- treasury_code: what appears in خزينة نواة المستقبل (e.g., 20900353)
  
  supplier_code TEXT NOT NULL,
  -- supplier_code: what exists in suppliers.code table (e.g., 20900353 or internal)
  
  coa_ap_account TEXT NOT NULL,
  -- coa_ap_account: COA posting account (e.g., 212000015 for شركة عرفة)
  
  product_category TEXT,
  -- product_category: optional — for suppliers with multiple categories (أسمدة/مبيدات/ميكنة)
  
  supplier_name TEXT NOT NULL,
  -- supplier_name: reference/display name
  
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, treasury_code, product_category)
);
CREATE TABLE expense_code_to_coa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  
  expense_code TEXT NOT NULL,
  -- expense_code: treasury reference code (33001–36020, 4101, 4102, etc.)
  
  expense_name_ar TEXT NOT NULL,
  -- expense_name_ar: Description from الاكواد sheet (e.g., "اشراف زراعي")
  
  expense_category TEXT,
  -- expense_category: Type grouping for reporting (LABOR, MATERIALS, TRANSPORT, RENT, etc.)
  
  coa_account TEXT NOT NULL,
  -- coa_account: Target COA posting account (5x for expenses, 6x for finance, 7x for other income)
  
  coa_account_name TEXT,
  -- coa_account_name: Reference to COA account description
  
  cost_center_required INTEGER NOT NULL DEFAULT 0,
  -- cost_center_required: Whether cost center must be provided with this expense code
  
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, expense_code)
);
CREATE TABLE cost_centers (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT, cost_center_type TEXT NOT NULL DEFAULT 'OVERHEAD', parent_code TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (company_id, code));
CREATE TABLE dimension_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  table_name TEXT NOT NULL,
  dimension_code TEXT NOT NULL,
  is_required BOOLEAN DEFAULT 0,
  applicable_transaction_types TEXT,
  enforcement_level TEXT DEFAULT 'WARN',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE posting_rules (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  rule_type TEXT NOT NULL,

  -- Routing dimensions (NULL = wildcard)
  bus_posting_group_code TEXT,
  prod_posting_group_code TEXT,
  inv_posting_group_code TEXT,

  -- For control/singleton mappings (cash, AP, wages, etc.)
  mapping_key TEXT,
  account_code TEXT,

  -- General posting slots
  sales_account TEXT,
  purchases_account TEXT,
  cogs_account TEXT,
  sales_returns_account TEXT,
  purch_returns_account TEXT,
  expense_account TEXT,

  -- Inventory posting slots
  inventory_account TEXT,

  priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), wip_account TEXT, finished_goods_account TEXT, valid_from TEXT DEFAULT NULL, valid_to TEXT DEFAULT NULL, priority_index INTEGER DEFAULT 100, migrated_from_v1 INTEGER DEFAULT 0, last_modified_by INTEGER, last_modified_at TEXT, wh_id INTEGER, movement_type TEXT REFERENCES movement_types(code),

  CHECK(rule_type IN ('general','inventory','control'))
);
CREATE TABLE business_events (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  journal_entry_id INTEGER,
  posted_by INTEGER,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK(status IN ('pending','posted','error','reversed')),
  UNIQUE(company_id, source_module, source_id, event_type)
);
CREATE TABLE posting_rule_resolutions (
  id                 INTEGER PRIMARY KEY,
  company_id         INTEGER NOT NULL,
  resolved_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  rule_type          TEXT    NOT NULL,
  input_bpg          TEXT,
  input_ppg          TEXT,
  input_ipg          TEXT,
  resolution_step    INTEGER,             -- 1-8 (which cascade level matched)
  matched_rule_id    INTEGER,             -- FK to posting_rules.id (nullable if failed)
  result             TEXT    NOT NULL CHECK(result IN ('resolved','failed')),
  error_message      TEXT,
  journal_entry_id   INTEGER,             -- FK to journal_entries.id (nullable until committed)
  source_event_id    INTEGER              -- FK to business_events.id
);
CREATE TABLE period_account_balances (
  id            INTEGER PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  period_id     INTEGER NOT NULL,
  account_code  TEXT    NOT NULL,
  opening_debit REAL    NOT NULL DEFAULT 0,
  opening_credit REAL   NOT NULL DEFAULT 0,
  period_debit  REAL    NOT NULL DEFAULT 0,
  period_credit REAL    NOT NULL DEFAULT 0,
  closing_debit REAL    NOT NULL DEFAULT 0,
  closing_credit REAL   NOT NULL DEFAULT 0,
  snapshotted_at TEXT   NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, period_id, account_code)
);
CREATE TABLE system_integrity_scores (
  id                      INTEGER PRIMARY KEY,
  company_id              INTEGER NOT NULL,
  scored_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  overall_score           INTEGER NOT NULL,   -- 0-100
  posting_coverage_score  INTEGER NOT NULL,   -- % events with journal_entry_id
  balance_integrity_score INTEGER NOT NULL,   -- % entries that balance
  orphan_score            INTEGER NOT NULL,   -- 100 - orphan_pct
  reconciliation_score    INTEGER NOT NULL,   -- GL vs inventory delta score
  rule_coverage_score     INTEGER NOT NULL,   -- % group combos with rules
  unbalanced_count        INTEGER NOT NULL DEFAULT 0,
  orphan_count            INTEGER NOT NULL DEFAULT 0,
  draft_event_count       INTEGER NOT NULL DEFAULT 0,
  error_event_count       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE wip_balances (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, from_season_id INTEGER NOT NULL, to_season_id INTEGER, field_id INTEGER NOT NULL, crop_name TEXT NOT NULL, cost_balance REAL NOT NULL DEFAULT 0, journal_entry_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'carried', 'closed')), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(from_season_id) REFERENCES seasons(id), FOREIGN KEY(to_season_id) REFERENCES seasons(id), FOREIGN KEY(field_id) REFERENCES fields(id), FOREIGN KEY(journal_entry_id) REFERENCES journal_entries(id), FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE depreciation_schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, asset_id INTEGER NOT NULL, period_year INTEGER NOT NULL, period_month INTEGER NOT NULL, amount REAL NOT NULL DEFAULT 0, accumulated REAL NOT NULL DEFAULT 0, journal_entry_id INTEGER, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'posted', 'skipped')), created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(asset_id, period_year, period_month), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(asset_id) REFERENCES fixed_assets(id), FOREIGN KEY(journal_entry_id) REFERENCES journal_entries(id));
CREATE TABLE account_balances (
  company_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  opening_balance REAL NOT NULL DEFAULT 0,
  period_debit REAL NOT NULL DEFAULT 0,
  period_credit REAL NOT NULL DEFAULT 0,
  closing_balance REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, period_id, account_code)
);
CREATE TABLE batch_post_jobs (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  last_error TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
CREATE TABLE batch_post_job_items (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  journal_entry_id INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(job_id, source_id)
);
CREATE TABLE IF NOT EXISTS "fixed_assets" (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL,
  asset_code          TEXT NOT NULL,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT 'equipment'
                      CHECK(category IN ('equipment', 'vehicle', 'irrigation', 'building', 'land_improvement', 'other')),
  acquisition_date    TEXT NOT NULL,
  cost                REAL NOT NULL DEFAULT 0,
  salvage_value       REAL NOT NULL DEFAULT 0,
  useful_life_months  INTEGER NOT NULL DEFAULT 60,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line'
                      CHECK(depreciation_method IN ('straight_line', 'declining_balance')),
  center_code         INTEGER,
  field_id            INTEGER,
  is_active           INTEGER NOT NULL DEFAULT 1,
  notes               TEXT,
  created_by          INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')), supplier_transaction_id INTEGER, equipment_type_id INTEGER, asset_status TEXT NOT NULL DEFAULT 'active'
                           CHECK(asset_status IN ('active', 'disposed', 'maintenance')), disposal_date TEXT, disposal_notes TEXT,
  UNIQUE(company_id, asset_code),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(company_id, center_code) REFERENCES cost_centers(company_id, code),
  FOREIGN KEY(field_id) REFERENCES fields(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS "fields" (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  season_id    INTEGER REFERENCES seasons(id),
  code         TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  area_feddan  REAL    NOT NULL DEFAULT 0,
  location     TEXT,
  crop_type    TEXT,
  soil_type    TEXT,
  irrigation_type TEXT,
  landlord_name   TEXT,
  rent_per_feddan REAL    DEFAULT 0,
  notes        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')), 
  center_lat         REAL, 
  center_lng         REAL, 
  geofence_radius_m  INTEGER DEFAULT 150, 
  length_m           REAL, 
  width_m            REAL, 
  center_code INTEGER,
  UNIQUE (code, company_id),
  FOREIGN KEY(company_id, center_code) REFERENCES cost_centers(company_id, code)
);
CREATE TABLE general_posting_setup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    bus_posting_group_code TEXT,
    prod_posting_group_code TEXT,
    sales_account TEXT,
    purchases_account TEXT,
    cogs_account TEXT,
    sales_returns_account TEXT,
    purch_returns_account TEXT,
    expense_account TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, bus_posting_group_code, prod_posting_group_code)
);
CREATE TABLE inventory_posting_setup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    inv_posting_group_code TEXT NOT NULL,
    location_code TEXT,
    inventory_account TEXT,
    inventory_adj_account TEXT,
    wip_account TEXT,
    cogs_account TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, inv_posting_group_code, location_code)
);
CREATE TABLE inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  adjustment_date TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at TEXT,
  posted_by INTEGER,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);
CREATE TABLE inventory_adjustment_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_id INTEGER NOT NULL,
  item_code INTEGER NOT NULL,
  theoretical_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL NOT NULL DEFAULT 0,
  difference REAL NOT NULL DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (adjustment_id) REFERENCES inventory_adjustments(id) ON DELETE CASCADE
);
CREATE TABLE md_material_groups (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE TABLE md_costing_methods (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE md_business_units (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE TABLE md_account_roles (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  category TEXT CHECK(category IN ('INVENTORY', 'P&L', 'BALANCE_SHEET', 'CONTROL'))
);
CREATE TABLE gl_journal_audit (
  id INTEGER PRIMARY KEY,
  journal_entry_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'POST', 'REVERSE', 'CORRECT')),
  old_value_json TEXT,  -- Previous state as JSON
  new_value_json TEXT,  -- Current state as JSON
  changed_by INTEGER,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT, company_id INTEGER NOT NULL DEFAULT 1, entry_id INTEGER,
  
  FOREIGN KEY(journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
);
CREATE TABLE md_currencies (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT,
  decimal_places INTEGER DEFAULT 2,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE exchange_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL, rate REAL NOT NULL, effective_date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE md_event_types (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, name TEXT NOT NULL, description TEXT, module_name TEXT NOT NULL DEFAULT 'GL', affects_inventory INTEGER NOT NULL DEFAULT 0, affects_wip INTEGER NOT NULL DEFAULT 0, affects_cogs INTEGER NOT NULL DEFAULT 0, affects_revenue INTEGER NOT NULL DEFAULT 0, affects_expense INTEGER NOT NULL DEFAULT 0, debit_role TEXT, credit_role TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(code));
CREATE TABLE account_role_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, role_code TEXT NOT NULL, account_code TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 1, notes TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(company_id, role_code, account_code));
CREATE TABLE source_documents (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, source_module TEXT NOT NULL, source_id TEXT NOT NULL, document_type TEXT NOT NULL, event_id INTEGER, event_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload_snapshot TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(company_id, source_module, source_id, document_type));
CREATE TABLE source_document_links (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, source_document_id INTEGER NOT NULL, journal_entry_id INTEGER NOT NULL, link_type TEXT NOT NULL DEFAULT 'primary', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(company_id, source_document_id, journal_entry_id, link_type));
CREATE TABLE inventory_posting_controls (
  company_id                  INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  posting_mode                TEXT NOT NULL DEFAULT 'strict_sync'
                                CHECK (posting_mode IN ('strict_sync', 'async_reliable', 'decoupled')),
  zero_value_require_reason   INTEGER NOT NULL DEFAULT 1,
  zero_value_approval_roles   TEXT NOT NULL DEFAULT 'super_admin,company_admin,accountant,field_supervisor',
  locked_through_date         TEXT,
  updated_by                  INTEGER,
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE inventory_posting_outbox (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN ('inventory_movement', 'inventory_transfer')),
  movement_id       INTEGER NOT NULL,
  payload_json      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  idempotency_key   TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at      TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, idempotency_key)
);
CREATE TABLE period_close_checklist (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, period_id INTEGER NOT NULL, step_key TEXT NOT NULL, step_order INTEGER NOT NULL DEFAULT 0, step_label TEXT NOT NULL DEFAULT '', is_critical INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','passed','failed','warning')), count_blocked INTEGER NOT NULL DEFAULT 0, details_json TEXT NOT NULL DEFAULT '', completed_by INTEGER, completed_at TEXT, UNIQUE(company_id, period_id, step_key), FOREIGN KEY(period_id) REFERENCES financial_periods(id) ON DELETE CASCADE);
CREATE TABLE movement_types (
  code                TEXT PRIMARY KEY,
  name_ar             TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK(direction IN ('IN', 'OUT', 'NEUTRAL')),
  affects_inventory   INTEGER NOT NULL DEFAULT 1,
  affects_cogs        INTEGER NOT NULL DEFAULT 0,
  affects_wip         INTEGER NOT NULL DEFAULT 0,
  requires_reference  INTEGER NOT NULL DEFAULT 0,
  legacy_arabic_value TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE inventory_balances (
  company_id       INTEGER NOT NULL,
  item_code        INTEGER NOT NULL,
  warehouse        TEXT    NOT NULL,
  balance_qty      REAL    NOT NULL DEFAULT 0,
  balance_value    REAL    NOT NULL DEFAULT 0,
  version          INTEGER NOT NULL DEFAULT 0,
  last_movement_id INTEGER,
  last_updated     TEXT    NOT NULL DEFAULT (datetime('now')), is_stale INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, item_code, warehouse),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);
CREATE TABLE inventory_transactions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL,
  transaction_type     TEXT    NOT NULL,          -- GRN | ISSUE | TRANSFER | ADJUSTMENT_PROFIT | ADJUSTMENT_LOSS | RETURN_SUPPLIER | RETURN_CUSTOMER | PRODUCTION_INPUT | PRODUCTION_OUTPUT
  document_number      TEXT,
  movement_date        TEXT    NOT NULL,
  warehouse            TEXT,                      -- primary warehouse (transfer: from_warehouse)
  to_warehouse         TEXT,                      -- for transfers only
  notes                TEXT,
  line_count           INTEGER NOT NULL DEFAULT 0,
  total_qty            REAL    NOT NULL DEFAULT 0,
  total_value          REAL    NOT NULL DEFAULT 0,
  status               TEXT    NOT NULL DEFAULT 'confirmed' CHECK(status IN ('draft','confirmed','cancelled')),
  created_by_user_id   INTEGER,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE period_inventory_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  period_id      INTEGER NOT NULL REFERENCES financial_periods(id) ON DELETE CASCADE,
  item_code      INTEGER NOT NULL,
  item_name      TEXT,
  warehouse      TEXT    NOT NULL,
  closing_qty    REAL    NOT NULL DEFAULT 0,
  closing_value  REAL    NOT NULL DEFAULT 0,
  snapshotted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, period_id, item_code, warehouse)
);
CREATE TABLE equipment_types (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'other'
                    CHECK(category IN ('vehicle', 'machinery', 'irrigation', 'harvest', 'storage', 'other')),
  asset_nature      TEXT NOT NULL DEFAULT 'capital'
                    CHECK(asset_nature IN ('capital', 'consumable')),
  default_life_months INTEGER NOT NULL DEFAULT 60,
  notes             TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE TABLE fixed_assets_supplier_link (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id               INTEGER NOT NULL,
  fixed_asset_id           INTEGER NOT NULL,
  supplier_transaction_id  INTEGER NOT NULL,
  linked_at                TEXT NOT NULL DEFAULT (datetime('now')),
  created_by               INTEGER,
  notes                    TEXT,
  UNIQUE(fixed_asset_id, supplier_transaction_id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(fixed_asset_id) REFERENCES fixed_assets(id),
  FOREIGN KEY(supplier_transaction_id) REFERENCES supplier_transactions(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE work_order_equipment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id   INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL,
  equipment_name  TEXT    NOT NULL,          -- e.g. "جرار 75 حصان", "ضخة ري", "حصادة"
  task_date       TEXT    NOT NULL,          -- ISO date YYYY-MM-DD
  hours_worked    REAL    NOT NULL CHECK (hours_worked > 0),
  cost_per_hour   REAL    NOT NULL DEFAULT 0 CHECK (cost_per_hour >= 0),
  total_cost      REAL    GENERATED ALWAYS AS (hours_worked * cost_per_hour) STORED,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
, equipment_usage_mode TEXT NOT NULL DEFAULT 'rental', fixed_asset_id INTEGER REFERENCES fixed_assets(id), supplier_code INTEGER, journal_entry_id INTEGER REFERENCES journal_entries(id));
CREATE TABLE operation_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, name)
);
CREATE TABLE crop_account_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  crop_label TEXT NOT NULL,
  account_code TEXT NOT NULL,
  mapping_scope TEXT NOT NULL DEFAULT 'MAIN',
  source TEXT NOT NULL DEFAULT 'json_seed_2026_05_08',
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, crop_label)
);
CREATE TABLE data_integrity_recovery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_tag TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RECOVERED', 'UNRECOVERABLE_NOT_DELETABLE')),
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE tmp_integrity_classification (table_name TEXT, row_id TEXT, category TEXT, reason TEXT);
CREATE TABLE coa_account_intents (
  company_id       INTEGER NOT NULL,
  account_code     TEXT    NOT NULL,
  intent_class     TEXT    NOT NULL CHECK (intent_class IN ('operational', 'control', 'reporting', 'system-owned', 'manual-only')),
  ownership_scope  TEXT    NOT NULL DEFAULT 'finance',
  is_system_owned  INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, account_code),
  FOREIGN KEY (company_id, account_code) REFERENCES chart_of_accounts(company_id, code)
);
CREATE TABLE posting_operation_matrix (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  operation_key    TEXT    NOT NULL,
  source_module    TEXT    NOT NULL,
  debit_role       TEXT    NOT NULL,
  credit_role      TEXT    NOT NULL,
  is_system_owned  INTEGER NOT NULL DEFAULT 1,
  is_active        INTEGER NOT NULL DEFAULT 1,
  description      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, operation_key),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);
CREATE TABLE supplier_transactions_corrupted_2026_05_09(
  id INT,
  company_id INT,
  season_id INT,
  supplier_code INT,
  account_code INT,
  center_code INT,
  sub_code INT,
  transaction_date TEXT,
  entry_type TEXT,
  document_type TEXT,
  document_number INT,
  expense_category TEXT,
  equipment TEXT,
  unit TEXT,
  quantity REAL,
  unit_price REAL,
  amount REAL,
  credit REAL,
  debit REAL,
  check_amount REAL,
  due_date TEXT,
  balance_no_checks REAL,
  balance_with_checks REAL,
  check_clearance_date TEXT,
  year INT,
  month INT,
  notes TEXT,
  work_order_id INT,
  employee_id INT,
  purchase_contract_id INT,
  sales_contract_id INT,
  created_by_user_id INT,
  is_offline_origin INT,
  device_id TEXT,
  local_id TEXT,
  created_at TEXT,
  status TEXT,
  journal_entry_id INT,
  description TEXT,
  financial_account_id INT,
  equipment_type_id INT,
  equipment_usage_mode TEXT
);
CREATE TABLE inventory_movements_corrupted_2026_05_09(
  id INT,
  company_id INT,
  season_id INT,
  supplier_code INT,
  item_code INT,
  center_code INT,
  account_code INT,
  sub_code INT,
  movement_date TEXT,
  warehouse TEXT,
  movement_type TEXT,
  document_number INT,
  invoice_number INT,
  po_number INT,
  package_type TEXT,
  pack_capacity REAL,
  pack_count REAL,
  quantity REAL,
  unit_price REAL,
  qty_in REAL,
  qty_out REAL,
  balance_qty REAL,
  value_in REAL,
  value_out REAL,
  balance_value REAL,
  year INT,
  month INT,
  notes TEXT,
  field_id INT,
  work_order_id INT,
  work_task_id INT,
  purchase_delivery_id INT,
  sales_delivery_id INT,
  created_by_user_id INT,
  is_offline_origin INT,
  device_id TEXT,
  local_id TEXT,
  created_at TEXT,
  status TEXT,
  journal_entry_id INT,
  warehouse_id INT,
  dest_warehouse_id INT,
  related_movement_id INT,
  zero_value_reason TEXT,
  zero_value_approved_by_role TEXT,
  posting_mode TEXT,
  gl_posting_status TEXT,
  gl_posting_error TEXT,
  gl_posted_at TEXT,
  version INT,
  transaction_id INT
);
CREATE TABLE cash_transactions_corrupted_2026_05_09(
  id INT,
  company_id INT,
  season_id INT,
  supplier_code INT,
  center_code INT,
  expense_code INT,
  sub_code INT,
  transaction_date TEXT,
  direction TEXT,
  document_number INT,
  recipient_name TEXT,
  narration TEXT,
  season_service TEXT,
  unit TEXT,
  quantity REAL,
  unit_price REAL,
  amount REAL,
  debit REAL,
  credit REAL,
  running_balance REAL,
  year INT,
  month INT,
  notes TEXT,
  work_order_id INT,
  employee_id INT,
  purchase_contract_id INT,
  created_by_user_id INT,
  is_offline_origin INT,
  device_id TEXT,
  local_id TEXT,
  created_at TEXT,
  journal_entry_id INT,
  status TEXT,
  document_type TEXT,
  field_id INT,
  financial_account_id INT,
  partner_id INT
);
CREATE TABLE supplier_tx_bak(
  id INT,
  company_id INT,
  season_id INT,
  supplier_code INT,
  account_code INT,
  center_code INT,
  sub_code INT,
  transaction_date TEXT,
  entry_type TEXT,
  document_type TEXT,
  document_number INT,
  expense_category TEXT,
  equipment TEXT,
  unit TEXT,
  quantity REAL,
  unit_price REAL,
  amount REAL,
  credit REAL,
  debit REAL,
  check_amount REAL,
  due_date TEXT,
  balance_no_checks REAL,
  balance_with_checks REAL,
  check_clearance_date TEXT,
  year INT,
  month INT,
  notes TEXT,
  work_order_id INT,
  employee_id INT,
  purchase_contract_id INT,
  sales_contract_id INT,
  created_by_user_id INT,
  is_offline_origin INT,
  device_id TEXT,
  local_id TEXT,
  created_at TEXT,
  status TEXT,
  journal_entry_id INT,
  description TEXT,
  financial_account_id INT,
  equipment_type_id INT,
  equipment_usage_mode TEXT
);
CREATE TABLE inventory_bak(
  id INT,
  company_id INT,
  season_id INT,
  supplier_code INT,
  item_code INT,
  center_code INT,
  account_code INT,
  sub_code INT,
  movement_date TEXT,
  warehouse TEXT,
  movement_type TEXT,
  document_number INT,
  invoice_number INT,
  po_number INT,
  package_type TEXT,
  pack_capacity REAL,
  pack_count REAL,
  quantity REAL,
  unit_price REAL,
  qty_in REAL,
  qty_out REAL,
  balance_qty REAL,
  value_in REAL,
  value_out REAL,
  balance_value REAL,
  year INT,
  month INT,
  notes TEXT,
  field_id INT,
  work_order_id INT,
  work_task_id INT,
  purchase_delivery_id INT,
  sales_delivery_id INT,
  created_by_user_id INT,
  is_offline_origin INT,
  device_id TEXT,
  local_id TEXT,
  created_at TEXT,
  status TEXT,
  journal_entry_id INT,
  warehouse_id INT,
  dest_warehouse_id INT,
  related_movement_id INT,
  zero_value_reason TEXT,
  zero_value_approved_by_role TEXT,
  posting_mode TEXT,
  gl_posting_status TEXT,
  gl_posting_error TEXT,
  gl_posted_at TEXT,
  version INT,
  transaction_id INT
);
CREATE TABLE cash_tx_bak(
  id INT,
  company_id INT,
  season_id INT,
  supplier_code INT,
  center_code INT,
  expense_code INT,
  sub_code INT,
  transaction_date TEXT,
  direction TEXT,
  document_number INT,
  recipient_name TEXT,
  narration TEXT,
  season_service TEXT,
  unit TEXT,
  quantity REAL,
  unit_price REAL,
  amount REAL,
  debit REAL,
  credit REAL,
  running_balance REAL,
  year INT,
  month INT,
  notes TEXT,
  work_order_id INT,
  employee_id INT,
  purchase_contract_id INT,
  created_by_user_id INT,
  is_offline_origin INT,
  device_id TEXT,
  local_id TEXT,
  created_at TEXT,
  journal_entry_id INT,
  status TEXT,
  document_type TEXT,
  field_id INT,
  financial_account_id INT,
  partner_id INT
);
CREATE TABLE data_quality_control ( company_id INTEGER PRIMARY KEY, freeze_until TEXT, enforce_gates INTEGER NOT NULL DEFAULT 0, min_supplier_center_pct REAL NOT NULL DEFAULT 95, min_supplier_expense_pct REAL NOT NULL DEFAULT 95, min_supplier_equipment_type_pct REAL NOT NULL DEFAULT 90, min_cash_center_pct REAL NOT NULL DEFAULT 95, min_cash_expense_pct REAL NOT NULL DEFAULT 90, min_items_ppg_pct REAL NOT NULL DEFAULT 100, min_items_ipg_pct REAL NOT NULL DEFAULT 100, updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT );
CREATE TABLE data_quality_snapshots ( id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, stage TEXT NOT NULL, metrics_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')) );
DELETE FROM sqlite_sequence;
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_audit_company   ON audit_log(company_id, created_at);
CREATE INDEX idx_audit_user      ON audit_log(user_id);
CREATE INDEX idx_audit_table     ON audit_log(table_name, record_id);
CREATE INDEX idx_seasons_company ON seasons(company_id);
CREATE INDEX idx_suppliers_company ON suppliers(company_id);
CREATE INDEX idx_items_company ON items(company_id);
CREATE INDEX idx_partners_company ON partners(company_id);
CREATE INDEX idx_st_company_date    ON supplier_transactions(company_id, transaction_date);
CREATE INDEX idx_st_supplier        ON supplier_transactions(company_id, supplier_code);
CREATE INDEX idx_st_center          ON supplier_transactions(company_id, center_code);
CREATE INDEX idx_st_season          ON supplier_transactions(company_id, season_id);
CREATE INDEX idx_st_year_month      ON supplier_transactions(company_id, year, month);
CREATE INDEX idx_ct_company_date ON cash_transactions(company_id, transaction_date);
CREATE INDEX idx_ct_supplier     ON cash_transactions(company_id, supplier_code);
CREATE INDEX idx_ct_season       ON cash_transactions(company_id, season_id);
CREATE INDEX idx_ct_year_month   ON cash_transactions(company_id, year, month);
CREATE INDEX idx_im_company_date ON inventory_movements(company_id, movement_date);
CREATE INDEX idx_im_item         ON inventory_movements(company_id, item_code);
CREATE INDEX idx_im_warehouse    ON inventory_movements(company_id, warehouse);
CREATE INDEX idx_im_season       ON inventory_movements(company_id, season_id);
CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_wo_company  ON work_orders(company_id);
CREATE INDEX idx_wo_season   ON work_orders(company_id, season_id);
CREATE INDEX idx_wo_field    ON work_orders(company_id, field_id);
CREATE INDEX idx_wo_status   ON work_orders(company_id, status);
CREATE INDEX idx_wt_order   ON work_tasks(work_order_id);
CREATE INDEX idx_wt_company ON work_tasks(company_id);
CREATE INDEX idx_pc_company  ON purchase_contracts(company_id);
CREATE INDEX idx_pc_season   ON purchase_contracts(company_id, season_id);
CREATE INDEX idx_sc_company ON sales_contracts(company_id);
CREATE INDEX idx_sc_season  ON sales_contracts(company_id, season_id);
CREATE INDEX idx_staging_mov_company ON staging_movements(company_id, status);
CREATE INDEX idx_staging_mov_batch   ON staging_movements(batch_id);
CREATE INDEX idx_oq_company_status ON offline_queue(company_id, status);
CREATE INDEX idx_oq_device         ON offline_queue(device_id, status);
CREATE INDEX idx_item_units_item ON item_units(company_id, item_code);
CREATE INDEX idx_reorder_company ON reorder_rules(company_id);
CREATE INDEX idx_pc_supplier ON purchase_contracts(company_id, supplier_code);
CREATE INDEX idx_branches_company ON branches(company_id);
CREATE INDEX idx_ejd_company ON employee_job_details(company_id);
CREATE INDEX idx_ejd_branch  ON employee_job_details(branch_id);
CREATE INDEX idx_att_emp  ON attendance_records(employee_id, work_date);
CREATE INDEX idx_att_comp ON attendance_records(company_id, work_date);
CREATE INDEX idx_lt_company ON leave_types(company_id);
CREATE INDEX idx_leave_emp  ON leave_requests(employee_id);
CREATE INDEX idx_leave_comp ON leave_requests(company_id, status);
CREATE INDEX idx_sa_emp     ON salary_advances(employee_id);
CREATE INDEX idx_sa_company ON salary_advances(company_id, status);
CREATE INDEX idx_pr_company ON payroll_runs(company_id, period_year, period_month);
CREATE INDEX idx_pi_run      ON payroll_items(payroll_run_id);
CREATE INDEX idx_pi_employee ON payroll_items(employee_id);
CREATE INDEX idx_ea_employee ON employee_assets(employee_id);
CREATE INDEX idx_ea_company  ON employee_assets(company_id);
CREATE INDEX idx_doc_company  ON documents(company_id, doc_type);
CREATE INDEX idx_doc_expiry   ON documents(expiry_date);
CREATE INDEX idx_doc_ref      ON documents(ref_table, ref_id);
CREATE INDEX idx_doc_status   ON documents(company_id, status);
CREATE INDEX idx_att_field ON attendance_records(field_id) WHERE field_id IS NOT NULL;
CREATE INDEX idx_lt_employee ON location_tasks(employee_id, task_date);
CREATE INDEX idx_lt_status   ON location_tasks(company_id, status);
CREATE INDEX idx_ce_company
  ON calendar_events(company_id);
CREATE INDEX idx_ce_start
  ON calendar_events(company_id, start_datetime);
CREATE INDEX idx_ce_assigned_user
  ON calendar_events(assigned_to_user)
  WHERE assigned_to_user IS NOT NULL;
CREATE INDEX idx_ce_assigned_emp
  ON calendar_events(assigned_to_employee)
  WHERE assigned_to_employee IS NOT NULL;
CREATE INDEX idx_ce_status
  ON calendar_events(company_id, status);
CREATE INDEX idx_ce_type
  ON calendar_events(company_id, event_type);
CREATE INDEX idx_ea_event
  ON event_attendees(event_id);
CREATE INDEX idx_bank_stmts_account   ON bank_statements(bank_account_id, statement_date);
CREATE INDEX idx_bank_stmts_unmatched ON bank_statements(company_id, is_matched) WHERE is_matched = 0;
CREATE INDEX idx_bank_recon_account ON bank_reconciliations(bank_account_id, period_end);
CREATE INDEX idx_jel_center ON journal_entry_lines(company_id, center_code);
CREATE INDEX idx_harvest_company ON harvest_records(company_id);
CREATE INDEX idx_harvest_field ON harvest_records(field_id);
CREATE INDEX idx_harvest_season ON harvest_records(season_id);
CREATE INDEX idx_harvest_date ON harvest_records(company_id, harvest_date);
CREATE INDEX idx_cash_tx_status ON cash_transactions(company_id, status);
CREATE INDEX idx_supplier_tx_status ON supplier_transactions(company_id, status);
CREATE INDEX idx_error_date ON system_error_logs(created_at);
CREATE INDEX idx_error_company ON system_error_logs(company_id);
CREATE INDEX idx_im_company_season ON inventory_movements(company_id, season_id);
CREATE INDEX idx_im_center ON inventory_movements(company_id, center_code);
CREATE INDEX idx_je_period ON journal_entries(company_id, period_id);
CREATE INDEX idx_jel_entry ON journal_entry_lines(entry_id, company_id);
CREATE INDEX idx_st_status ON supplier_transactions(company_id, status);
CREATE INDEX idx_ct_status ON cash_transactions(company_id, status);
CREATE INDEX idx_im_status ON inventory_movements(company_id, status);
CREATE INDEX idx_payroll_items_employee ON payroll_items(employee_id);
CREATE INDEX idx_sales_contracts_gl ON sales_contracts(advance_gl_entry_id) WHERE advance_gl_entry_id IS NOT NULL;
CREATE INDEX idx_cash_tx_field_id ON cash_transactions(company_id, field_id, season_id);
CREATE INDEX idx_contract_advances_lookup ON contract_advances(company_id, contract_id);
CREATE UNIQUE INDEX idx_inv_local_id ON inventory_movements(local_id) WHERE local_id IS NOT NULL;
CREATE UNIQUE INDEX idx_cash_local_id ON cash_transactions(local_id) WHERE local_id IS NOT NULL;
CREATE UNIQUE INDEX idx_supplier_local_id ON supplier_transactions(local_id) WHERE local_id IS NOT NULL;
CREATE INDEX idx_je_company_posted ON journal_entries (company_id, is_posted, entry_date);
CREATE INDEX idx_je_company_ref
  ON journal_entries (company_id, ref_type, ref_id);
CREATE INDEX idx_jel_entry_id
  ON journal_entry_lines (entry_id);
CREATE INDEX idx_jel_account
  ON journal_entry_lines (account_code, company_id);
CREATE INDEX idx_coa_company_type
  ON chart_of_accounts (company_id, account_type, is_active);
CREATE INDEX idx_coa_parent
  ON chart_of_accounts (company_id, parent_code);
CREATE INDEX idx_bpg_company
  ON business_posting_groups  (company_id, is_active);
CREATE INDEX idx_ppg_company
  ON product_posting_groups   (company_id, is_active);
CREATE INDEX idx_ipg_company
  ON inventory_posting_groups (company_id, is_active);
CREATE INDEX idx_st_supplier_company
  ON supplier_transactions (company_id, supplier_code, created_at DESC);
CREATE INDEX idx_sq_company_item
  ON stock_quants (company_id, item_code, warehouse_id);
CREATE INDEX idx_suppliers_bpg ON suppliers (company_id, bus_posting_group_code);
CREATE INDEX idx_items_ppg ON items (company_id, prod_posting_group_code);
CREATE INDEX idx_item_categories_ppg ON item_categories (company_id, prod_posting_group_code);
CREATE INDEX idx_warehouses_ipg ON warehouses (company_id, inv_posting_group_code);
CREATE INDEX idx_fp_company_dates ON financial_periods (company_id, start_date, end_date, is_closed);
CREATE INDEX idx_po_company_status ON purchase_orders(company_id, status);
CREATE INDEX idx_po_supplier       ON purchase_orders(supplier_code, order_date);
CREATE INDEX idx_po_items_po    ON purchase_order_items(po_id);
CREATE INDEX idx_po_items_item  ON purchase_order_items(item_code, company_id);
CREATE INDEX idx_supplier_invoices_po      ON supplier_invoices(po_id, company_id);
CREATE INDEX idx_supplier_invoices_supp    ON supplier_invoices(supplier_code, company_id);
CREATE INDEX idx_invoice_items_inv  ON supplier_invoice_items(invoice_id);
CREATE INDEX idx_iat_company ON inventory_audit_trail(company_id, created_at DESC);
CREATE INDEX idx_iat_movement ON inventory_audit_trail(movement_id);
CREATE INDEX idx_supplier_code_bridge_treasury 
  ON supplier_code_bridge(company_id, treasury_code);
CREATE INDEX idx_expense_code_to_coa_lookup 
  ON expense_code_to_coa(company_id, expense_code);
CREATE UNIQUE INDEX uq_cost_centers_code ON cost_centers(company_id, code);
CREATE UNIQUE INDEX uq_posting_rules_signature
ON posting_rules (
  company_id,
  rule_type,
  COALESCE(bus_posting_group_code, '__NULL__'),
  COALESCE(prod_posting_group_code, '__NULL__'),
  COALESCE(inv_posting_group_code, '__NULL__'),
  COALESCE(mapping_key, '__NULL__')
);
CREATE INDEX idx_posting_rules_lookup
ON posting_rules (
  company_id,
  rule_type,
  is_active,
  priority
);
CREATE INDEX idx_business_events_status
ON business_events (company_id, status, event_date);
CREATE INDEX idx_business_events_source
ON business_events (company_id, source_module, source_id);
CREATE INDEX idx_prr_company_date
  ON posting_rule_resolutions(company_id, resolved_at DESC);
CREATE INDEX idx_prr_entry
  ON posting_rule_resolutions(journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;
CREATE INDEX idx_pab_company_period
  ON period_account_balances(company_id, period_id);
CREATE INDEX idx_sis_company_date
  ON system_integrity_scores(company_id, scored_at DESC);
CREATE INDEX idx_pr_cascade
  ON posting_rules (company_id, rule_type, is_active,
                    bus_posting_group_code, prod_posting_group_code, inv_posting_group_code);
CREATE INDEX idx_pr_control
  ON posting_rules (company_id, rule_type, mapping_key, is_active)
  WHERE mapping_key IS NOT NULL;
CREATE INDEX idx_be_status
  ON business_events (company_id, status);
CREATE INDEX idx_be_source
  ON business_events (company_id, source_module, source_id);
CREATE INDEX idx_be_type_date
  ON business_events (company_id, event_type, event_date);
CREATE INDEX idx_jel_season
  ON journal_entry_lines (company_id, season_id, entry_id)
  WHERE season_id IS NOT NULL;
CREATE INDEX idx_jel_rule_slot
  ON journal_entry_lines (company_id, rule_slot)
  WHERE rule_slot IS NOT NULL;
CREATE INDEX idx_journal_entry_lines_source
ON journal_entry_lines(source_ledger, source_record_id);
CREATE INDEX idx_wip_balances_company_season ON wip_balances(company_id, from_season_id);
CREATE INDEX idx_wip_balances_field ON wip_balances(company_id, field_id);
CREATE INDEX idx_wip_balances_status ON wip_balances(company_id, status);
CREATE INDEX idx_depreciation_schedule_period ON depreciation_schedules(company_id, period_year, period_month);
CREATE INDEX idx_depreciation_schedule_asset ON depreciation_schedules(asset_id, status);
CREATE INDEX idx_account_balances_period
  ON account_balances(company_id, period_id);
CREATE INDEX idx_account_balances_account
  ON account_balances(company_id, account_code);
CREATE INDEX idx_batch_post_jobs_status
  ON batch_post_jobs(company_id, status, priority, created_at);
CREATE INDEX idx_batch_post_job_items_job
  ON batch_post_job_items(company_id, job_id, status);
CREATE INDEX idx_batch_post_job_items_source
  ON batch_post_job_items(company_id, source_id);
CREATE INDEX idx_fixed_assets_company ON fixed_assets(company_id, is_active);
CREATE INDEX idx_fixed_assets_field ON fixed_assets(company_id, field_id);
CREATE INDEX idx_fields_company  ON fields(company_id);
CREATE INDEX idx_fields_season   ON fields(company_id, season_id);
CREATE INDEX idx_inventory_adjustments_company_date
  ON inventory_adjustments(company_id, adjustment_date DESC);
CREATE INDEX idx_inventory_adjustments_status
  ON inventory_adjustments(company_id, status);
CREATE INDEX idx_inventory_adjustment_lines_adj
  ON inventory_adjustment_lines(adjustment_id);
CREATE INDEX idx_inventory_adjustment_lines_item
  ON inventory_adjustment_lines(item_code);
CREATE INDEX idx_posting_rules_company ON posting_rules(company_id, is_active);
CREATE INDEX idx_jel_business_unit ON journal_entry_lines(business_unit_id);
CREATE INDEX idx_jel_currency ON journal_entry_lines(currency_code);
CREATE INDEX idx_md_mg_company_active 
  ON md_material_groups(company_id, is_active);
CREATE INDEX idx_md_bu_company_active 
  ON md_business_units(company_id, is_active);
CREATE INDEX idx_gl_ja_entry_id 
  ON gl_journal_audit(journal_entry_id);
CREATE INDEX idx_gl_ja_action_date 
  ON gl_journal_audit(action, changed_at DESC);
CREATE INDEX idx_gl_ja_changed_by 
  ON gl_journal_audit(changed_by);
CREATE INDEX idx_fx_lookup ON exchange_rates(company_id, from_currency, to_currency, effective_date);
CREATE INDEX idx_gl_audit_entry ON gl_journal_audit(company_id, entry_id, changed_at);
CREATE INDEX idx_role_mapping_lookup ON account_role_mappings(company_id, role_code, is_active);
CREATE INDEX idx_source_docs_company_module ON source_documents(company_id, source_module);
CREATE INDEX idx_source_docs_status ON source_documents(company_id, status);
CREATE INDEX idx_source_doc_links_doc ON source_document_links(source_document_id);
CREATE INDEX idx_source_doc_links_entry ON source_document_links(journal_entry_id);
CREATE INDEX idx_inv_outbox_company_status
  ON inventory_posting_outbox(company_id, status, created_at);
CREATE INDEX idx_inventory_movements_gl_status
  ON inventory_movements(company_id, gl_posting_status, movement_date);
CREATE UNIQUE INDEX idx_outbox_idempotency
  ON inventory_posting_outbox(company_id, idempotency_key);
CREATE INDEX idx_inv_tx_company_date
  ON inventory_transactions(company_id, movement_date DESC);
CREATE INDEX idx_inv_tx_company_type
  ON inventory_transactions(company_id, transaction_type);
CREATE INDEX idx_inv_mov_transaction_id
  ON inventory_movements(transaction_id);
CREATE INDEX idx_pinvsnap_company_period
  ON period_inventory_snapshots(company_id, period_id);
CREATE INDEX idx_inv_mov_movement_type
  ON inventory_movements(company_id, movement_type);
CREATE INDEX idx_inv_mov_gl_status
  ON inventory_movements(company_id, gl_posting_status);
CREATE INDEX idx_inv_mov_item_wh_date
  ON inventory_movements(company_id, item_code, warehouse, movement_date DESC);
CREATE INDEX idx_inv_bal_stale
  ON inventory_balances(company_id, is_stale);
CREATE INDEX idx_equipment_types_company ON equipment_types(company_id, is_active);
CREATE INDEX idx_assets_supplier_link ON fixed_assets_supplier_link(company_id, fixed_asset_id);
CREATE INDEX idx_supplier_transactions_financial_account_id
  ON supplier_transactions(company_id, financial_account_id)
  WHERE financial_account_id IS NOT NULL;
CREATE INDEX idx_supplier_transactions_equipment_type_id
  ON supplier_transactions(company_id, equipment_type_id)
  WHERE equipment_type_id IS NOT NULL;
CREATE INDEX idx_supplier_transactions_equipment_usage_mode
  ON supplier_transactions(company_id, equipment_usage_mode)
  WHERE equipment_usage_mode IS NOT NULL;
CREATE INDEX idx_woe_work_order ON work_order_equipment(work_order_id, company_id);
CREATE INDEX idx_woe_company     ON work_order_equipment(company_id, task_date);
CREATE INDEX idx_work_orders_company_center ON work_orders(company_id, center_code);
CREATE INDEX idx_woe_company_mode ON work_order_equipment(company_id, equipment_usage_mode, task_date);
CREATE INDEX idx_woe_fixed_asset ON work_order_equipment(fixed_asset_id);
CREATE INDEX idx_woe_supplier ON work_order_equipment(supplier_code);
CREATE INDEX idx_operation_types_company ON operation_types(company_id, sort_order);
CREATE INDEX idx_woe_journal_entry ON work_order_equipment(journal_entry_id);
CREATE INDEX idx_woe_company_unposted ON work_order_equipment(company_id, work_order_id, journal_entry_id);
CREATE INDEX idx_coa_intents_company_intent
  ON coa_account_intents(company_id, intent_class, is_active);
CREATE INDEX idx_posting_operation_matrix_active
  ON posting_operation_matrix(company_id, source_module, is_active);
CREATE TRIGGER trg_ct_direction_insert
BEFORE INSERT ON cash_transactions
BEGIN
  SELECT CASE
    WHEN NEW.direction NOT IN ('د', 'م', 'in', 'out', 'وارد', 'صادر', 'debit', 'credit')
    THEN RAISE(ABORT, 'ERR_INVALID_DIRECTION: الاتجاه غير صالح')
  END;
  SELECT CASE
    WHEN NEW.amount IS NULL OR NEW.amount < 0
    THEN RAISE(ABORT, 'ERR_INVALID_AMOUNT: المبلغ يجب أن يكون صفراً أو أكبر')
  END;
  SELECT CASE
    WHEN NEW.transaction_date IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_DATE: تاريخ الحركة مطلوب')
  END;
END;
CREATE TRIGGER trg_st_amount_insert
BEFORE INSERT ON supplier_transactions
BEGIN
  SELECT CASE
    WHEN NEW.transaction_date IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_DATE: تاريخ المعاملة مطلوب')
  END;
  SELECT CASE
    WHEN NEW.entry_type IS NULL OR TRIM(NEW.entry_type) = ''
    THEN RAISE(ABORT, 'ERR_MISSING_ENTRY_TYPE: نوع القيد مطلوب')
  END;
END;
CREATE TRIGGER trg_audit_im_insert
AFTER INSERT ON inventory_movements
BEGIN
  INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, new_value, source)
  VALUES (
    NEW.created_by_user_id,
    NEW.company_id,
    'CREATE',
    'inventory_movements',
    NEW.id,
    json_object(
      'movement_type', NEW.movement_type,
      'item_code',     NEW.item_code,
      'warehouse',     NEW.warehouse,
      'quantity',      NEW.quantity,
      'unit_price',    NEW.unit_price,
      'movement_date', NEW.movement_date
    ),
    CASE WHEN NEW.is_offline_origin = 1 THEN 'offline' ELSE 'web' END
  );
END;
CREATE TRIGGER trg_audit_ct_insert
AFTER INSERT ON cash_transactions
BEGIN
  INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, new_value, source)
  VALUES (
    NEW.created_by_user_id,
    NEW.company_id,
    'CREATE',
    'cash_transactions',
    NEW.id,
    json_object(
      'direction',        NEW.direction,
      'amount',           NEW.amount,
      'transaction_date', NEW.transaction_date,
      'narration',        NEW.narration
    ),
    CASE WHEN NEW.is_offline_origin = 1 THEN 'offline' ELSE 'web' END
  );
END;
CREATE TRIGGER trg_audit_st_insert
AFTER INSERT ON supplier_transactions
BEGIN
  INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, new_value, source)
  VALUES (
    NEW.created_by_user_id,
    NEW.company_id,
    'CREATE',
    'supplier_transactions',
    NEW.id,
    json_object(
      'entry_type',       NEW.entry_type,
      'supplier_code',    NEW.supplier_code,
      'amount',           NEW.amount,
      'transaction_date', NEW.transaction_date
    ),
    CASE WHEN NEW.is_offline_origin = 1 THEN 'offline' ELSE 'web' END
  );
END;
CREATE TRIGGER trg_season_guard_inventory
BEFORE INSERT ON inventory_movements
FOR EACH ROW
WHEN NEW.season_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM seasons WHERE id = NEW.season_id) = 'closed'
    THEN RAISE(ABORT, 'ERR_SEASON_CLOSED: لا يمكن إضافة حركات لموسم مغلق')
  END;
END;
CREATE TRIGGER trg_season_guard_cash
BEFORE INSERT ON cash_transactions
FOR EACH ROW
WHEN NEW.season_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM seasons WHERE id = NEW.season_id) = 'closed'
    THEN RAISE(ABORT, 'ERR_SEASON_CLOSED: لا يمكن إضافة حركات مالية لموسم مغلق')
  END;
END;
CREATE TRIGGER trg_season_guard_suppliers
BEFORE INSERT ON supplier_transactions
FOR EACH ROW
WHEN NEW.season_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM seasons WHERE id = NEW.season_id) = 'closed'
    THEN RAISE(ABORT, 'ERR_SEASON_CLOSED: لا يمكن إضافة معاملات موردين لموسم مغلق')
  END;
END;
CREATE TRIGGER trg_season_guard_work_orders
BEFORE INSERT ON work_orders
FOR EACH ROW
WHEN NEW.season_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM seasons WHERE id = NEW.season_id) = 'closed'
    THEN RAISE(ABORT, 'ERR_SEASON_CLOSED: لا يمكن فتح أمر عمل لموسم مغلق')
  END;
END;
CREATE TRIGGER trg_gl_prevent_posted_delete
BEFORE DELETE ON journal_entries
WHEN OLD.is_posted = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot delete a posted journal entry. Use reversal instead.');
END;
CREATE TRIGGER trg_gl_prevent_posted_line_delete
BEFORE DELETE ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot delete lines of a posted journal entry. Use reversal instead.');
END;
CREATE TRIGGER trg_gl_enforce_no_header_posting
BEFORE INSERT ON journal_entry_lines
WHEN (
  SELECT is_header FROM chart_of_accounts
  WHERE code = NEW.account_code AND company_id = NEW.company_id
) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to a header account. Use a posting-level (leaf) account.');
END;
CREATE TRIGGER trg_gl_enforce_open_period
BEFORE INSERT ON journal_entries
WHEN (
  SELECT is_closed FROM financial_periods
  WHERE id = NEW.period_id AND company_id = NEW.company_id
) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to a closed financial period. Reopen the period or select an open one.');
END;
CREATE TRIGGER trg_account_balances_ai_jel
AFTER INSERT ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1
 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL
BEGIN
  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = NEW.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id),
    NEW.account_code,
    0,
    COALESCE(NEW.debit, 0),
    COALESCE(NEW.credit, 0),
    COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0),
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit + COALESCE(NEW.debit, 0),
    period_credit = period_credit + COALESCE(NEW.credit, 0),
    closing_balance = closing_balance + (COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0)),
    updated_at = datetime('now');
END;
CREATE TRIGGER trg_account_balances_ad_jel
AFTER DELETE ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1
 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL
BEGIN
  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = OLD.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id),
    OLD.account_code,
    0,
    0,
    0,
    0,
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit - COALESCE(OLD.debit, 0),
    period_credit = period_credit - COALESCE(OLD.credit, 0),
    closing_balance = closing_balance - (COALESCE(OLD.debit, 0) - COALESCE(OLD.credit, 0)),
    updated_at = datetime('now');
END;
CREATE TRIGGER trg_account_balances_au_jel
AFTER UPDATE ON journal_entry_lines
BEGIN
  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = OLD.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id),
    OLD.account_code,
    0, 0, 0, 0,
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN COALESCE(OLD.debit, 0) ELSE 0 END),
    period_credit = period_credit -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN COALESCE(OLD.credit, 0) ELSE 0 END),
    closing_balance = closing_balance -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN (COALESCE(OLD.debit, 0) - COALESCE(OLD.credit, 0)) ELSE 0 END),
    updated_at = datetime('now');

  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = NEW.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id),
    NEW.account_code,
    0, 0, 0, 0,
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN COALESCE(NEW.debit, 0) ELSE 0 END),
    period_credit = period_credit +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN COALESCE(NEW.credit, 0) ELSE 0 END),
    closing_balance = closing_balance +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN (COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0)) ELSE 0 END),
    updated_at = datetime('now');
END;
CREATE TRIGGER trg_inv_bal_mark_stale
AFTER INSERT ON inventory_movements
BEGIN
  UPDATE inventory_balances
  SET    is_stale = 1
  WHERE  company_id = NEW.company_id
    AND  item_code  = NEW.item_code
    AND  warehouse  = NEW.warehouse;
END;
CREATE TRIGGER trg_inv_mov_gl_status_guard
BEFORE UPDATE OF gl_posting_status ON inventory_movements
WHEN OLD.gl_posting_status = 'posted'
 AND NEW.gl_posting_status IN ('pending', 'posting', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'GL_STATUS_IMMUTABLE: cannot revert a posted movement');
END;
CREATE TRIGGER trg_im_type_insert
BEFORE INSERT ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type NOT IN ('GRN','ISSUE','RETURN_SUPPLIER','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT')
    THEN RAISE(ABORT, 'ERR_INVALID_MOVEMENT_TYPE: invalid movement type')
  END;
  SELECT CASE
    WHEN NEW.quantity IS NULL OR NEW.quantity <= 0
    THEN RAISE(ABORT, 'ERR_INVALID_QUANTITY: quantity must be > 0')
  END;
  SELECT CASE
    WHEN NEW.warehouse IS NULL OR TRIM(NEW.warehouse) = ''
    THEN RAISE(ABORT, 'ERR_MISSING_WAREHOUSE: warehouse required')
  END;
  SELECT CASE
    WHEN NEW.movement_date IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_DATE: movement_date required')
  END;
  SELECT CASE
    WHEN NEW.item_code IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_ITEM: item_code required')
  END;
END;
CREATE TRIGGER trg_im_type_update
BEFORE UPDATE ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type NOT IN ('GRN','ISSUE','RETURN_SUPPLIER','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT')
    THEN RAISE(ABORT, 'ERR_INVALID_MOVEMENT_TYPE: invalid movement type')
  END;
  SELECT CASE
    WHEN NEW.quantity IS NULL OR NEW.quantity <= 0
    THEN RAISE(ABORT, 'ERR_INVALID_QUANTITY: quantity must be > 0')
  END;
END;
CREATE TRIGGER fk_fixed_assets_supplier_txn
  BEFORE INSERT ON fixed_assets
  BEGIN
    SELECT CASE
      WHEN NEW.supplier_transaction_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM supplier_transactions WHERE id = NEW.supplier_transaction_id)
      THEN RAISE(ABORT, 'Invalid supplier_transaction_id')
    END;
  END;
CREATE TRIGGER trg_woe_validate_usage_mode_insert
BEFORE INSERT ON work_order_equipment
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.equipment_usage_mode NOT IN ('owned', 'rental')
    THEN RAISE(ABORT, 'equipment_usage_mode must be owned or rental')
  END;

  SELECT CASE
    WHEN NEW.equipment_usage_mode = 'owned' AND NEW.fixed_asset_id IS NULL
    THEN RAISE(ABORT, 'fixed_asset_id is required when equipment_usage_mode=owned')
  END;
END;
CREATE TRIGGER trg_woe_validate_usage_mode_update
BEFORE UPDATE ON work_order_equipment
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.equipment_usage_mode NOT IN ('owned', 'rental')
    THEN RAISE(ABORT, 'equipment_usage_mode must be owned or rental')
  END;

  SELECT CASE
    WHEN NEW.equipment_usage_mode = 'owned' AND NEW.fixed_asset_id IS NULL
    THEN RAISE(ABORT, 'fixed_asset_id is required when equipment_usage_mode=owned')
  END;
END;
CREATE TRIGGER trg_gl_enforce_existing_account_insert
BEFORE INSERT ON journal_entry_lines
WHEN NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to a missing account code.');
END;
CREATE TRIGGER trg_gl_enforce_active_account_insert
BEFORE INSERT ON journal_entry_lines
WHEN EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
    AND coa.is_active = 0
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to an inactive account.');
END;
CREATE TRIGGER trg_gl_enforce_no_header_posting_update
BEFORE UPDATE OF account_code ON journal_entry_lines
WHEN EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
    AND coa.is_header = 1
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to a header account.');
END;
CREATE TRIGGER trg_gl_enforce_existing_account_update
BEFORE UPDATE OF account_code ON journal_entry_lines
WHEN NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot use missing account code on journal line update.');
END;
CREATE TRIGGER trg_gl_enforce_active_account_update
BEFORE UPDATE OF account_code ON journal_entry_lines
WHEN EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
    AND coa.is_active = 0
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot use inactive account on journal line update.');
END;
CREATE TRIGGER trg_pr_control_account_guard_insert
BEFORE INSERT ON posting_rules
WHEN NEW.rule_type = 'control'
 AND NEW.is_active = 1
 AND NEW.account_code IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM chart_of_accounts coa
   WHERE coa.company_id = NEW.company_id
     AND coa.code = NEW.account_code
     AND coa.is_active = 1
     AND coa.is_header = 0
 )
BEGIN
  SELECT RAISE(ABORT, 'POSTING_RULE_INVALID: control mapping account must be existing, active, and posting-level.');
END;
CREATE TRIGGER trg_pr_control_account_guard_update
BEFORE UPDATE OF account_code, is_active ON posting_rules
WHEN NEW.rule_type = 'control'
 AND NEW.is_active = 1
 AND NEW.account_code IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM chart_of_accounts coa
   WHERE coa.company_id = NEW.company_id
     AND coa.code = NEW.account_code
     AND coa.is_active = 1
     AND coa.is_header = 0
 )
BEGIN
  SELECT RAISE(ABORT, 'POSTING_RULE_INVALID: control mapping account must be existing, active, and posting-level.');
END;
CREATE TRIGGER trg_pr_general_slots_guard_insert
BEFORE INSERT ON posting_rules
WHEN NEW.rule_type = 'general'
 AND NEW.is_active = 1
BEGIN
  SELECT CASE WHEN NEW.sales_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.sales_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: sales_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.purchases_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.purchases_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: purchases_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.cogs_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.cogs_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: cogs_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.sales_returns_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.sales_returns_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: sales_returns_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.purch_returns_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.purch_returns_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: purch_returns_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.expense_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.expense_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: expense_account must be existing, active, and posting-level.') END;
END;
CREATE TRIGGER trg_pr_general_slots_guard_update
BEFORE UPDATE OF sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active ON posting_rules
WHEN NEW.rule_type = 'general'
 AND NEW.is_active = 1
BEGIN
  SELECT CASE WHEN NEW.sales_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.sales_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: sales_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.purchases_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.purchases_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: purchases_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.cogs_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.cogs_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: cogs_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.sales_returns_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.sales_returns_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: sales_returns_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.purch_returns_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.purch_returns_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: purch_returns_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.expense_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.expense_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: expense_account must be existing, active, and posting-level.') END;
END;
CREATE TRIGGER trg_pr_inventory_slots_guard_insert
BEFORE INSERT ON posting_rules
WHEN NEW.rule_type = 'inventory'
 AND NEW.is_active = 1
BEGIN
  SELECT CASE WHEN NEW.inventory_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.inventory_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: inventory_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.wip_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.wip_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: wip_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.finished_goods_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.finished_goods_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: finished_goods_account must be existing, active, and posting-level.') END;
END;
CREATE TRIGGER trg_pr_inventory_slots_guard_update
BEFORE UPDATE OF inventory_account, wip_account, finished_goods_account, is_active ON posting_rules
WHEN NEW.rule_type = 'inventory'
 AND NEW.is_active = 1
BEGIN
  SELECT CASE WHEN NEW.inventory_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.inventory_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: inventory_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.wip_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.wip_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: wip_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.finished_goods_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.finished_goods_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: finished_goods_account must be existing, active, and posting-level.') END;
END;
CREATE TRIGGER trg_gl_prevent_posted_line_update BEFORE UPDATE ON journal_entry_lines WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 BEGIN SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot modify lines of a posted journal entry. Use reversal instead.'); END;
CREATE VIEW trial_balance AS
SELECT
  jel.company_id,
  jel.account_code,
  coa.name          AS account_name,
  coa.account_type,
  SUM(jel.debit)    AS total_debit,
  SUM(jel.credit)   AS total_credit,
  SUM(jel.debit) - SUM(jel.credit) AS net_balance
FROM journal_entry_lines jel
JOIN journal_entries     je  ON je.id = jel.entry_id AND je.is_posted = 1
JOIN chart_of_accounts   coa ON coa.code = jel.account_code
                              AND coa.company_id = jel.company_id
GROUP BY jel.company_id, jel.account_code, coa.name, coa.account_type;
CREATE VIEW profit_and_loss AS
SELECT
  jel.company_id,
  coa.account_type,
  coa.code,
  coa.name,
  SUM(jel.credit) - SUM(jel.debit) AS balance
FROM journal_entry_lines jel
JOIN journal_entries   je  ON je.id = jel.entry_id AND je.is_posted = 1
JOIN chart_of_accounts coa ON coa.code = jel.account_code
                           AND coa.company_id = jel.company_id
WHERE coa.account_type IN ('revenue','expense')
GROUP BY jel.company_id, coa.account_type, coa.code, coa.name;
CREATE VIEW cash_flow_summary AS
SELECT
  company_id,
  year,
  month,
  SUM(CASE WHEN direction = 'د' THEN amount ELSE 0 END) AS total_in,
  SUM(CASE WHEN direction = 'م' THEN amount ELSE 0 END) AS total_out,
  SUM(CASE WHEN direction = 'د' THEN amount ELSE -amount END) AS net_flow
FROM cash_transactions
GROUP BY company_id, year, month;
CREATE VIEW vw_stock_balances AS
  SELECT
    im.company_id,
    w.id   AS warehouse_id,
    im.warehouse,
    im.item_code,
    i.name AS item_name,
    i.unit,
    im.balance_qty   AS balance_qty,
    im.balance_value AS balance_value
  FROM inventory_movements im
  JOIN warehouses w
    ON  w.company_id = im.company_id
    AND w.name       = im.warehouse
    AND w.is_active  = 1
  JOIN items i
    ON  i.code       = im.item_code
    AND i.company_id = im.company_id
  WHERE im.id IN (
    SELECT MAX(id)
    FROM   inventory_movements
    GROUP  BY company_id, item_code, warehouse
  )
  AND im.balance_qty != 0;
CREATE VIEW vw_item_catalog_status AS
WITH movement_stats AS (
  SELECT
    company_id,
    item_code,
    COUNT(*) AS movement_count,
    SUM(COALESCE(qty_in, 0)) AS total_in,
    SUM(COALESCE(qty_out, 0)) AS total_out,
    SUM(COALESCE(qty_in, 0) - COALESCE(qty_out, 0)) AS balance_qty,
    SUM(COALESCE(value_in, 0) - COALESCE(value_out, 0)) AS balance_value
  FROM inventory_movements
  WHERE item_code IS NOT NULL
  GROUP BY company_id, item_code
)
SELECT
  i.company_id,
  i.code,
  i.name,
  i.unit,
  i.warehouse,
  i.is_active,
  COALESCE(ms.movement_count, 0) AS movement_count,
  COALESCE(ms.total_in, 0) AS total_in,
  COALESCE(ms.total_out, 0) AS total_out,
  COALESCE(ms.balance_qty, 0) AS balance_qty,
  COALESCE(ms.balance_value, 0) AS balance_value,
  CASE
    WHEN COALESCE(ms.balance_qty, 0) > 0 THEN 'in_stock'
    WHEN COALESCE(ms.movement_count, 0) > 0 THEN 'moved_zero_balance'
    ELSE 'catalog_only'
  END AS catalog_status
FROM items i
LEFT JOIN movement_stats ms
  ON ms.company_id = i.company_id
 AND ms.item_code = i.code;
CREATE VIEW vw_supplier_entries AS SELECT je.* FROM journal_entries je WHERE je.company_id = 1 AND (je.ref_type = 'supplier_transaction' OR (je.ref_type = 'business_event' AND EXISTS(SELECT 1 FROM business_events be WHERE be.id = je.ref_id AND be.source_module = 'suppliers')));
CREATE VIEW vw_inventory_entries AS SELECT je.* FROM journal_entries je WHERE je.company_id = 1 AND (je.ref_type = 'inventory_movement' OR (je.ref_type = 'business_event' AND EXISTS(SELECT 1 FROM business_events be WHERE be.id = je.ref_id AND be.source_module = 'inventory')));
CREATE VIEW vw_cash_entries AS SELECT je.* FROM journal_entries je WHERE je.company_id = 1 AND (je.ref_type = 'cash_transaction' OR (je.ref_type = 'business_event' AND EXISTS(SELECT 1 FROM business_events be WHERE be.id = je.ref_id AND be.source_module = 'cash')));
CREATE VIEW vw_coa_audit_metrics AS
WITH
missing_parent AS (
  SELECT COUNT(*) AS c
  FROM chart_of_accounts a
  LEFT JOIN chart_of_accounts p
    ON p.company_id = a.company_id
   AND p.code = a.parent_code
  WHERE a.parent_code IS NOT NULL
    AND p.code IS NULL
),
leaf_with_children AS (
  SELECT COUNT(*) AS c
  FROM chart_of_accounts a
  WHERE a.is_header = 0
    AND EXISTS (
      SELECT 1 FROM chart_of_accounts c
      WHERE c.company_id = a.company_id
        AND c.parent_code = a.code
    )
),
posted_to_header AS (
  SELECT COUNT(*) AS c
  FROM journal_entry_lines jel
  JOIN journal_entries je
    ON je.id = jel.entry_id
   AND je.company_id = jel.company_id
  JOIN chart_of_accounts coa
    ON coa.company_id = jel.company_id
   AND coa.code = jel.account_code
  WHERE je.is_posted = 1
    AND coa.is_header = 1
),
wrong_account_type AS (
  SELECT COUNT(*) AS c
  FROM posting_rules pr
  JOIN chart_of_accounts coa
    ON coa.company_id = pr.company_id
   AND coa.code = pr.account_code
  WHERE pr.rule_type = 'control'
    AND pr.is_active = 1
    AND pr.mapping_key IS NOT NULL
    AND (
      (pr.mapping_key IN ('cash') AND coa.account_type <> 'asset')
      OR (pr.mapping_key IN ('inventory', 'wip_asset', 'accounts_receivable') AND coa.account_type <> 'asset')
      OR (pr.mapping_key IN ('accounts_payable', 'wages_payable', 'deferred_revenue', 'accumulated_depreciation') AND coa.account_type <> 'liability')
      OR (pr.mapping_key IN ('revenue', 'revenue_default', 'revenue_crops') AND coa.account_type <> 'revenue')
      OR (pr.mapping_key IN ('cogs', 'cost_of_goods', 'expense_default', 'depreciation_expense', 'wages_expense', 'labor_expense') AND coa.account_type <> 'expense')
      OR (pr.mapping_key IN ('wip_contra') AND coa.account_type <> 'equity')
    )
),
orphan_rules AS (
  SELECT COUNT(*) AS c
  FROM posting_rules pr
  WHERE pr.is_active = 1
    AND (
      (pr.account_code IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.account_code
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.sales_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.sales_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.purchases_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.purchases_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.cogs_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.cogs_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.expense_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.expense_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.inventory_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.inventory_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.wip_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.wip_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.finished_goods_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.finished_goods_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
    )
),
duplicate_control_accounts AS (
  SELECT COUNT(*) AS c
  FROM (
    SELECT company_id, mapping_key
    FROM posting_rules
    WHERE rule_type = 'control'
      AND is_active = 1
      AND mapping_key IS NOT NULL
    GROUP BY company_id, mapping_key
    HAVING COUNT(*) > 1
  ) x
),
metrics(metric, severity, issue_count) AS (
  VALUES
    ('parent_missing', 'critical', (SELECT c FROM missing_parent)),
    ('leaf_with_children', 'high', (SELECT c FROM leaf_with_children)),
    ('posted_to_header', 'critical', (SELECT c FROM posted_to_header)),
    ('wrong_account_type', 'high', (SELECT c FROM wrong_account_type)),
    ('orphan_rules', 'critical', (SELECT c FROM orphan_rules)),
    ('duplicate_control_accounts', 'high', (SELECT c FROM duplicate_control_accounts))
)
SELECT metric, severity, issue_count
FROM metrics;
