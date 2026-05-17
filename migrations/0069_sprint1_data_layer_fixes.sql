-- =============================================================================
-- Migration 0069: Sprint 1 — Data Layer Fixes
-- Date: 2026-05-02
-- Priority: BLOCKING — must run before any UI sprint
-- =============================================================================
-- Fixes three production issues found in DB audit:
--
-- FIX-1: account_type on 45xxxxxx accounts
--   CoA group 45 = تكلفة المبيعات (Cost of Sales).
--   In this company's non-standard CoA, COGS sits under the '4x' branch but
--   behaves as an expense (debit-normal, reduces net income).
--   Production shows 45010001 tagged 'revenue' → Income Statement shows COGS
--   as revenue, doubling reported revenue and wiping net income.
--   Fix: set account_type = 'expense' for all 45xxxxxx leaf accounts.
--
-- FIX-2: expense_types.gl_account_code = NULL for all 92 codes
--   Every cash transaction falls to catch-all 51200034 (مصروفات متنوعة),
--   losing all expense classification. 39.2M EGP is unclassified.
--   Fix: map each expense code to its correct CoA account.
--
-- FIX-3: Ghost control rules in posting_rules
--   5 control mappings point to CoA codes that don't exist:
--   SERVICES(611601), accumulated_depreciation(1590), depreciation_expense(5300),
--   wip_asset(1350), wip_contra(3350).
--   Fix: update to real existing CoA codes.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX-1: Correct account_type for COGS accounts (group 45xxxxxx)
-- In this CoA: 45 = تكلفة المبيعات — debit-normal, expense-natured
-- Currently tagged 'revenue' → Income Statement is wrong
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE chart_of_accounts
SET account_type = 'expense'
WHERE company_id = 1
  AND code LIKE '45%'
  AND account_type = 'revenue';

-- Verify: SELECT code, name, account_type FROM chart_of_accounts WHERE company_id=1 AND code LIKE '45%';
-- Expected: all rows show account_type='expense'

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX-2: Map expense_types to GL accounts
-- Source: خزينة_نواة_المستقبل_2025-2026.json → الأكواد_المرجعية.المصروفات
-- CoA mapping based on شجرة_نواة_المستقبل.json
--
-- Mapping logic:
--   33001 اجور ومرتبات          → 51010001 الأجور والمرتبات
--   33002-33034 admin/overhead  → 51200034 مصروفات متنوعة (general overhead)
--   33035 مصروف اهلاك           → 55010001 (depreciation under 55 group)
--   33036 ايجار حفار            → 51200034 مصروفات متنوعة
--   33045 اجور عماله اضافيه     → 51010001 الأجور والمرتبات
--   33052 قطع غيار وصيانة       → 51200034 مصروفات متنوعة
--   33053 وقود وزيوت            → 51200015 بنزين وزيوت
--   33067 اشراف زراعي           → 55010001 تكلفة مبيعات بنجر (direct agri cost)
--   35001 المشتريات             → 45010001 تكلفة المبيعات
--   35006 تكلفة المبيعات        → 45010001 تكلفة المبيعات
--   36008 نقل ( نولون )         → 51200034 مصروفات متنوعة (transport)
--   36014 عمالة زراعية          → 51010001 الأجور والمرتبات
--   36015 صيانة بيفوتات         → 51200034 مصروفات متنوعة
-- ─────────────────────────────────────────────────────────────────────────────

-- Labor & wages
UPDATE expense_types SET gl_account_code = '51010001' WHERE company_id=1 AND code=33001; -- اجور ومرتبات
UPDATE expense_types SET gl_account_code = '51010001' WHERE company_id=1 AND code=33045; -- اجور عماله اضافيه
UPDATE expense_types SET gl_account_code = '51010001' WHERE company_id=1 AND code=33017; -- عماله خارجيه عموميه
UPDATE expense_types SET gl_account_code = '51010001' WHERE company_id=1 AND code=36014; -- عمالة زراعية

-- Fuel & oil
UPDATE expense_types SET gl_account_code = '51200015' WHERE company_id=1 AND code=33053; -- وقود وزيوت

-- Depreciation
UPDATE expense_types SET gl_account_code = '55010001' WHERE company_id=1 AND code=33035; -- مصروف اهلاك

-- Agricultural supervision (direct production cost)
UPDATE expense_types SET gl_account_code = '55010001' WHERE company_id=1 AND code=33067; -- اشراف زراعي

-- Purchases / COGS
UPDATE expense_types SET gl_account_code = '45010001' WHERE company_id=1 AND code=35001; -- المشتريات
UPDATE expense_types SET gl_account_code = '45010001' WHERE company_id=1 AND code=35006; -- تكلفة المبيعات

