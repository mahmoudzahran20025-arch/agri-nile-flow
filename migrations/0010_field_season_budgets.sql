-- Phase C-1: Cost Alerts & Variance Analysis
-- Budget targets per field per season (cost per feddan)
CREATE TABLE IF NOT EXISTS field_season_budgets (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL,
  field_id            INTEGER NOT NULL,
  season_id           INTEGER NOT NULL,
  budget_per_feddan   REAL    NOT NULL CHECK (budget_per_feddan >= 0),
  notes               TEXT,
  created_by          INTEGER,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, field_id, season_id),
  FOREIGN KEY (field_id)  REFERENCES fields(id)  ON DELETE CASCADE,
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fsb_company_season
  ON field_season_budgets(company_id, season_id);
