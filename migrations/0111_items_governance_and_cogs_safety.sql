-- =============================================================================
-- Migration 0111 — Items Governance: PPG Safety Net + COGS Routing Audit View
-- Date: 2026-05-14
-- Phase: A (Additive schema — zero risk, fully reversible)
--
-- Context:
--   prod_posting_group_code (PPG) was added to items in migration 0041.
--   A backfill was done in 0030 (earlier migration, already applied).
--   Items imported AFTER that backfill, or items with unknown categories,
--   may have PPG = NULL. A NULL PPG causes the posting engine to fall through
--   to the global default — silently posting COGS to the wrong account.
--
-- What this does:
--   1. Adds items.area_per_feddan — density/conversion factor (e.g., kg/feddan
--      for fertilizer application rate). Used for cost/feddan normalization.
--   2. Adds items.cogs_account_override — allows per-item COGS account to
--      override the PPG-derived account without touching posting_rules.
--   3. Creates item_ppg_audit VIEW — shows all items with NULL or suspicious PPG
--      so Phase B backfill can be executed precisely.
--   4. Creates a deterministic PPG inference rule set as a VIEW (not auto-applied)
--      so Phase B backfill script can use it.
--
-- Rollback:
--   DROP VIEW IF EXISTS item_ppg_inferred;
--   DROP VIEW IF EXISTS item_ppg_audit;
--   -- column additions are additive; leave in place
-- =============================================================================

-- ── BLOCK 1: items — operational columns ──────────────────────────────────────

-- Application rate per feddan (e.g., 150 kg/feddan for a fertilizer).
-- Used in cost/feddan calculation: cost = qty_issued / area_feddan * unit_cost.
-- NULL = unknown; reporting shows cost/feddan as 'N/A' rather than dividing by zero.
ALTER TABLE items ADD COLUMN area_per_feddan REAL;
-- e.g., urea: 150 kg/feddan → area_per_feddan = 150

-- Per-item COGS account override.
-- When set, the posting engine uses this account instead of the PPG-derived cogs_account.
-- Use case: a specialty item that belongs to a unique GL sub-account not worth
-- creating a new PPG for.
ALTER TABLE items ADD COLUMN cogs_account_override TEXT REFERENCES chart_of_accounts(code);

-- ── BLOCK 2: item_ppg_audit VIEW ──────────────────────────────────────────────
-- Shows every item where COGS routing may be broken.
-- Used by Phase B backfill and daily health check.
DROP VIEW IF EXISTS item_ppg_audit;
CREATE VIEW item_ppg_audit AS
SELECT
  i.company_id,
  i.code                                AS item_code,
  i.name                                AS item_name,
  i.unit,
  c.name                                AS category_name,
  i.prod_posting_group_code             AS current_ppg,
  i.inv_posting_group_code              AS current_ipg,
  i.cogs_account_override,
  CASE
    WHEN i.prod_posting_group_code IS NOT NULL THEN 'OK'
    WHEN i.cogs_account_override   IS NOT NULL THEN 'OK_OVERRIDE'
    ELSE 'MISSING_PPG'
  END                                   AS ppg_status,
  -- How many ISSUE movements exist for this item (exposure to bad COGS routing)
  COALESCE(mv.issue_count, 0)           AS issue_movement_count,
  COALESCE(mv.issue_value, 0)           AS issue_value_total
FROM items i
LEFT JOIN item_categories c ON c.id = i.category_id AND c.company_id = i.company_id
LEFT JOIN (
  SELECT company_id, item_code,
         COUNT(*)           AS issue_count,
         SUM(value_out)     AS issue_value
  FROM inventory_movements
  WHERE movement_type = 'ISSUE'
  GROUP BY company_id, item_code
) mv ON mv.company_id = i.company_id AND mv.item_code = i.code;

