-- Phase D-5: Work Order Templates
CREATE TABLE IF NOT EXISTS wo_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  name           TEXT    NOT NULL,
  operation_type TEXT    NOT NULL,
  description    TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_by     INTEGER,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wo_template_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id     INTEGER NOT NULL,
  company_id      INTEGER NOT NULL,
  task_name       TEXT    NOT NULL,
  task_order      INTEGER NOT NULL DEFAULT 1,
  estimated_hours REAL,
  notes           TEXT,
  FOREIGN KEY (template_id) REFERENCES wo_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wo_templates_company ON wo_templates(company_id, operation_type);
CREATE INDEX IF NOT EXISTS idx_wo_template_tasks_tpl ON wo_template_tasks(template_id);
