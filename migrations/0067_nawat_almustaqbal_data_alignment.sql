-- ============================================================
-- Migration 0067: نواة المستقبل — Data Alignment
-- Purpose:
--   1. Fix cost_centers names to match real pivot names from JSON
--   2. Add `description` column to supplier_transactions (non-breaking)
--   3. Populate expense_code_to_coa for crop account 3025 (بنجر السكر)
--   4. Align supplier bus_posting_group_code for GL auto-posting
--   5. Seed missing posting_rules for supplier transactions → GL
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- STEP 1: Fix cost_centers names to match real pivot data
-- Source: نواة_المستقبل_2025-2026.json → الأكواد_المرجعية.البيفوتات_أنظمة_الري
-- ──────────────────────────────────────────────────────────────
UPDATE cost_centers SET name_ar = 'بيفوت رقم 718 بوستر129',  name_en = 'Pivot 718 Booster-129'  WHERE company_id=1 AND code='1006001';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 719 بوستر129',  name_en = 'Pivot 719 Booster-129'  WHERE company_id=1 AND code='1006002';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 720 بوستر129',  name_en = 'Pivot 720 Booster-129'  WHERE company_id=1 AND code='1006003';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 722 بوستر129',  name_en = 'Pivot 722 Booster-129'  WHERE company_id=1 AND code='1006004';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 723 بوستر129',  name_en = 'Pivot 723 Booster-129'  WHERE company_id=1 AND code='1006005';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 1044 بوستر128', name_en = 'Pivot 1044 Booster-128' WHERE company_id=1 AND code='1006006';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 1047 بوستر128', name_en = 'Pivot 1047 Booster-128' WHERE company_id=1 AND code='1006007';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 1048 بوستر128', name_en = 'Pivot 1048 Booster-128' WHERE company_id=1 AND code='1006008';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 1049 بوستر128', name_en = 'Pivot 1049 Booster-128' WHERE company_id=1 AND code='1006009';
UPDATE cost_centers SET name_ar = 'بيفوت رقم 1050 بوستر128', name_en = 'Pivot 1050 Booster-128' WHERE company_id=1 AND code='1006010';
UPDATE cost_centers SET name_ar = 'إدارية أرض الدلتا الجديدة', name_en = 'Admin - New Delta Land' WHERE company_id=1 AND code='1006011';

-- ──────────────────────────────────────────────────────────────
-- STEP 2: Add `description` column to supplier_transactions
-- Maps to "البيان" field in نواة_المستقبل JSON
-- Nullable, default NULL — completely non-breaking
-- ──────────────────────────────────────────────────────────────
ALTER TABLE supplier_transactions ADD COLUMN description TEXT DEFAULT NULL;

-- ──────────────────────────────────────────────────────────────
-- STEP 3: Populate expense_code_to_coa for company_id=1
-- Maps account_code 3025 (بنجر السكر) to GL accounts
-- Expense categories: ميكنة → 5102 (mechanization), عمالة → 5101 (labor)
-- Payable side handled by business_posting_groups (CR: supplier payable)
-- ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO expense_code_to_coa
  (company_id, expense_code, expense_name_ar, expense_category, coa_account, coa_account_name, cost_center_required, is_active, notes)
VALUES
  -- بنجر السكر / ميكنة (mechanization rent) → expense: machinery costs
  (1, '3025_MIKANAH',  'ميكنة بنجر السكر',        'ميكنة',  '55010001', 'تكلفة مبيعات بنجر',   1, 1, 'account_code=3025 expense=ميكنة'),
  -- بنجر السكر / عمالة (labor)  → expense: labor
  (1, '3025_AMALAH',   'عمالة بنجر السكر',         'عمالة',  '5101',     'العمالة',               1, 1, 'account_code=3025 expense=عمالة'),
  -- بنجر السكر / generic (seeds, services, etc.)
  (1, '3025_GENERAL',  'مصاريف عامة بنجر السكر',   null,     '55010001', 'تكلفة مبيعات بنجر',   0, 1, 'account_code=3025 general');

-- ──────────────────────────────────────────────────────────────
-- STEP 4: Set bus_posting_group_code on suppliers
-- Using existing codes: AGRI-OP, LABOR, LOCAL, CUSTOMER
-- ──────────────────────────────────────────────────────────────

-- Machinery & equipment suppliers → AGRI-OP (agricultural operations)
UPDATE suppliers SET bus_posting_group_code = 'AGRI-OP' WHERE company_id=1 AND code IN (20300086, 20100033, 20300121);
-- Agricultural product suppliers → AGRI-OP
UPDATE suppliers SET bus_posting_group_code = 'AGRI-OP' WHERE company_id=1 AND code IN (20900151, 20900353);
-- Labor suppliers → LABOR
UPDATE suppliers SET bus_posting_group_code = 'LABOR'   WHERE company_id=1 AND code IN (21400002, 21400108);
-- Misc suppliers → LOCAL
UPDATE suppliers SET bus_posting_group_code = 'LOCAL'   WHERE company_id=1 AND code IN (20800286, 35300902);
-- Cash customer → CUSTOMER
UPDATE suppliers SET bus_posting_group_code = 'CUSTOMER' WHERE company_id=1 AND code = 10100192;

-- ──────────────────────────────────────────────────────────────
-- STEP 5: Seed posting_rules for supplier transaction GL entries
-- rule_type='purchase': purchases_account = CR payable, expense_account = DR expense
-- ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO posting_rules
  (company_id, rule_type, bus_posting_group_code, mapping_key, purchases_account, expense_account, is_active)
VALUES
  -- ميكنة (machinery) → DR تكلفة مبيعات بنجر (55010001) CR دائن مورد آلات (212000013)
  (1, 'purchase', 'AGRI-OP', 'AGRI-OP_MIKANAH',  '212000013', '55010001', 1),
  -- عمالة (labor)    → DR العمالة (5101) CR دائن مورد عمالة (212000017)
  (1, 'purchase', 'LABOR',   'LABOR_AMALAH',      '212000017', '5101',     1),
  -- نقدي/متنوع     → DR تكلفة (55010001) CR دائن متنوعون (212000010)
  (1, 'purchase', 'LOCAL',   'LOCAL_GENERAL',     '212000010', '55010001', 1);
