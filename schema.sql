PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE companies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    UNIQUE NOT NULL,
  name         TEXT    NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
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
CREATE TABLE approval_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies(id),
  requester_id   INTEGER NOT NULL REFERENCES users(id),
  subject_table  TEXT    NOT NULL,
  subject_id     INTEGER NOT NULL,
  request_type   TEXT    NOT NULL,
  amount         REAL,
  status         TEXT    NOT NULL DEFAULT 'pending',
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE approval_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL REFERENCES approval_requests(id),
  actor_id    INTEGER NOT NULL REFERENCES users(id),
  action      TEXT    NOT NULL,
  comment     TEXT,
  acted_at    TEXT    NOT NULL DEFAULT (datetime('now'))
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
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (code, company_id)
);
CREATE TABLE cost_centers (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  PRIMARY KEY (code, company_id)
);
CREATE TABLE accounts (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  PRIMARY KEY (code, company_id)
);
CREATE TABLE expense_types (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
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
  is_active         INTEGER NOT NULL DEFAULT 1, category_id INTEGER REFERENCES item_categories(id), track_lots INTEGER NOT NULL DEFAULT 0,
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
, status TEXT NOT NULL DEFAULT 'posted', journal_entry_id INTEGER);
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
, status TEXT DEFAULT 'posted', journal_entry_id INTEGER, warehouse_id INTEGER REFERENCES warehouses(id), dest_warehouse_id INTEGER REFERENCES warehouses(id));
CREATE TABLE fields (
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
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')), center_lat         REAL, center_lng         REAL, geofence_radius_m  INTEGER DEFAULT 150, length_m           REAL, width_m            REAL, center_code INTEGER REFERENCES cost_centers(code),
  UNIQUE (code, company_id)
);
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
);
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
);
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
  notes          TEXT,
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
  closed_by   INTEGER,
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
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')), local_id TEXT,
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
  description  TEXT, center_code INTEGER, season_id INTEGER REFERENCES seasons(id), field_id INTEGER REFERENCES fields(id),
  FOREIGN KEY(entry_id)   REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE TABLE gl_account_mappings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  mapping_key  TEXT    NOT NULL,  -- cash | accounts_payable | inventory | revenue_default | expense_default
  account_code TEXT    NOT NULL,
  UNIQUE(company_id, mapping_key),
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
CREATE TABLE purchase_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  po_number       TEXT    NOT NULL,                     -- رقم أمر الشراء
  supplier_code   INTEGER REFERENCES suppliers(id),
  supplier_name   TEXT,                                  -- اسم المورد (cached)
  order_date      TEXT    NOT NULL,
  expected_date   TEXT,                                  -- تاريخ التسليم المتوقع
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
  UNIQUE(company_id, po_number)
);
CREATE TABLE purchase_order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id           INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  item_code_legacy       TEXT,                       -- كود الصنف (اختياري — قد يكون بدون كود)
  item_name       TEXT    NOT NULL,
  unit            TEXT,
  qty_ordered     REAL    NOT NULL DEFAULT 1,
  qty_received    REAL    NOT NULL DEFAULT 0,
  unit_price      REAL    NOT NULL DEFAULT 0,
  total_price     REAL    GENERATED ALWAYS AS (qty_ordered * unit_price) STORED,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
