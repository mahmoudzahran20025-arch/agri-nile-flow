-- =============================================================================
-- SEED_minimal_posting_setup.sql
-- =============================================================================
-- Optional: Creates a minimal "catch-all" posting setup for company 1.
-- These are NULL/NULL rows that act as the DEFAULT rule — any entity without
-- an explicit posting group will fall back to these rows.
--
-- USAGE (from project root):
--   npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=migrations/SEED_minimal_posting_setup.sql
--
-- SAFE TO RUN MULTIPLE TIMES — all INSERTs use INSERT OR IGNORE.
-- Replace account codes below with your actual Chart of Accounts codes.
-- =============================================================================

-- ── Step 1: Create the three group types (optional convenience groups) ────────

INSERT OR IGNORE INTO business_posting_groups (company_id, code, name, description, is_active, created_at)
VALUES
  (1, 'DOMESTIC',  'محلي - موردون ومبيعات داخلية', 'للموردين والعملاء المحليين', 1, datetime('now')),
  (1, 'IMPORT',    'مستورد - توريد خارجي',           'للموردين والمشتريات المستوردة', 1, datetime('now'));

INSERT OR IGNORE INTO product_posting_groups (company_id, code, name, description, is_active, created_at)
VALUES
  (1, 'AGRI_INPUT', 'مدخلات زراعية',   'أسمدة، بذور، مبيدات', 1, datetime('now')),
  (1, 'AGRI_OUT',   'منتجات زراعية',   'محاصيل وإنتاج المزرعة', 1, datetime('now'));

INSERT OR IGNORE INTO inventory_posting_groups (company_id, code, name, description, is_active, created_at)
VALUES
  (1, 'MAIN_STORE', 'المستودع الرئيسي', 'مخزون المستودع الرئيسي للمزرعة', 1, datetime('now'));

-- ── Step 2: Catch-all General Posting Setup (NULL × NULL) ─────────────────────
-- Replace account codes with your actual CoA codes before running.
-- This row is the REQUIRED fallback. Without it, unassigned entities will be blocked.

INSERT OR IGNORE INTO general_posting_setup
  (company_id, bus_posting_group_code, prod_posting_group_code,
   sales_account, purchases_account, cogs_account,
   sales_returns_account, purch_returns_account, expense_account,
   is_active, created_at)
VALUES
  (
    1,
    NULL,                -- BPG = DEFAULT (catches all suppliers/customers)
    NULL,                -- PPG = DEFAULT (catches all items)
    '41010001',          -- حساب المبيعات / Revenue → replace with your code
    '45010001',          -- حساب المشتريات / Purchases → replace with your code
    '45010001',          -- تكلفة البضاعة / COGS → replace with your code
    NULL,                -- مردودات المبيعات → set when needed
    NULL,                -- مردودات المشتريات → set when needed
    '51200034',          -- المصروفات العامة / General Expenses → replace with your code
    1,
    datetime('now')
  );

-- ── Step 3: Catch-all Inventory Posting Setup (NULL × NULL) ───────────────────

INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code,
   inventory_account, is_active, created_at)
VALUES
  (
    1,
    NULL,       -- IPG = DEFAULT (catches all warehouses)
    NULL,       -- PPG = DEFAULT (catches all items)
    '140701',   -- حساب المخزون / Inventory Asset → replace with your code
    1,
    datetime('now')
  );

-- ── Verification ──────────────────────────────────────────────────────────────
-- Run after seeding to verify:
--
-- SELECT 'BPG' as type, COUNT(*) as n FROM business_posting_groups  WHERE company_id = 1
-- UNION ALL
-- SELECT 'PPG', COUNT(*) FROM product_posting_groups   WHERE company_id = 1
-- UNION ALL
-- SELECT 'IPG', COUNT(*) FROM inventory_posting_groups WHERE company_id = 1
-- UNION ALL
-- SELECT 'GPS', COUNT(*) FROM general_posting_setup    WHERE company_id = 1
-- UNION ALL
-- SELECT 'IPS', COUNT(*) FROM inventory_posting_setup  WHERE company_id = 1;
