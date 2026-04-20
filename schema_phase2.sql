-- ============================================================
-- Agri Nile Flow — Phase 2 Schema
-- Run: npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=./schema_phase2.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 6. FIELDS (قطع الأراضي)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fields (
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
  UNIQUE (code, company_id)
);
CREATE INDEX IF NOT EXISTS idx_fields_company  ON fields(company_id);
CREATE INDEX IF NOT EXISTS idx_fields_season   ON fields(company_id, season_id);

-- ────────────────────────────────────────────────────────────
-- 7. EMPLOYEES (الموظفون)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
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
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);

-- ────────────────────────────────────────────────────────────
-- 8. WORK ORDERS (أوامر العمل الحقلي)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
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
CREATE INDEX IF NOT EXISTS idx_wo_company  ON work_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_wo_season   ON work_orders(company_id, season_id);
CREATE INDEX IF NOT EXISTS idx_wo_field    ON work_orders(company_id, field_id);
CREATE INDEX IF NOT EXISTS idx_wo_status   ON work_orders(company_id, status);

-- ── Work Tasks (مهام تفصيلية لكل أمر عمل)
CREATE TABLE IF NOT EXISTS work_tasks (
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
CREATE INDEX IF NOT EXISTS idx_wt_order   ON work_tasks(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wt_company ON work_tasks(company_id);

-- ────────────────────────────────────────────────────────────
-- 9. CONTRACTS (العقود)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_contracts (
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
CREATE INDEX IF NOT EXISTS idx_pc_company  ON purchase_contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_pc_season   ON purchase_contracts(company_id, season_id);

CREATE TABLE IF NOT EXISTS sales_contracts (
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
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (contract_number, company_id)
);
CREATE INDEX IF NOT EXISTS idx_sc_company ON sales_contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_sc_season  ON sales_contracts(company_id, season_id);

-- ────────────────────────────────────────────────────────────
-- 10. Seed new permissions
-- ────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO permissions (module, action, description) VALUES
  ('fields',     'read',   'عرض قطع الأراضي'),
  ('fields',     'write',  'إدارة قطع الأراضي'),
  ('employees',  'read',   'عرض الموظفين'),
  ('employees',  'write',  'إدارة الموظفين'),
  ('operations', 'read',   'عرض أوامر العمل'),
  ('operations', 'write',  'إدارة أوامر العمل'),
  ('contracts',  'read',   'عرض العقود'),
  ('contracts',  'write',  'إدارة العقود');
