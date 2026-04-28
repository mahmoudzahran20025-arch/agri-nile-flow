-- Migration: 0056 — WIP Balances for Multi-Season Crops
--
-- Problem: Closing a season with uncompleted crops (sugarcane 14 months,
-- perennial orchards) silently drops WIP costs — there's no carry-forward.
--
-- Solution: New table to track work-in-progress balances when closing a season,
-- allowing carry-forward to the next season with GL entry.

CREATE TABLE IF NOT EXISTS wip_balances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL,
  from_season_id  INTEGER NOT NULL,
  to_season_id    INTEGER,  -- NULL = carried but not yet assigned to next season
  field_id        INTEGER NOT NULL,
  crop_name       TEXT NOT NULL,
  cost_balance    REAL NOT NULL DEFAULT 0,
  journal_entry_id INTEGER,  -- GL entry for the carry-forward
  created_by      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'carried', 'closed')),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(from_season_id) REFERENCES seasons(id),
  FOREIGN KEY(to_season_id) REFERENCES seasons(id),
  FOREIGN KEY(field_id) REFERENCES fields(id),
  FOREIGN KEY(journal_entry_id) REFERENCES journal_entries(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE INDEX idx_wip_balances_company_season ON wip_balances(company_id, from_season_id);
CREATE INDEX idx_wip_balances_field ON wip_balances(company_id, field_id);
CREATE INDEX idx_wip_balances_status ON wip_balances(company_id, status);

-- Seed WIP asset control account for all companies that don't have it
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'wip_asset', '1350', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type = 'control'
    AND pr.mapping_key = 'wip_asset'
);

-- Seed WIP contra account (offset for the GL entry)
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'wip_contra', '3350', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type = 'control'
    AND pr.mapping_key = 'wip_contra'
);
