-- Migration: 0130 — Harvest Settlement records
--
-- HarvestSettlement is the event that converts WIP into inventory or COGS.
-- It links a CropCycle to a harvest_record, snapshots the WIP cost at settlement
-- time, and records the disposition (stored vs. sold immediately).
--
-- Disposition is NEVER defaulted — must be explicit per settlement transaction.
-- This reflects operational reality: wheat may be stored, sugarcane sold to factory,
-- fruit sold immediately or stored by grade.
--
-- One crop_cycle can have at most ONE posted settlement.
-- Partial harvests (multiple picks from one orchard) are modelled as multiple
-- harvest_records that each post PARTIAL settlements — the cycle remains active
-- until a final settlement zeroes the WIP balance.

CREATE TABLE IF NOT EXISTS harvest_settlements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL,
  crop_cycle_id       INTEGER NOT NULL,
  harvest_record_id   INTEGER,          -- NULL = manual settlement without a harvest record
  disposition         TEXT    NOT NULL
                      CHECK(disposition IN ('stored', 'sold')),
  total_wip_cost      REAL    NOT NULL DEFAULT 0,  -- snapshot of WIP balance at settlement time
  qty_tons            REAL,
  cost_per_ton        REAL,             -- computed: total_wip_cost / qty_tons
  -- Stored disposition fields
  inventory_value     REAL,             -- value entering inventory (may differ from WIP cost → variance to COGS)
  warehouse_id        INTEGER,
  item_code           INTEGER,          -- inventory item receiving the harvested crop
  -- Sold disposition fields
  revenue             REAL,
  buyer_name          TEXT,
  -- GL trace
  wip_gl_entry_id     INTEGER,          -- the GL entry zeroing WIP (CR WIP 1350)
  inventory_gl_entry_id INTEGER,        -- DR Inventory 1200 (stored only)
  cogs_gl_entry_id    INTEGER,          -- DR COGS 5400 (sold, or variance on stored)
  revenue_gl_entry_id INTEGER,          -- DR Cash/AR, CR Revenue 4100 (sold only)
  settlement_date     TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'draft'
                      CHECK(status IN ('draft', 'posted', 'reversed')),
  notes               TEXT,
  created_by          INTEGER,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id)            REFERENCES companies(id),
  FOREIGN KEY(crop_cycle_id)         REFERENCES crop_cycles(id),
  FOREIGN KEY(harvest_record_id)     REFERENCES harvest_records(id),
  FOREIGN KEY(wip_gl_entry_id)       REFERENCES journal_entries(id),
  FOREIGN KEY(inventory_gl_entry_id) REFERENCES journal_entries(id),
  FOREIGN KEY(cogs_gl_entry_id)      REFERENCES journal_entries(id),
  FOREIGN KEY(revenue_gl_entry_id)   REFERENCES journal_entries(id),
  FOREIGN KEY(created_by)            REFERENCES users(id)
);

-- Only one POSTED settlement per crop cycle (draft may be reworked)
CREATE UNIQUE INDEX IF NOT EXISTS idx_harvest_settlements_cycle_posted
  ON harvest_settlements(crop_cycle_id)
  WHERE status = 'posted';

CREATE INDEX IF NOT EXISTS idx_harvest_settlements_company
  ON harvest_settlements(company_id, settlement_date);

CREATE INDEX IF NOT EXISTS idx_harvest_settlements_harvest
  ON harvest_settlements(harvest_record_id);
