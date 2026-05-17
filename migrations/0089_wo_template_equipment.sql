-- Work order template equipment lines
CREATE TABLE IF NOT EXISTS wo_template_equipment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id     INTEGER NOT NULL REFERENCES wo_templates(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL,
  equipment_name  TEXT    NOT NULL,
  estimated_hours REAL,
  cost_per_hour   REAL    NOT NULL DEFAULT 0,
  notes           TEXT,
  item_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_wo_tpl_equip_tpl ON wo_template_equipment(template_id);
