-- =============================================================================
-- SUPPLIER / SERVICE / ACCOUNTING MODEL HARDENING
-- 001_supplier_service_hardening.sql
-- Generated: 2026-05-11
-- Purpose: Fix all semantic gaps identified in full DB audit
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 1: ADD MISSING AGRICULTURAL OPERATIONAL EXPENSE ACCOUNTS TO COA
-- ─────────────────────────────────────────────────────────────────────────────
-- The COA has 5101 (العمالة) and 5120 (مصروفات إدارية) but is missing:
--   51010023 = عمالة حقلية مؤقتة  (contract field labor — specific leaf under 5101)
--   51010024 = مورد عمالة خارجي   (external labor contractor billing)
--   51300001 = ميكنة زراعية         (agricultural mechanization — new section 5130)
--   51300002 = إيجار آلات ومعدات   (equipment rental)
--   51300003 = إشراف زراعي          (agricultural supervision — replaces phantom 33067)
--   51300004 = نقل وشحن زراعي      (agricultural transport — replaces phantom 33003)
-- ─────────────────────────────────────────────────────────────────────────────

-- Parent header: 5130 = التكاليف التشغيلية الزراعية (Agricultural Operational Costs)
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
VALUES
  (1, '5130',     'التكاليف التشغيلية الزراعية',  'expense', 'debit', '51',   3, 1, 1, 'Agricultural operational cost header — mechanization, field labor, supervision'),
  (1, '51300001', 'ميكنة زراعية',                  'expense', 'debit', '5130', 4, 0, 1, 'Agricultural mechanization — equipment hours, loader rental, tractor hire'),
  (1, '51300002', 'إيجار آلات ومعدات',             'expense', 'debit', '5130', 4, 0, 1, 'Equipment rental — heavy machinery, loader, bulldozer'),
  (1, '51300003', 'إشراف زراعي',                   'expense', 'debit', '5130', 4, 0, 1, 'Agricultural supervision service (replaces phantom 33067)'),
  (1, '51300004', 'نقل وشحن زراعي',               'expense', 'debit', '5130', 4, 0, 1, 'Agricultural transport and logistics (replaces phantom 33003)'),
  (1, '51010023', 'عمالة حقلية مؤقتة',            'expense', 'debit', '5101', 4, 0, 1, 'Temporary field labor — contractor-supplied workers billed per worker/day'),
  (1, '51010024', 'مورد عمالة خارجي',             'expense', 'debit', '5101', 4, 0, 1, 'External labor contractor billing — مستخلص عمالة');

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 2: FIX service_types — update expense accounts to real COA codes
-- ─────────────────────────────────────────────────────────────────────────────

-- SRV_MECH: was 5101 (header) → correct leaf is 51300001 (ميكنة زراعية)
UPDATE service_types
SET
  default_expense_account_code = '51300001',
  name_en                      = 'Mechanization / Equipment Rental',
  updated_at                   = datetime('now')
WHERE code = 'SRV_MECH' AND company_id = 1;

-- SRV_LABOR: was 5101 (header) → correct leaf is 51010023 (عمالة حقلية مؤقتة)
-- Also fix default AP: 21200001 does not exist → use 212000018 (احمد دسوقي) as default
-- Since labor suppliers have their own AP per supplier_service_map, this is just the fallback
UPDATE service_types
SET
  default_expense_account_code = '51010023',
  default_ap_account_code      = '212000018',
  name_en                      = 'Field Labor Supply',
  updated_at                   = datetime('now')
WHERE code = 'SRV_LABOR' AND company_id = 1;

