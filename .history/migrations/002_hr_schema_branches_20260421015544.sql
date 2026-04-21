-- ============================================================
-- Migration 002 — HR Complete Schema + Critical Fixes
-- Date: 2026-04-21
-- Tables: branches, employee_job_details, attendance_records,
--         leave_types, leave_requests, salary_advances,
--         payroll_runs, payroll_items, employee_assets
-- Fixes:  journal_entry_lines.center_code, purchase_contracts index
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- FIX 1: Add center_code to journal_entry_lines
-- ────────────────────────────────────────────────────────────
ALTER TABLE journal_entry_lines ADD COLUMN center_code INTEGER;

-- ────────────────────────────────────────────────────────────
-- FIX 2: Soft FK index on purchase_contracts.supplier_code
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pc_supplier ON purchase_contracts(company_id, supplier_code);

-- ────────────────────────────────────────────────────────────
-- 1. BRANCHES (must be before employee_job_details)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
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
CREATE INDEX IF NOT EXISTS idx_branches_company ON branches(company_id);

-- ────────────────────────────────────────────────────────────
-- 2. EMPLOYEE JOB DETAILS (بيانات الوظيفة التفصيلية)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_job_details (
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
CREATE INDEX IF NOT EXISTS idx_ejd_company ON employee_job_details(company_id);
CREATE INDEX IF NOT EXISTS idx_ejd_branch  ON employee_job_details(branch_id);

-- ────────────────────────────────────────────────────────────
-- 3. ATTENDANCE RECORDS (الحضور والانصراف)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_records (
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
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_att_emp  ON attendance_records(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_att_comp ON attendance_records(company_id, work_date);

-- ────────────────────────────────────────────────────────────
-- 4. LEAVE TYPES (أنواع الإجازات)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  name          TEXT    NOT NULL,
  -- سنوية / مرضية / طارئة / بدون راتب
  days_per_year INTEGER DEFAULT 0,
  is_paid       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_lt_company ON leave_types(company_id);

-- ────────────────────────────────────────────────────────────
-- 5. LEAVE REQUESTS (طلبات الإجازة)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
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
CREATE INDEX IF NOT EXISTS idx_leave_emp  ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_comp ON leave_requests(company_id, status);

-- ────────────────────────────────────────────────────────────
-- 6. SALARY ADVANCES (طلبات السلف)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_advances (
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
CREATE INDEX IF NOT EXISTS idx_sa_emp     ON salary_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_sa_company ON salary_advances(company_id, status);

-- ────────────────────────────────────────────────────────────
-- 7. PAYROLL RUNS (مسيرات الرواتب)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_runs (
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
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, period_year, period_month)
);
CREATE INDEX IF NOT EXISTS idx_pr_company ON payroll_runs(company_id, period_year, period_month);

-- ────────────────────────────────────────────────────────────
-- 8. PAYROLL ITEMS (تفاصيل مسيرة كل موظف)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_items (
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
CREATE INDEX IF NOT EXISTS idx_pi_run      ON payroll_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pi_employee ON payroll_items(employee_id);

-- ────────────────────────────────────────────────────────────
-- 9. EMPLOYEE ASSETS (أصول تحت الموظف)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_assets (
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
CREATE INDEX IF NOT EXISTS idx_ea_employee ON employee_assets(employee_id);
CREATE INDEX IF NOT EXISTS idx_ea_company  ON employee_assets(company_id);
