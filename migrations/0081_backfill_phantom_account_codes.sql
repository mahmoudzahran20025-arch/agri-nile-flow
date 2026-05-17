-- =============================================================================
-- Migration 0081: Backfill Phantom Account Codes in journal_entry_lines
-- Date: 2026-05-03
-- =============================================================================
-- Migration 0080 fixed posting_rules and fallback code strings in resolvers,
-- but any journal_entry_lines rows already written with the old phantom codes
-- still reference those non-existent accounts.
--
-- Phantom → Real CoA remapping (verified against شجرة_نواة_المستقبل.json):
--   2100  → 212000010  (accounts_payable: موردون متنوعون)
--   2101  → 21200001   (wages_payable: مستحقات الرواتب)
--   5100  → 51010001   (wages_expense: الأجور والمرتبات)
--   1001  → 14010101   (cash: خزينة ج.م)
--   5300  → 5503       (depreciation_expense: إهلاك آلات ومعدات)
--   1590  → 2203       (accumulated_depreciation: مجمع إهلاك آلات ومعدات)
--   1350  → 1302       (wip_asset: مشروعات تحت التنفيذ)
--   3350  → 3001       (wip_contra: رأس المال)
--   6200  → 5503       (old depreciation fallback)
--   1690  → 2203       (old accumulated depreciation fallback)
--
-- Each UPDATE is wrapped in a sub-SELECT that confirms the target code exists
-- in chart_of_accounts (safety guard — won't remap if target also missing).
-- =============================================================================

-- ── 1. Accounts Payable: 2100 → 212000010 ────────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '212000010'
WHERE account_code = '2100'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '212000010'
  );

-- ── 2. Wages Payable: 2101 → 21200001 ────────────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '21200001'
WHERE account_code = '2101'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '21200001'
  );

-- ── 3. Wages Expense: 5100 → 51010001 ────────────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '51010001'
WHERE account_code = '5100'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '51010001'
  );

-- ── 4. Cash: 1001 → 14010101 ─────────────────────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '14010101'
WHERE account_code = '1001'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '14010101'
  );

-- ── 5. Depreciation Expense: 5300 → 5503 ─────────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '5503'
WHERE account_code = '5300'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '5503'
  );

-- ── 6. Old depreciation fallback: 6200 → 5503 ────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '5503'
WHERE account_code = '6200'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '5503'
  );

-- ── 7. Accumulated Depreciation: 1590 → 2203 ─────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '2203'
WHERE account_code = '1590'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '2203'
  );

-- ── 8. Old accumulated depreciation fallback: 1690 → 2203 ────────────────────
UPDATE journal_entry_lines
SET account_code = '2203'
WHERE account_code = '1690'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '2203'
  );

-- ── 9. WIP Asset: 1350 → 1302 ────────────────────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '1302'
WHERE account_code = '1350'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '1302'
  );

-- ── 10. WIP Contra: 3350 → 3001 ──────────────────────────────────────────────
UPDATE journal_entry_lines
SET account_code = '3001'
WHERE account_code = '3350'
  AND entry_id IN (
    SELECT je.id FROM journal_entries je WHERE je.company_id = 1
  )
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '3001'
  );

-- ── VERIFICATION ──────────────────────────────────────────────────────────────
-- Run after applying: should return 0 rows if all phantoms are resolved.
-- SELECT DISTINCT jel.account_code, COUNT(*) AS cnt
-- FROM journal_entry_lines jel
-- JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = 1
-- LEFT JOIN chart_of_accounts coa ON coa.company_id = 1 AND coa.code = jel.account_code
-- WHERE coa.id IS NULL
-- GROUP BY jel.account_code;