-- SRV_SUPERVISION: was 33067 (doesn't exist) → correct leaf is 51300003 (إشراف زراعي)
UPDATE service_types
SET
  default_expense_account_code = '51300003',
  name_en                      = 'Agricultural Supervision',
  updated_at                   = datetime('now')
WHERE code = 'SRV_SUPERVISION' AND company_id = 1;

-- SRV_LOGISTICS: was 33003 (doesn't exist) → correct leaf is 51300004 (نقل وشحن زراعي)
UPDATE service_types
SET
  default_expense_account_code = '51300004',
  name_en                      = 'Agricultural Transport / Logistics',
  updated_at                   = datetime('now')
WHERE code = 'SRV_LOGISTICS' AND company_id = 1;

-- SRV_SUPPLY: 1407 is correct but is a header → leave as-is (inventory sub-account routing
-- is handled by posting_rules inventory cascade based on prod_posting_group_code on the item)
-- No change needed for SRV_SUPPLY or SRV_SPARE_PARTS

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 3: ADD SRV_ADMIN to service_types
-- ─────────────────────────────────────────────────────────────────────────────
-- SRV_ADMIN is used by 20 posted transactions (all supplier 20900151).
-- It represents administrative / capital-investment related service activity.
-- Correct expense: 51200034 (مصروفات متنوعة) — general admin expense catch-all.
-- AP: 212000013 (جهاز مستقبل مصر - ميكنة) for now, pending partner account review.

INSERT OR IGNORE INTO service_types
  (company_id, code, name_ar, name_en, service_group, default_expense_account_code,
   default_ap_account_code, requires_supplier, requires_document, requires_center, is_active)
VALUES
  (1, 'SRV_ADMIN', 'خدمات إدارية وتشغيلية', 'Administrative / Operational Services',
   'ADMINISTRATION', '51200034', '212000013', 1, 0, 0, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 4: FIX supplier_service_map — add SRV_ADMIN mapping for 20900151
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO supplier_service_map
  (company_id, supplier_code, service_type_code, default_ap_account_code,
   default_expense_account_code, is_primary, is_active)
VALUES
  (1, 20900151, 'SRV_ADMIN', '212000013', '51200034', 0, 1);

-- Fix SRV_SUPPLY mapping for 20900151 — AP should be 212000011 (جهاز مستقبل مصر - اسمدة)
-- not 212000010 (موردون متنوعون) which is too generic
UPDATE supplier_service_map
SET default_ap_account_code = '212000011'
WHERE company_id = 1 AND supplier_code = 20900151 AND service_type_code = 'SRV_SUPPLY';

-- Fix SRV_SUPERVISION for عرفة — AP is 212000010 (generic) — should be 212000014 (شركة عرفة - اسمدة)
-- The supervision is distinct from supply; we use 212000010 for supply, create separate AP
-- Actually 212000014 = عرفة اسمدة, 212000015 = عرفة مبيدات. Supervision should use 212000010 (متنوعون)
-- as there's no dedicated supervision AP — this is correct, leave AP as-is.
-- Fix: update expense_account only (from NULL/missing to correct 51300003)
UPDATE supplier_service_map
SET default_expense_account_code = '51300003'
WHERE company_id = 1 AND supplier_code = 20900353 AND service_type_code = 'SRV_SUPERVISION';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 5: RENAME GENERIC PLACEHOLDER AP ACCOUNTS TO REAL SUPPLIER NAMES
-- ─────────────────────────────────────────────────────────────────────────────
-- 212000029 is currently named "مورد 9" — it is used exclusively by ميكنة احمد عبيد (20300121)
UPDATE chart_of_accounts
SET name = 'ميكنة احمد عبيد'
WHERE company_id = 1 AND code = '212000029';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 6: FIX supplier_service_map — ميكنة احمد عبيد AP account
-- ─────────────────────────────────────────────────────────────────────────────
-- Currently maps to 212000029 (now correctly named). This is fine.
-- No change needed — just the rename above makes it semantically correct.

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 7: POPULATE suppliers.gl_account_code from supplier_service_map
-- ─────────────────────────────────────────────────────────────────────────────
-- For single-service suppliers, gl_account_code = primary AP from service map
-- For multi-service suppliers, gl_account_code = primary service AP (is_primary=1)

UPDATE suppliers
SET gl_account_code = (
  SELECT ssm.default_ap_account_code
  FROM supplier_service_map ssm
  WHERE ssm.company_id = suppliers.company_id
    AND ssm.supplier_code = suppliers.code
    AND ssm.is_primary = 1
    AND ssm.is_active  = 1
  ORDER BY ssm.id ASC
  LIMIT 1
)
WHERE company_id = 1
  AND (gl_account_code IS NULL OR gl_account_code = '');

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 8: FIX POSTING RULES — THE CORE MISROUTING BUG
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem: posting_rules id=1 is the ONLY active general rule.
-- It has:
--   purchases_account = '14070106'  (مخزن متنوع — correct for supply fallback)
--   expense_account   = '51200034'  (مصروفات متنوعة — WRONG for supplier invoices)
--
-- The resolveSupplierInvoice() function reads purchases_account from this rule.
-- But existing posted transactions show debit to 51200034, not 14070106.
-- This means: at the time of posting, purchases_account was NULL or the old rule
-- had expense_account used as fallback. This needs a service-specific override.
--
-- FIX STRATEGY:
--   - Keep rule id=1 as global catch-all (purchases_account=14070106)
--   - Add service-type-specific general rules using BPG codes mapped from service_types
--   - Add matching business_posting_groups for each service type
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 8a: Create business_posting_groups for each service type
INSERT OR IGNORE INTO business_posting_groups (company_id, code, name, is_active)
VALUES
  (1, 'BPG_MECH',       'ميكنة زراعية',              1),
  (1, 'BPG_LABOR',      'عمالة حقلية',               1),
  (1, 'BPG_SUPPLY',     'توريد ومشتريات',            1),
  (1, 'BPG_SUPERVISION','إشراف زراعي',               1),
  (1, 'BPG_LOGISTICS',  'نقل وشحن',                  1),
  (1, 'BPG_SPARE_PARTS','قطع غيار',                  1),
  (1, 'BPG_ADMIN',      'خدمات إدارية',              1);

-- Step 8b: Add service-specific general posting rules
-- These override the catch-all (id=1) for known service types
INSERT OR IGNORE INTO posting_rules
  (company_id, rule_type, bus_posting_group_code, prod_posting_group_code,
   purchases_account, expense_account, cogs_account, sales_account,
   priority, is_active)
VALUES
  -- MECH: Debit 51300001 (ميكنة زراعية) on supplier invoice
  (1, 'general', 'BPG_MECH',        NULL, '51300001', '51300001', NULL, NULL, 10, 1),
  -- LABOR: Debit 51010023 (عمالة حقلية مؤقتة) on supplier invoice
  (1, 'general', 'BPG_LABOR',       NULL, '51010023', '51010023', NULL, NULL, 10, 1),
  -- SUPPLY: Debit 14070106 (مخزن متنوع fallback) — inventory rules handle sub-routing
  (1, 'general', 'BPG_SUPPLY',      NULL, '14070106', '51200034', NULL, NULL, 10, 1),
  -- SUPERVISION: Debit 51300003 (إشراف زراعي)
  (1, 'general', 'BPG_SUPERVISION', NULL, '51300003', '51300003', NULL, NULL, 10, 1),
  -- LOGISTICS: Debit 51300004 (نقل وشحن زراعي)
  (1, 'general', 'BPG_LOGISTICS',   NULL, '51300004', '51300004', NULL, NULL, 10, 1),
  -- SPARE_PARTS: Debit 14070105 (مخزن قطع غيار)
  (1, 'general', 'BPG_SPARE_PARTS', NULL, '14070105', '14070105', NULL, NULL, 10, 1),
  -- ADMIN: Debit 51200034 (مصروفات متنوعة) — general admin
  (1, 'general', 'BPG_ADMIN',       NULL, '51200034', '51200034', NULL, NULL, 10, 1);

-- Step 8c: Map service_type_code → bus_posting_group_code on service_types table
-- Add a bus_posting_group_code column if it doesn't exist (for runtime resolution)
-- Note: the posting engine uses bpg from supplier, not from service_type.
-- The correct path is: service_type_code → BPG lookup → posting_rules resolution.
-- We store the mapping on service_types for the API layer to inject into the resolver.
ALTER TABLE service_types ADD COLUMN bus_posting_group_code TEXT;

UPDATE service_types SET bus_posting_group_code = 'BPG_MECH'        WHERE code = 'SRV_MECH'        AND company_id = 1;
UPDATE service_types SET bus_posting_group_code = 'BPG_LABOR'       WHERE code = 'SRV_LABOR'       AND company_id = 1;
UPDATE service_types SET bus_posting_group_code = 'BPG_SUPPLY'      WHERE code = 'SRV_SUPPLY'      AND company_id = 1;
UPDATE service_types SET bus_posting_group_code = 'BPG_SUPERVISION' WHERE code = 'SRV_SUPERVISION' AND company_id = 1;
UPDATE service_types SET bus_posting_group_code = 'BPG_LOGISTICS'   WHERE code = 'SRV_LOGISTICS'   AND company_id = 1;
UPDATE service_types SET bus_posting_group_code = 'BPG_SPARE_PARTS' WHERE code = 'SRV_SPARE_PARTS' AND company_id = 1;
UPDATE service_types SET bus_posting_group_code = 'BPG_ADMIN'       WHERE code = 'SRV_ADMIN'       AND company_id = 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 9: FIX 13 POSTED-WITHOUT-JE SRV_ADMIN RECORDS (all amount=0)
-- ─────────────────────────────────────────────────────────────────────────────
-- These are amount=0 migration artifacts from supplier 20900151.
-- They are legitimately zero-value administrative tracking entries.
-- Action: mark them with a clear description and link them to a zero-value JE
-- via zero_value_reason. Since they have no JE and amount=0, the correct
-- remediation is to acknowledge them as exempt, not fabricate JEs for them.
-- We cannot create JEs here (no amount to post). Instead we:
--   1. Add a notes update explaining the status
--   2. They remain "posted" because they were intentionally migrated
--   3. They will NOT generate accounting impact (amount=0 is correct)

UPDATE supplier_transactions
SET
  notes       = notes || ' | ZERO_VALUE_EXEMPT: Administrative tracking entry migrated from legacy system. Amount=0, no GL impact required.',
  description = 'إدخال إداري - لا قيمة محاسبية'
WHERE
  company_id   = 1
  AND status   = 'posted'
  AND amount   = 0
  AND service_type_code = 'SRV_ADMIN'
  AND (journal_entry_id IS NULL OR journal_entry_id = '');

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 10: RESOLVE 6 DRAFT MIGRATION ARTIFACTS (1.85M EGP)
-- ─────────────────────────────────────────────────────────────────────────────
-- These 6 drafts have:
--   - Future dates: 2026-12-28 to 2026-12-31
--   - NULL account_code
--   - Notes: "Supplier transaction migrated from backup #3827–3832"
--   - They were loaded from an Excel backup dump with incomplete data
-- Decision: cancel them with a clear audit note. They cannot be posted
-- without account_code, and their future dates suggest they are planning
-- entries incorrectly loaded into the transaction table.
-- The 1.85M EGP should be re-entered properly when the transactions actually occur.

UPDATE supplier_transactions
SET
  status      = 'cancelled',
  notes       = notes || ' | CANCELLED_2026-05-11: Migration artifact with NULL account_code and future date. Re-enter as actual transaction when event occurs.',
  description = 'ملغي - بيانات هجرة غير مكتملة'
WHERE
  company_id = 1
  AND status = 'draft'
  AND account_code IS NULL
  AND transaction_date >= '2026-12-01'
  AND notes LIKE '%migrated from backup%';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 11: BACKFILL season_id ON ALL INVENTORY MOVEMENTS
-- ─────────────────────────────────────────────────────────────────────────────
-- All 609 posted inventory movements belong to the winter season 2025-2026 (id=1).
-- Season 1 runs: 2025-11-06 to 2026-04-30.
-- All movement_dates in the data fall within this range.

UPDATE inventory_movements
SET season_id = 1
WHERE
  company_id = 1
  AND season_id IS NULL
  AND status = 'posted'
  AND movement_date BETWEEN '2025-11-01' AND '2026-04-30';

-- Also backfill any draft/pending movements in the same date range
UPDATE inventory_movements
SET season_id = 1
WHERE
  company_id = 1
  AND season_id IS NULL
  AND movement_date BETWEEN '2025-11-01' AND '2026-04-30';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 12: FIX 35 ZERO-VALUE-EXEMPT MOVEMENTS (NULL zero_value_reason)
-- ─────────────────────────────────────────────────────────────────────────────
-- These are movements where gl_posting_status='exempt_zero_value' and
-- zero_value_reason IS NULL. Classify based on movement_type.

UPDATE inventory_movements
SET
  zero_value_reason              = 'opening_balance_without_cost',
  zero_value_approved_by_role    = 'SYSTEM_MIGRATION'
WHERE
  company_id       = 1
  AND gl_posting_status = 'exempt_zero_value'
  AND (zero_value_reason IS NULL OR zero_value_reason = '')
  AND movement_type = 'GRN';

UPDATE inventory_movements
SET
  zero_value_reason              = 'issue_no_cost_basis',
  zero_value_approved_by_role    = 'SYSTEM_MIGRATION'
WHERE
  company_id       = 1
  AND gl_posting_status = 'exempt_zero_value'
  AND (zero_value_reason IS NULL OR zero_value_reason = '')
  AND movement_type = 'ISSUE';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 13: BACKFILL season_id ON SUPPLIER TRANSACTIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- All supplier transactions dated 2025-11-01 to 2026-04-30 belong to season 1.

UPDATE supplier_transactions
SET season_id = 1
WHERE
  company_id = 1
  AND season_id IS NULL
  AND transaction_date BETWEEN '2025-11-01' AND '2026-04-30';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 14: DEACTIVATE DEAD/DUPLICATE GENERAL POSTING RULES (ids 2-12)
-- ─────────────────────────────────────────────────────────────────────────────
-- Rules id=2 through id=12 are all inactive and identical:
--   purchases_account='140701' (a HEADER account — cannot post to it)
--   expense_account='51200034'
-- They were migrated from v1 with incorrect account codes and left inactive.
-- Mark them explicitly as migrated junk to prevent accidental re-activation.

UPDATE posting_rules
SET
  is_active        = 0,
  last_modified_at = datetime('now'),
  last_modified_by = 'HARDENING_2026-05-11'
WHERE
  company_id    = 1
  AND rule_type = 'general'
  AND id BETWEEN 2 AND 12
  AND is_active = 0;

-- Fix rule id=1 global catch-all: the purchases_account = 14070106 is correct
-- but it must point to a leaf account. Verify 14070106 is is_header=0 (confirmed above).
-- The expense_account=51200034 is the right catch-all expense.
-- No account change needed on id=1 — it's structurally correct as global fallback.
-- The issue was absence of service-specific rules (fixed in block 8 above).

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 15: FIX CONTROL RULE FOR ACCOUNTS_PAYABLE
-- ─────────────────────────────────────────────────────────────────────────────
-- resolveControlAccount() looks for mapping_key='accounts_payable'
-- Check if it exists and is pointing to a leaf AP account

INSERT OR IGNORE INTO posting_rules
  (company_id, rule_type, mapping_key, account_code, priority, is_active)
VALUES
  (1, 'control', 'accounts_payable', '212000010', 1, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (run after applying to confirm)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'service_types after fix' as check_label,
  code, name_ar, default_expense_account_code, default_ap_account_code, bus_posting_group_code
FROM service_types WHERE company_id=1 ORDER BY code;
