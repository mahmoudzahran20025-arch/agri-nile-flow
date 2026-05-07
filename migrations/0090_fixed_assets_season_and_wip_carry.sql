-- Add season_id to fixed_assets so depreciation GL lines carry the correct season dimension
ALTER TABLE fixed_assets ADD COLUMN season_id INTEGER REFERENCES seasons(id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_season ON fixed_assets(company_id, season_id);

-- Add carry_forward_season_id to wip_balances so a WIP entry can target a specific future season
-- (the existing to_season_id column already covers this, no schema change needed for WIP)