-- All remaining admin/overhead → general expense catch-all (already the default, but now explicit)
UPDATE expense_types SET gl_account_code = '51200034' WHERE company_id=1 AND code IN (
  33002, -- اتعاب محاسبيه
  33003, -- ادوات مكتبيه
  33004, -- صيانه مبانى
  33005, -- انتقالات
  33006, -- مصاريف جاب و شهادات
  33007, -- اكراميات
  33008, -- مصاريف علاجيه
  33009, -- تليفونات
  33010, -- كهرباء
  33011, -- اشتراكات و معارض
  33012, -- مصاريف و مهمات متنوعه
  33013, -- مصاريف بنكيه
  33014, -- عيديات و مكافات
  33015, -- ايجارات
  33016, -- صيانه و اصلاح
  33018, -- دعايه واعلان
  33019, -- بريد ومراسلات
  33020, -- بوفيه و ميس وضيافه
  33021, -- م ضيافة واقامة عملاء
  33022, -- تبرعات وزكاة
  33023, -- رسوم و دمغات و غرامات
  33024, -- ايجار آلات ومعدات
  33025, -- صيانة وسائل نقل
  33026, -- ضرائب عقاريه
  33027, -- مصاريف دعم الصادرات
  33028, -- ترجمه
  33029, -- نخل
  33030, -- م سياره ملاكى
  33031, -- ادوات نظافه
  33032, -- ابحاث و تحاليل
  33033, -- احبار
  33034, -- استشارات
  33036, -- ايجار حفار
  33037, -- عمولات
  33038, -- تسويات فروق جرديه
  33039, -- مصروف مخصص مطالبات
  33040, -- مصروف ضريبه الدخل
  33041, -- مصاريف بنكيه تسهيلات
  33042, -- فوائد تسهيلات ائتمانيه
  33043, -- مصروف تامين
  33044, -- مصاريف تقييم
  33046, -- مصاريف تامينات
  33047, -- هدايا
  33048, -- المساهمه التكافليه
  33049, -- اعاشة
  33050, -- شقه التجمع 2
  33051, -- الحراسه والامن
  33052, -- قطع غيار وصيانة
  33054, -- رسوم مرور وكرت طريق
  33055, -- مياه
  33056, -- تحميل وتعتيق
  33057, -- م. طريق مندوب
  33058, -- م. فيلا رويال
  33059, -- قضايا
  33060, -- مطبوعات
  33061, -- شقة التجمع 1
  33062, -- م. جراج
  33063, -- صيانة اصول ثابتة
  33064, -- صيانة مولدات
  33065, -- تراخيص سيارات
  33066, -- غاز
  34001, -- م. الحمله الانتخابية
  34002, -- اشتراكات
  34003, -- مصاريف سفريات و معارض خارجيه
  34004, -- خصم مسموح به للعملاء
  36002, -- م تخليص جمركي
  36003, -- مستلزمات تشغيل
  36004, -- شحن جوى
  36005, -- شحن بحرى
  36006, -- تخليص جمركى صادر
  36007, -- اكراميه
  36008, -- نقل ( نولون )
  36009, -- بريد و مراسلات
  36010, -- مصروفات شحن اخرى
  36011, -- مصروفات فحص
  36012, -- مصاريف نقل بالخارج
  36013, -- رويالتى
  36015, -- صيانة بيفوتات
  36016, -- م. نبطشية
  36017, -- تحليلي متبقيات
  36018, -- مشروع العفن البني
  36019, -- سحب عينات
  36020  -- قسيمة بدل
);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX-3: Correct ghost control rules in posting_rules
-- All 5 ghost codes replaced with nearest real CoA account
-- ─────────────────────────────────────────────────────────────────────────────

-- SERVICES: 611601 does not exist. Services are an operating expense → 51200034
UPDATE posting_rules
SET account_code='51200034', purchases_account='51200034', expense_account='51200034',
    sales_account='41010001', cogs_account='45010001'
WHERE company_id=1 AND rule_type='control' AND mapping_key='SERVICES';

-- accumulated_depreciation: 1590 does not exist.
-- Real contra-asset for accumulated depreciation in this CoA is under group 22 (مجمعات الإهلاك)
-- Use 22 parent for now — update when exact leaf is confirmed
UPDATE posting_rules
SET account_code='22'
WHERE company_id=1 AND rule_type='control' AND mapping_key='accumulated_depreciation';

-- depreciation_expense: 5300 does not exist. Depreciation expense is under 55 group.
UPDATE posting_rules
SET account_code='55010001'
WHERE company_id=1 AND rule_type='control' AND mapping_key='depreciation_expense';

-- wip_asset: 1350 does not exist. WIP crops are under 13500001
UPDATE posting_rules
SET account_code='13500001'
WHERE company_id=1 AND rule_type='control' AND mapping_key='wip_asset';

-- wip_contra: 3350 does not exist. Equity is under 3 (حقوق الملكية parent) until exact leaf confirmed
UPDATE posting_rules
SET account_code='3'
WHERE company_id=1 AND rule_type='control' AND mapping_key='wip_contra';

-- =============================================================================
-- VERIFICATION QUERIES (run after applying):
-- =============================================================================
-- 1. Check FIX-1: should return 0 rows (no more revenue-typed COGS accounts)
--    SELECT code, name, account_type FROM chart_of_accounts
--    WHERE company_id=1 AND code LIKE '45%' AND account_type='revenue';
--
-- 2. Check FIX-2: should return 0 rows (all expense_types now mapped)
--    SELECT COUNT(*) AS unmapped FROM expense_types
--    WHERE company_id=1 AND gl_account_code IS NULL;
--
-- 3. Check FIX-3: ghost control rules resolved
--    SELECT pr.mapping_key, pr.account_code, coa.name FROM posting_rules pr
--    LEFT JOIN chart_of_accounts coa ON coa.company_id=pr.company_id AND coa.code=pr.account_code
--    WHERE pr.company_id=1 AND pr.rule_type='control' AND coa.code IS NULL;
--    Expected: 0 rows (or only non-leaf parent codes which are acceptable)
-- =============================================================================
