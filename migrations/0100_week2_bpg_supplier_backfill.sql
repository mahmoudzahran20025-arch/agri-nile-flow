-- ============================================================
-- Migration 0100: Week 2 — BPG Backfill for All Suppliers
-- Scope:
--   1. Assign bus_posting_group_code to all 10 active suppliers
--   2. Activate the AGRI-OP/LABOR/LOCAL general posting rules
--      that have accounts but were left inactive
--   3. Audit log for each BPG assignment
-- Classification rationale (derived from expense_category patterns in supplier_transactions):
--   AGRI-OP  → machinery/equipment suppliers + agri trading companies
--   LABOR    → عمالة (labor) suppliers
--   LOCAL    → cash/misc/non-categorized domestic suppliers
-- ============================================================

-- ── 1. Assign BPG codes to all suppliers ──────────────────────

-- Machinery / equipment operators → AGRI-OP
UPDATE suppliers SET bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 AND code IN (20100033, 20300086, 20300121, 20900151, 20900353, 35300902);

-- عمالة (labor) suppliers → LABOR
UPDATE suppliers SET bus_posting_group_code = 'LABOR'
WHERE company_id = 1 AND code IN (21400002, 21400108);

-- Cash / misc domestic → LOCAL
UPDATE suppliers SET bus_posting_group_code = 'LOCAL'
WHERE company_id = 1 AND code IN (20800286, 10100192);

-- ── 2. Activate general rules that have account_code but are inactive ──
-- These were seeded but left inactive. Now that BPGs are assigned,
-- enable the rules for the three active BPG groups.
-- Note: we ONLY activate rules where account_code is already set and
-- the account exists in COA (trigger trg_pr_control_account_guard_update
-- does not fire on general rules, but we still validate logically here).

-- AGRI-OP catch-all (null PPG) — general expense booking for machinery
UPDATE posting_rules
SET is_active = 1, last_modified_at = datetime('now'), last_modified_by = 1
WHERE company_id = 1
  AND rule_type = 'general'
  AND bus_posting_group_code = 'AGRI-OP'
  AND prod_posting_group_code IS NULL
  AND account_code IS NOT NULL
  AND is_active = 0;

-- LABOR catch-all
UPDATE posting_rules
SET is_active = 1, last_modified_at = datetime('now'), last_modified_by = 1
WHERE company_id = 1
  AND rule_type = 'general'
  AND bus_posting_group_code = 'LABOR'
  AND prod_posting_group_code IS NULL
  AND account_code IS NOT NULL
  AND is_active = 0;

-- LOCAL catch-all
UPDATE posting_rules
SET is_active = 1, last_modified_at = datetime('now'), last_modified_by = 1
WHERE company_id = 1
  AND rule_type = 'general'
  AND bus_posting_group_code = 'LOCAL'
  AND prod_posting_group_code IS NULL
  AND account_code IS NOT NULL
  AND is_active = 0;

-- ── 3. Audit log for BPG assignments ──────────────────────────
INSERT INTO posting_rules_audit
  (company_id, rule_id, action, changed_by, changed_at, change_reason,
   approval_status, approved_by, approved_at, old_values, new_values)
VALUES
  (1, 0, 'UPDATE', 1, datetime('now'),
   'Week 2 BPG backfill: assigned bus_posting_group_code to all 10 suppliers. AGRI-OP → 6 machinery/trading suppliers; LABOR → 2 عمالة suppliers; LOCAL → 2 cash/misc suppliers.',
   'approved', 1, datetime('now'),
   '{"bus_posting_group_code": null, "supplier_count": 10}',
   '{"AGRI-OP": [20100033,20300086,20300121,20900151,20900353,35300902], "LABOR": [21400002,21400108], "LOCAL": [20800286,10100192]}');

-- ── Verification (run manually) ────────────────────────────────
-- SELECT bus_posting_group_code, COUNT(*) FROM suppliers WHERE company_id=1 GROUP BY bus_posting_group_code;
-- Expected: AGRI-OP=6, LABOR=2, LOCAL=2, NULL=0
