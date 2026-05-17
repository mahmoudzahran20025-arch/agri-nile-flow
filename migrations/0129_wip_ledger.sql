-- Migration: 0129 — WIP Ledger (source-of-truth accumulation engine)
--
-- wip_ledger is the authoritative accumulator for crop WIP costs.
-- GL entries are the accounting REFLECTION of wip_ledger entries — not vice versa.
--
-- Invariants:
--   1. Every row is append-only. No UPDATE of cost rows — only trace metadata.
--   2. running_balance is deterministic: SUM of all prior debit-credit for the cycle.
--   3. Settlement zeroes the cycle by posting a credit row equal to total debit balance.
--   4. No row may exist without a valid crop_cycle_id.
--
-- cost_category enum (strict — no free-form text):
--   materials, labor, equipment, overhead, depreciation,
--   irrigation, land_rent, fuel, maintenance, contractor, transport, other
-- subcategory_code: optional free-form for sub-reporting without breaking aggregation.

CREATE TABLE IF NOT EXISTS wip_ledger (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL,
  crop_cycle_id     INTEGER NOT NULL,
  season_id         INTEGER NOT NULL,  -- posting season (may differ from cycle.season_id)
  transaction_date  TEXT    NOT NULL,
  cost_category     TEXT    NOT NULL
                    CHECK(cost_category IN (
                      'materials', 'labor', 'equipment', 'overhead', 'depreciation',
                      'irrigation', 'land_rent', 'fuel', 'maintenance',
                      'contractor', 'transport', 'other'
                    )),
  subcategory_code  TEXT,              -- optional: e.g. 'fertilizer', 'pesticide', 'irrigation_pump'
  debit             REAL    NOT NULL DEFAULT 0,   -- cost accumulated into WIP
  credit            REAL    NOT NULL DEFAULT 0,   -- settlement / carry-forward out
  running_balance   REAL    NOT NULL DEFAULT 0,   -- append-only running total per cycle
  description       TEXT,
  source_module     TEXT,              -- 'inventory' | 'hr' | 'operations' | 'assets' | 'manual'
  source_id         INTEGER,           -- FK to originating record in source module
  transaction_ref   TEXT,              -- '{source_module}:{source_id}' denormalized for queries
  journal_entry_id  INTEGER,           -- GL reflection entry
  allocation_method TEXT,              -- 'percentage' | 'machine_hours' | 'acreage' | 'manual' | NULL
  allocation_share  REAL,              -- 0.0–1.0 (used when asset shared across cycles)
  created_by        INTEGER,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id)       REFERENCES companies(id),
  FOREIGN KEY(crop_cycle_id)    REFERENCES crop_cycles(id),
  FOREIGN KEY(season_id)        REFERENCES seasons(id),
  FOREIGN KEY(journal_entry_id) REFERENCES journal_entries(id),
  FOREIGN KEY(created_by)       REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_wip_ledger_cycle
  ON wip_ledger(company_id, crop_cycle_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_wip_ledger_season
  ON wip_ledger(company_id, season_id, cost_category);

CREATE INDEX IF NOT EXISTS idx_wip_ledger_source
  ON wip_ledger(source_module, source_id);

-- Repurpose wip_balances as the carry-forward audit log.
-- Existing rows (0 in prod) are unaffected. crop_cycle_id is nullable to preserve
-- any legacy rows written before this migration.
ALTER TABLE wip_balances ADD COLUMN crop_cycle_id INTEGER REFERENCES crop_cycles(id);
