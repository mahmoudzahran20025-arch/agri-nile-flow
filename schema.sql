-- ============================================================
-- Nawa AgroLedger — D1 Schema  (Phase 1 + Core Extension)
-- Worker: one-piece-flow.zahranmalk2.workers.dev
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. COMPANY REGISTRY
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    UNIQUE NOT NULL,
  name         TEXT    NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 1. IDENTITY & GOVERNANCE
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    UNIQUE NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT,
  UNIQUE (module, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_companies (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id),
  is_active  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, company_id, role_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
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
CREATE INDEX IF NOT EXISTS idx_audit_company   ON audit_log(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_table     ON audit_log(table_name, record_id);

CREATE TABLE IF NOT EXISTS approval_requests (
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
CREATE INDEX IF NOT EXISTS idx_approval_company ON approval_requests(company_id, status);

CREATE TABLE IF NOT EXISTS approval_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL REFERENCES approval_requests(id),
  actor_id    INTEGER NOT NULL REFERENCES users(id),
  action      TEXT    NOT NULL,
  comment     TEXT,
  acted_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 2. SEASONS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  season_type  TEXT    NOT NULL DEFAULT 'winter',
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'planning',
  notes        TEXT,
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_seasons_company ON seasons(company_id);

-- ────────────────────────────────────────────────────────────
-- 3. MASTER DATA  (core — extended with company_id)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  activity     TEXT,
  notes        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (code, company_id)
);
CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company_id);

CREATE TABLE IF NOT EXISTS cost_centers (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  PRIMARY KEY (code, company_id)
);
CREATE INDEX IF NOT EXISTS idx_cc_company ON cost_centers(company_id);

CREATE TABLE IF NOT EXISTS accounts (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  PRIMARY KEY (code, company_id)
);

CREATE TABLE IF NOT EXISTS expense_types (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  PRIMARY KEY (code, company_id)
);

CREATE TABLE IF NOT EXISTS sub_locations (
  code         INTEGER NOT NULL,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT    NOT NULL,
  PRIMARY KEY (code, company_id)
);

CREATE TABLE IF NOT EXISTS items (
  code              INTEGER NOT NULL,
  company_id        INTEGER NOT NULL REFERENCES companies(id),
  name              TEXT    NOT NULL,
  unit              TEXT,
  warehouse         TEXT,
  reorder_threshold REAL    NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (code, company_id)
);
CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);

CREATE TABLE IF NOT EXISTS partners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  name          TEXT    NOT NULL,
  capital_paid  REAL    NOT NULL DEFAULT 0,
  current_acct  REAL    NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_partners_company ON partners(company_id);

-- ────────────────────────────────────────────────────────────
-- 4. TRANSACTION TABLES  (core — extended with FK extensions)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_transactions (
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
);
CREATE INDEX IF NOT EXISTS idx_st_company_date    ON supplier_transactions(company_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_st_supplier        ON supplier_transactions(company_id, supplier_code);
CREATE INDEX IF NOT EXISTS idx_st_center          ON supplier_transactions(company_id, center_code);
CREATE INDEX IF NOT EXISTS idx_st_season          ON supplier_transactions(company_id, season_id);
CREATE INDEX IF NOT EXISTS idx_st_year_month      ON supplier_transactions(company_id, year, month);

CREATE TABLE IF NOT EXISTS cash_transactions (
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
);
CREATE INDEX IF NOT EXISTS idx_ct_company_date ON cash_transactions(company_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_ct_supplier     ON cash_transactions(company_id, supplier_code);
CREATE INDEX IF NOT EXISTS idx_ct_season       ON cash_transactions(company_id, season_id);
CREATE INDEX IF NOT EXISTS idx_ct_year_month   ON cash_transactions(company_id, year, month);

CREATE TABLE IF NOT EXISTS inventory_movements (
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
);
CREATE INDEX IF NOT EXISTS idx_im_company_date ON inventory_movements(company_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_im_item         ON inventory_movements(company_id, item_code);
CREATE INDEX IF NOT EXISTS idx_im_warehouse    ON inventory_movements(company_id, warehouse);
CREATE INDEX IF NOT EXISTS idx_im_season       ON inventory_movements(company_id, season_id);

-- ────────────────────────────────────────────────────────────
-- 5. SEED DATA — Roles & Permissions
-- ────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO roles (name, description, is_system) VALUES
  ('super_admin',   'مدير النظام العام', 1),
  ('company_admin', 'مدير الشركة', 1),
  ('accountant',    'محاسب', 1),
  ('warehouse_mgr', 'مدير مخازن', 1),
  ('field_supervisor', 'مشرف حقل', 1),
  ('viewer',        'مشاهد فقط', 1);

INSERT OR IGNORE INTO permissions (module, action, description) VALUES
  ('suppliers',  'read',    'عرض الموردين'),
  ('suppliers',  'create',  'إضافة موردين'),
  ('suppliers',  'edit',    'تعديل الموردين'),
  ('suppliers',  'export',  'تصدير بيانات الموردين'),
  ('treasury',   'read',    'عرض الخزينة'),
  ('treasury',   'create',  'إضافة حركات الخزينة'),
  ('treasury',   'approve', 'اعتماد مدفوعات كبيرة'),
  ('inventory',  'read',    'عرض المخازن'),
  ('inventory',  'create',  'إضافة حركات مخزنية'),
  ('reports',    'read',    'عرض التقارير'),
  ('reports',    'export',  'تصدير التقارير'),
  ('config',     'read',    'عرض الإعدادات'),
  ('config',     'write',   'تعديل الإعدادات'),
  ('admin',      'users',   'إدارة المستخدمين'),
  ('admin',      'audit',   'عرض سجل المراجعة');
