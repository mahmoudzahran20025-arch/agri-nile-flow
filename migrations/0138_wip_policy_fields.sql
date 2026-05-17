-- Migration: 0138 — WIP engine policy fields
--
-- Adds configurable policy fields to all WIP-related tables as required by the
-- confirmed Phase 3 architectural decisions (2026-05-17).
-- ALL additions are additive with safe defaults. No existing data is modified.
--
-- Decision 1: harvest_settlements.settlement_mode (inventory | direct_sale)
-- Decision 2: fixed_assets.depreciation_allocation_method + crop_cycles allocation fields
-- Decision 3: wip_ledger.cost_category_code FK to cost_categories (supplements old enum)
-- Decision 4: crop_cycles.abandonment_policy (operating_loss | extraordinary_loss)

-- ── crop_cycles policy fields ─────────────────────────────────────────────────

-- Abandonment treatment (Decision 4)
ALTER TABLE crop_cycles ADD COLUMN abandonment_policy TEXT
  NOT NULL DEFAULT 'operating_loss'
  CHECK(abandonment_policy IN ('operating_loss', 'extraordinary_loss'));

-- Depreciation allocation method for assets used by this cycle (Decision 2)
ALTER TABLE crop_cycles ADD COLUMN depreciation_allocation_method TEXT
  NOT NULL DEFAULT 'machine_hours'
  CHECK(depreciation_allocation_method IN ('machine_hours', 'area_ratio', 'manual'));

-- ── harvest_settlements policy fields ────────────────────────────────────────

-- Settlement mode — controls GL direction: inventory (DR Inv / CR WIP) vs
-- direct_sale (DR COGS / CR WIP). Decision 1.
-- Named settlement_mode to match decision language; disposition column kept for
-- operational meaning (stored/sold) — they are complementary, not duplicates.
ALTER TABLE harvest_settlements ADD COLUMN settlement_mode TEXT
  NOT NULL DEFAULT 'inventory'
  CHECK(settlement_mode IN ('inventory', 'direct_sale'));

-- ── fixed_assets policy fields ───────────────────────────────────────────────

-- Per-asset allocation method override (Decision 2).
-- NULL means "inherit from crop_cycle.depreciation_allocation_method".
ALTER TABLE fixed_assets ADD COLUMN depreciation_allocation_method TEXT
  CHECK(depreciation_allocation_method IN ('machine_hours', 'area_ratio', 'manual'));

-- ── wip_ledger cost category FK ──────────────────────────────────────────────

-- Adds FK to cost_categories master table (Decision 3).
-- The original cost_category CHECK enum column is kept for backwards compatibility
-- with any existing rows; new code should write both columns during the dual-write
-- transition period, then migrate to cost_category_code only in Phase 3.
ALTER TABLE wip_ledger ADD COLUMN cost_category_code TEXT
  REFERENCES cost_categories(code);

-- Index to support cost analysis queries grouped by category
CREATE INDEX IF NOT EXISTS idx_wip_ledger_category_code
  ON wip_ledger(company_id, crop_cycle_id, cost_category_code);

-- ── GL accounts for policy variants ──────────────────────────────────────────

-- Extraordinary loss account for abandonment_policy = 'extraordinary_loss' (Decision 4).
-- Seeded under "6 — المصروفات الأخرى" alongside the operating loss account from 0128.
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, is_header, is_active, parent_code)
SELECT c.id, '61060002', 'خسارة محاصيل — خسارة استثنائية', 'expense', 'debit', 0, 1, '6106'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = c.id AND code = '61060002'
);

-- Posting rule for extraordinary_loss abandonment variant
INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'agricultural_loss_extraordinary', '61060002', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type  = 'control'
    AND pr.mapping_key = 'agricultural_loss_extraordinary'
);