-- ── BLOCK 3: item_ppg_inferred VIEW ───────────────────────────────────────────
-- Deterministic inference of PPG from item name + category name patterns.
-- This is the PLAN for Phase B backfill — not auto-applied.
-- Phase B script: UPDATE items SET prod_posting_group_code = inferred_ppg
--                 FROM item_ppg_inferred WHERE ppg_status = 'MISSING_PPG'
--                 AND inferred_ppg IS NOT NULL;
DROP VIEW IF EXISTS item_ppg_inferred;
CREATE VIEW item_ppg_inferred AS
SELECT
  i.company_id,
  i.code          AS item_code,
  i.name          AS item_name,
  i.category_id,
  c.name          AS category_name,
  i.prod_posting_group_code AS current_ppg,
  CASE
    -- Category-name based inference (most reliable signal)
    WHEN LOWER(c.name) LIKE '%سماد%'    OR LOWER(c.name) LIKE '%fert%'     THEN 'FERT'
    WHEN LOWER(c.name) LIKE '%مبيد%'    OR LOWER(c.name) LIKE '%chem%'     THEN 'CHEM'
    WHEN LOWER(c.name) LIKE '%تقاوي%'   OR LOWER(c.name) LIKE '%بذور%'
                                         OR LOWER(c.name) LIKE '%seed%'     THEN 'SEED'
    WHEN LOWER(c.name) LIKE '%وقود%'    OR LOWER(c.name) LIKE '%diesel%'
                                         OR LOWER(c.name) LIKE '%fuel%'     THEN 'FUEL'
    WHEN LOWER(c.name) LIKE '%قطع غيار%' OR LOWER(c.name) LIKE '%spare%'   THEN 'EQUIP_CONS'
    WHEN LOWER(c.name) LIKE '%ري%'      OR LOWER(c.name) LIKE '%irrig%'    THEN 'EQUIP_CONS'
    -- Item-name based fallback (less reliable — ambiguous items)
    WHEN LOWER(i.name)  LIKE '%سماد%'   OR LOWER(i.name) LIKE '%يوريا%'
                                         OR LOWER(i.name) LIKE '%نترات%'   THEN 'FERT'
    WHEN LOWER(i.name)  LIKE '%مبيد%'   OR LOWER(i.name) LIKE '%فطر%'
                                         OR LOWER(i.name) LIKE '%حشر%'     THEN 'CHEM'
    WHEN LOWER(i.name)  LIKE '%تقاوي%'  OR LOWER(i.name) LIKE '%بذر%'     THEN 'SEED'
    WHEN LOWER(i.name)  LIKE '%وقود%'   OR LOWER(i.name) LIKE '%سولار%'   THEN 'FUEL'
    WHEN LOWER(i.name)  LIKE '%قطع%'    OR LOWER(i.name) LIKE '%فلتر%'
                                         OR LOWER(i.name) LIKE '%زيت%'     THEN 'EQUIP_CONS'
    ELSE NULL  -- Cannot infer — must be resolved manually
  END AS inferred_ppg,
  CASE
    -- Corresponding IPG from inferred PPG
    WHEN LOWER(c.name) LIKE '%سماد%'    OR LOWER(i.name) LIKE '%يوريا%'
                                         OR LOWER(i.name) LIKE '%نترات%'   THEN 'FERT-WH'
    WHEN LOWER(c.name) LIKE '%مبيد%'    OR LOWER(i.name) LIKE '%مبيد%'    THEN 'CHEM-WH'
    WHEN LOWER(c.name) LIKE '%تقاوي%'   OR LOWER(i.name) LIKE '%تقاوي%'   THEN 'SEED-WH'
    WHEN LOWER(c.name) LIKE '%قطع غيار%' OR LOWER(i.name) LIKE '%قطع%'    THEN 'SPARE-WH'
    WHEN LOWER(c.name) LIKE '%ري%'      OR LOWER(i.name) LIKE '%ري%'      THEN 'IRR-WH'
    ELSE NULL
  END AS inferred_ipg
FROM items i
LEFT JOIN item_categories c ON c.id = i.category_id AND c.company_id = i.company_id
WHERE i.prod_posting_group_code IS NULL;

-- ── BLOCK 4: Verification ─────────────────────────────────────────────────────
SELECT
  'migration_0111_complete'                                               AS status,
  (SELECT COUNT(*) FROM item_ppg_audit WHERE ppg_status = 'MISSING_PPG') AS items_missing_ppg,
  (SELECT COUNT(*) FROM item_ppg_audit WHERE ppg_status = 'OK')          AS items_ppg_ok,
  (SELECT COUNT(*) FROM item_ppg_inferred WHERE inferred_ppg IS NOT NULL) AS items_inferrable,
  (SELECT COUNT(*) FROM item_ppg_inferred WHERE inferred_ppg IS NULL)    AS items_need_manual_review;
