-- Migration 0149 — wip_cost_category on items
--
-- Overrides the default WIP cost category when an item is issued (ISSUE movement).
-- Without this, all issued items post to 'materials' in wip_ledger.
-- With this set, e.g. diesel → 'fuel', pesticide → 'materials', machinery spare → 'equipment'.
-- NULL means "use default" (resolves to 'materials' in the inventory resolver).

ALTER TABLE items ADD COLUMN wip_cost_category TEXT
  CHECK(wip_cost_category IN (
    'materials', 'labor', 'equipment', 'depreciation',
    'contractor', 'overhead', 'land_rent', 'fuel', 'other'
  ));