, warehouse TEXT, item_code INTEGER, center_code INTEGER REFERENCES cost_centers(code));
CREATE TABLE harvest_records (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), field_id INTEGER NOT NULL REFERENCES fields(id), season_id INTEGER REFERENCES seasons(id), harvest_date TEXT NOT NULL, crop_name TEXT NOT NULL, variety TEXT, qty_tons REAL NOT NULL DEFAULT 0, qty_feddan REAL, quality_grade TEXT DEFAULT 'standard', moisture_pct REAL, impurity_pct REAL, actual_cost REAL DEFAULT 0, sell_price_ton REAL, revenue REAL, profit REAL, cost_per_feddan REAL, notes TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE wo_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, operation_type TEXT, description TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE field_season_budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), field_id INTEGER NOT NULL REFERENCES fields(id), season_id INTEGER REFERENCES seasons(id), budget_per_feddan REAL, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(company_id, field_id, season_id));
CREATE TABLE supplier_invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), po_id INTEGER REFERENCES purchase_orders(id), invoice_number TEXT NOT NULL, invoice_date TEXT NOT NULL, total_amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, due_date_days INTEGER DEFAULT 30, payment_date TEXT, payment_ref TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'draft', journal_entry_id INTEGER REFERENCES journal_entries(id), UNIQUE(company_id, invoice_number));
CREATE TABLE wo_template_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL REFERENCES wo_templates(id) ON DELETE CASCADE, task_name TEXT NOT NULL, task_order INTEGER NOT NULL DEFAULT 0, description TEXT, estimated_hours REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE supplier_invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL,
  po_item_id    INTEGER NOT NULL,
  company_id    INTEGER NOT NULL,
  qty_invoiced  REAL    NOT NULL,
  unit_price    REAL    NOT NULL DEFAULT 0, inventory_movement_id INTEGER REFERENCES inventory_movements(id),
  FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id)  ON DELETE CASCADE,
  FOREIGN KEY (po_item_id) REFERENCES purchase_order_items(id)
);
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
  is_active    INTEGER NOT NULL DEFAULT 1,
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
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, name),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(parent_id) REFERENCES item_categories(id)
);
CREATE TABLE inventory_adjustments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  warehouse_id   INTEGER NOT NULL,
  adjustment_date TEXT NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'posted', 'cancelled')),
  created_by     INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)
);
CREATE TABLE inventory_adjustment_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_id  INTEGER NOT NULL,
  item_code      INTEGER NOT NULL,
  theoretical_qty REAL NOT NULL,
  counted_qty    REAL NOT NULL,
  difference     REAL NOT NULL,
  notes          TEXT,
  FOREIGN KEY(adjustment_id) REFERENCES inventory_adjustments(id) ON DELETE CASCADE
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
DELETE FROM sqlite_sequence;
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_audit_company   ON audit_log(company_id, created_at);
CREATE INDEX idx_audit_user      ON audit_log(user_id);
CREATE INDEX idx_audit_table     ON audit_log(table_name, record_id);
CREATE INDEX idx_approval_company ON approval_requests(company_id, status);
CREATE INDEX idx_seasons_company ON seasons(company_id);
CREATE INDEX idx_suppliers_company ON suppliers(company_id);
CREATE INDEX idx_cc_company ON cost_centers(company_id);
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
CREATE INDEX idx_fields_company  ON fields(company_id);
CREATE INDEX idx_fields_season   ON fields(company_id, season_id);
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
CREATE INDEX idx_po_company_status ON purchase_orders(company_id, status);
CREATE INDEX idx_po_supplier       ON purchase_orders(supplier_code, order_date);
CREATE INDEX idx_po_items_po ON purchase_order_items(po_id);
CREATE INDEX idx_jel_center ON journal_entry_lines(company_id, center_code);
CREATE INDEX idx_harvest_company ON harvest_records(company_id);
CREATE INDEX idx_harvest_field ON harvest_records(field_id);
CREATE INDEX idx_harvest_season ON harvest_records(season_id);
CREATE INDEX idx_harvest_date ON harvest_records(company_id, harvest_date);
CREATE INDEX idx_cash_tx_status ON cash_transactions(company_id, status);
CREATE INDEX idx_supplier_tx_status ON supplier_transactions(company_id, status);
CREATE INDEX idx_poi_item_code ON purchase_order_items(item_code);
CREATE INDEX idx_supplier_invoices_po ON supplier_invoices(po_id, company_id);
CREATE INDEX idx_invoice_items_inv    ON supplier_invoice_items(invoice_id);
CREATE INDEX idx_sii_movement
  ON supplier_invoice_items(inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;
CREATE INDEX idx_sinv_status ON supplier_invoices(company_id, status);
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
CREATE UNIQUE INDEX uq_supplier_invoices_number ON supplier_invoices (company_id, invoice_number);
CREATE INDEX idx_contract_advances_lookup ON contract_advances(company_id, contract_id);
CREATE TRIGGER trg_im_type_insert
BEFORE INSERT ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type NOT IN ('اضافة', 'صرف')
    THEN RAISE(ABORT, 'ERR_INVALID_MOVEMENT_TYPE: يجب أن يكون النوع اضافة أو صرف')
  END;
  SELECT CASE
    WHEN NEW.quantity IS NULL OR NEW.quantity <= 0
    THEN RAISE(ABORT, 'ERR_INVALID_QUANTITY: الكمية يجب أن تكون أكبر من صفر')
  END;
  SELECT CASE
    WHEN NEW.warehouse IS NULL OR TRIM(NEW.warehouse) = ''
    THEN RAISE(ABORT, 'ERR_MISSING_WAREHOUSE: المخزن مطلوب')
  END;
  SELECT CASE
    WHEN NEW.movement_date IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_DATE: تاريخ الحركة مطلوب')
  END;
  SELECT CASE
    WHEN NEW.item_code IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_ITEM: كود الصنف مطلوب')
  END;
END;
CREATE TRIGGER trg_im_type_update
BEFORE UPDATE ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type NOT IN ('اضافة', 'صرف')
    THEN RAISE(ABORT, 'ERR_INVALID_MOVEMENT_TYPE: يجب أن يكون النوع اضافة أو صرف')
  END;
  SELECT CASE
    WHEN NEW.quantity IS NULL OR NEW.quantity <= 0
    THEN RAISE(ABORT, 'ERR_INVALID_QUANTITY: الكمية يجب أن تكون أكبر من صفر')
  END;
END;
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
CREATE VIEW vw_stock_balances AS SELECT sq.company_id, sq.warehouse_id, w.name as warehouse, sq.item_code, i.name as item_name, i.unit, sq.quantity as balance_qty, sq.value as balance_value FROM stock_quants sq JOIN warehouses w ON sq.warehouse_id = w.id JOIN items i ON sq.item_code = i.code AND sq.company_id = i.company_id WHERE sq.quantity != 0;
