-- 0095_data_quality_control.sql
-- Data quality governance controls for phased remediation and enforcement.

CREATE TABLE IF NOT EXISTS data_quality_control (
  company_id INTEGER PRIMARY KEY,
  freeze_until TEXT,
  enforce_gates INTEGER NOT NULL DEFAULT 0,
  min_supplier_center_pct REAL NOT NULL DEFAULT 95,
  min_supplier_expense_pct REAL NOT NULL DEFAULT 95,
  min_supplier_equipment_type_pct REAL NOT NULL DEFAULT 90,
  min_cash_center_pct REAL NOT NULL DEFAULT 95,
  min_cash_expense_pct REAL NOT NULL DEFAULT 90,
  min_items_ppg_pct REAL NOT NULL DEFAULT 100,
  min_items_ipg_pct REAL NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS data_quality_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dq_snapshots_company_stage
ON data_quality_snapshots(company_id, stage, created_at);

INSERT INTO data_quality_control (
  company_id,
  enforce_gates,
  min_supplier_center_pct,
  min_supplier_expense_pct,
  min_supplier_equipment_type_pct,
  min_cash_center_pct,
  min_cash_expense_pct,
  min_items_ppg_pct,
  min_items_ipg_pct,
  updated_by
)
VALUES (1, 0, 95, 95, 90, 95, 90, 100, 100, 'migration_0095')
ON CONFLICT(company_id) DO NOTHING;
