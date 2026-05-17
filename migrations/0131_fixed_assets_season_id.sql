-- Migration: 0131 — Add season_id to fixed_assets
--
-- Fixes a gap: postMonthlyDepreciation() in finance_core.ts:104 selects
-- season_id from fixed_assets but the column was never added in migration 0057.
-- This would cause a silent NULL read (not an error) for every depreciation post.
--
-- Also adds crop_cycle_id to support proportional depreciation allocation
-- across multiple active crop cycles (Phase 6 of the WIP engine).
-- Nullable — assets not yet allocated to a cycle continue to post depreciation
-- as operating expense (existing behavior preserved).

-- season_id already exists on fixed_assets from a prior migration.
-- Only add the new columns needed for Phase 6 depreciation allocation.
ALTER TABLE fixed_assets ADD COLUMN crop_cycle_id INTEGER REFERENCES crop_cycles(id);

-- Allocation method controls how depreciation is split when an asset serves
-- multiple active crop cycles on the same or different fields.
-- NULL = single-cycle or no WIP allocation (posts to operating expense as before).
ALTER TABLE fixed_assets ADD COLUMN allocation_method TEXT
  CHECK(allocation_method IN ('percentage', 'machine_hours', 'acreage', 'manual'));

CREATE INDEX IF NOT EXISTS idx_fixed_assets_crop_cycle
  ON fixed_assets(company_id, crop_cycle_id)
  WHERE crop_cycle_id IS NOT NULL;
