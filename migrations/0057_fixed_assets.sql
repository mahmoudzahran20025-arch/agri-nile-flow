-- Migration: 0057 — Fixed Assets and Depreciation
--
-- Problem: Equipment costs (tractors, irrigation, harvesters) are invisible
-- in season P&L and have no depreciation schedule.
--
-- Solution: Tables and GL accounts for fixed asset tracking with automatic
-- monthly depreciation posting.

CREATE TABLE IF NOT EXISTS fixed_assets (
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
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, asset_code),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(center_code) REFERENCES cost_centers(code),
  FOREIGN KEY(field_id) REFERENCES fields(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS depreciation_schedules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL,
  asset_id        INTEGER NOT NULL,
  period_year     INTEGER NOT NULL,
  period_month    INTEGER NOT NULL,
  amount          REAL NOT NULL DEFAULT 0,
  accumulated     REAL NOT NULL DEFAULT 0,
  journal_entry_id INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'posted', 'skipped')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(asset_id, period_year, period_month),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(asset_id) REFERENCES fixed_assets(id),
  FOREIGN KEY(journal_entry_id) REFERENCES journal_entries(id)
);

CREATE INDEX idx_fixed_assets_company ON fixed_assets(company_id, is_active);
CREATE INDEX idx_fixed_assets_field ON fixed_assets(company_id, field_id);
CREATE INDEX idx_depreciation_schedule_period ON depreciation_schedules(company_id, period_year, period_month);
CREATE INDEX idx_depreciation_schedule_asset ON depreciation_schedules(asset_id, status);

-- Seed depreciation expense and accumulated depreciation control accounts
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'depreciation_expense', '5300', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type = 'control'
    AND pr.mapping_key = 'depreciation_expense'
);

INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'accumulated_depreciation', '1590', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type = 'control'
    AND pr.mapping_key = 'accumulated_depreciation'
);
