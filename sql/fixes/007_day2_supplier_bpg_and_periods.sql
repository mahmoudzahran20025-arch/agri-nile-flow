-- =============================================================================
-- SPRINT 1 DAY 2: Supplier BPG Wiring + Monthly Financial Periods
-- Date: 2026-05-11
-- =============================================================================

-- BLOCK 1: Wire bus_posting_group_code on suppliers from primary service_type
-- Logic: JOIN supplier_service_map (is_primary=1) → service_types.bus_posting_group_code
UPDATE suppliers
SET bus_posting_group_code = (
  SELECT st.bus_posting_group_code
  FROM supplier_service_map ssm
  JOIN service_types st ON st.code = ssm.service_type_code AND st.company_id = ssm.company_id
  WHERE ssm.supplier_code = suppliers.code
    AND ssm.company_id = suppliers.company_id
    AND ssm.is_primary = 1
  LIMIT 1
)
WHERE company_id = 1
  AND bus_posting_group_code IS NULL;

-- Verify: all suppliers should now have BPG
SELECT code, name, bus_posting_group_code FROM suppliers WHERE company_id=1 ORDER BY code;

-- =============================================================================
-- BLOCK 2: Monthly Financial Sub-Periods for Season 1 (2025-11 → 2026-04)
-- The annual period (id=6) covers 2025-11-01 to 2026-05-11 already.
-- Add 6 monthly sub-periods for reporting granularity.
-- =============================================================================

INSERT OR IGNORE INTO financial_periods (company_id, name, period_type, start_date, end_date, status)
VALUES
  (1, 'نوفمبر 2025',  'monthly', '2025-11-01', '2025-11-30', 'closed'),
  (1, 'ديسمبر 2025',  'monthly', '2025-12-01', '2025-12-31', 'closed'),
  (1, 'يناير 2026',   'monthly', '2026-01-01', '2026-01-31', 'closed'),
  (1, 'فبراير 2026',  'monthly', '2026-02-01', '2026-02-28', 'closed'),
  (1, 'مارس 2026',    'monthly', '2026-03-01', '2026-03-31', 'closed'),
  (1, 'ابريل 2026',   'monthly', '2026-04-01', '2026-04-30', 'closed'),
  (1, 'مايو 2026',    'monthly', '2026-05-01', '2026-05-31', 'open');

-- Verify periods
SELECT id, name, start_date, end_date, status FROM financial_periods WHERE company_id=1 ORDER BY start_date;

-- =============================================================================
-- BLOCK 3: Add missing CASH_INCOME operation key to posting_operation_matrix
-- business_events.ts maps 'cash_receipt' → 'CASH_INCOME' but no matrix row exists.
-- =============================================================================

INSERT OR IGNORE INTO posting_operation_matrix
  (company_id, operation_key, source_module, debit_role, credit_role, description, is_active)
VALUES
  (1, 'CASH_INCOME', 'cash', 'cash', 'revenue', 'قبض نقدي - إيراد', 1);

-- Verify matrix coverage
SELECT operation_key, source_module, debit_role, credit_role
FROM posting_operation_matrix WHERE company_id=1 ORDER BY operation_key;
