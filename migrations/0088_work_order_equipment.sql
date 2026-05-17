-- Work Order Equipment Lines
-- Tracks machinery/equipment usage per work order for accurate cost-per-feddan calculation.
CREATE TABLE IF NOT EXISTS work_order_equipment (
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
);

CREATE INDEX IF NOT EXISTS idx_woe_work_order ON work_order_equipment(work_order_id, company_id);
CREATE INDEX IF NOT EXISTS idx_woe_company     ON work_order_equipment(company_id, task_date);
