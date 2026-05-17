-- Migration: 0128 — CropCycle master entity + agricultural GL accounts
--
-- CropCycle is the primary accounting object for the agricultural WIP engine.
-- Every accumulated cost, carry-forward, and harvest settlement belongs to a
-- specific CropCycle — not a season or field aggregate.
--
-- Invariant: every WIP cost row must reference a crop_cycle_id.
-- This migration is additive. No existing data is touched.

CREATE TABLE IF NOT EXISTS crop_cycles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            INTEGER NOT NULL,
  field_id              INTEGER NOT NULL,
  season_id             INTEGER NOT NULL,  -- season the cycle STARTED in (not necessarily where it ends)
  crop_name             TEXT    NOT NULL,
  crop_type             TEXT    NOT NULL DEFAULT 'annual'
                        CHECK(crop_type IN ('annual', 'long_cycle', 'perennial')),
  planting_date         TEXT    NOT NULL,
  expected_harvest_date TEXT,
  actual_harvest_date   TEXT,
  area_feddan           REAL,              -- may differ from field total if partial planting
  center_code           INTEGER,
  status                TEXT    NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active', 'harvested', 'abandoned', 'written_off')),
  notes                 TEXT,
  created_by            INTEGER,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id)  REFERENCES companies(id),
  FOREIGN KEY(field_id)    REFERENCES fields(id),
  FOREIGN KEY(season_id)   REFERENCES seasons(id),
  FOREIGN KEY(center_code) REFERENCES cost_centers(code),
  FOREIGN KEY(created_by)  REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_crop_cycles_company_field
  ON crop_cycles(company_id, field_id, season_id);

CREATE INDEX IF NOT EXISTS idx_crop_cycles_status
  ON crop_cycles(company_id, status);

CREATE INDEX IF NOT EXISTS idx_crop_cycles_season
  ON crop_cycles(company_id, season_id);

-- ── Agricultural GL accounts ─────────────────────────────────────────────────
-- These must be inserted into chart_of_accounts BEFORE posting_rules seeds,
-- because the trg_pr_control_account_guard_insert trigger rejects any
-- posting_rule that references a non-existent, inactive, or header account.

-- Header: Agricultural Loss / Crop Failure (under "6 — المصروفات الأخرى")
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, is_header, is_active, parent_code)
SELECT c.id, '6106', 'خسائر محاصيل زراعية', 'expense', 'debit', 1, 1, '61'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = c.id AND code = '6106'
);

-- Posting-level: Agricultural Loss — Crop Failure / Abandonment
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, is_header, is_active, parent_code)
SELECT c.id, '61060001', 'خسارة محاصيل — هلاك وترك', 'expense', 'debit', 0, 1, '6106'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = c.id AND code = '61060001'
);

-- ── Posting rules seeds ──────────────────────────────────────────────────────

-- agricultural_cogs: WIP → COGS transfer at harvest settlement
-- Uses existing "تكلفة المبيعات" account 45010001
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'agricultural_cogs', '45010001', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type = 'control'
    AND pr.mapping_key = 'agricultural_cogs'
);

-- agricultural_loss: Crop failure / abandonment write-off (extraordinary item)
-- Uses new account 61060001 seeded above
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'agricultural_loss', '61060001', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type = 'control'
    AND pr.mapping_key = 'agricultural_loss'
);
