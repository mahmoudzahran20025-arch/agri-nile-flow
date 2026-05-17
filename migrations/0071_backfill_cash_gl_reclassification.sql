-- =============================================================================
-- Migration 0071: Backfill GL Reclassification — Cash Transactions
-- Date: 2026-05-02
-- =============================================================================
-- 62 cash_transactions were posted to 51200034 (مصروفات متنوعة) catch-all
-- because they carried no expense_code at import time.
-- Narration text makes classification unambiguous — reclassify here.
--
-- Method: CORRECTING JOURNAL ENTRIES (not direct UPDATE — blocked by trigger
--         trg_gl_prevent_posted_line_update on posted entries).
--
--   Correcting entry = Dr correct account / Cr 51200034
--   This nets to zero on 51200034 and records the correct account.
--   Standard accepted practice for same-period corrections.
--
-- Reclassification map:
--   اسمدة ومبيدات / مشتريات اسمدة / مشتريات خل  → 45010001 (16,756,755 EGP)
--   العمالة                                       → 51010001 (46,975 EGP)
--   ميكنة / لاب توب / قطع غيار / سولار            → 51200034 (already correct)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECTING ENTRY 1: Fertilizers/pesticides → COGS (45010001)
-- Dr 45010001 تكلفة المبيعات   16,756,755
-- Cr 51200034 مصروفات متنوعة  16,756,755
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO journal_entries (
  company_id, entry_date, description, is_posted, ref_type, created_at
)
VALUES (
  1,
  '2026-05-02',
  'تصحيح-0071-اسمدة',
  1,
  'manual',
  CURRENT_TIMESTAMP
);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, season_id)
SELECT
  (SELECT id FROM journal_entries WHERE company_id = 1 AND description = 'تصحيح-0071-اسمدة'),
  1,
  '45010001',
  ROUND(SUM(jl.debit), 2),
  0,
  'تصحيح: مشتريات اسمدة ومبيدات وخل',
  MAX(jl.season_id)
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
JOIN cash_transactions ct ON ct.journal_entry_id = jl.entry_id AND ct.company_id = jl.company_id
WHERE jl.company_id = 1
  AND jl.account_code = '51200034'
  AND je.is_posted = 1
  AND ct.expense_code IS NULL
  AND ct.direction = 'م'
  AND (
    ct.narration LIKE '%اسمدة ومبيدات%'
    OR ct.narration LIKE '%مشتريات اسمدة%'
    OR ct.narration LIKE '%مشتريات خل%'
  );

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, season_id)
SELECT
  (SELECT id FROM journal_entries WHERE company_id = 1 AND description = 'تصحيح-0071-اسمدة'),
  1,
  '51200034',
  0,
  ROUND(SUM(jl.debit), 2),
  'تصحيح مقابل: إلغاء تصنيف مصروفات متنوعة — اسمدة',
  MAX(jl.season_id)
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
JOIN cash_transactions ct ON ct.journal_entry_id = jl.entry_id AND ct.company_id = jl.company_id
WHERE jl.company_id = 1
  AND jl.account_code = '51200034'
  AND je.is_posted = 1
  AND ct.expense_code IS NULL
  AND ct.direction = 'م'
  AND (
    ct.narration LIKE '%اسمدة ومبيدات%'
    OR ct.narration LIKE '%مشتريات اسمدة%'
    OR ct.narration LIKE '%مشتريات خل%'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECTING ENTRY 2: Labor → Wages (51010001)
-- Dr 51010001 الأجور والمرتبات  46,975
-- Cr 51200034 مصروفات متنوعة   46,975
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO journal_entries (
  company_id, entry_date, description, is_posted, ref_type, created_at
)
VALUES (
  1,
  '2026-05-02',
  'تصحيح-0071-عمالة',
  1,
  'manual',
  CURRENT_TIMESTAMP
);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, season_id)
SELECT
  (SELECT id FROM journal_entries WHERE company_id = 1 AND description = 'تصحيح-0071-عمالة'),
  1,
  '51010001',
  ROUND(SUM(jl.debit), 2),
  0,
  'تصحيح: أجور ومرتبات — عمالة زراعية',
  MAX(jl.season_id)
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
JOIN cash_transactions ct ON ct.journal_entry_id = jl.entry_id AND ct.company_id = jl.company_id
WHERE jl.company_id = 1
  AND jl.account_code = '51200034'
  AND je.is_posted = 1
  AND ct.expense_code IS NULL
  AND ct.direction = 'م'
  AND ct.narration LIKE '%العمالة%';

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, season_id)
SELECT
  (SELECT id FROM journal_entries WHERE company_id = 1 AND description = 'تصحيح-0071-عمالة'),
  1,
  '51200034',
  0,
  ROUND(SUM(jl.debit), 2),
  'تصحيح مقابل: إلغاء تصنيف مصروفات متنوعة — عمالة',
  MAX(jl.season_id)
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
JOIN cash_transactions ct ON ct.journal_entry_id = jl.entry_id AND ct.company_id = jl.company_id
WHERE jl.company_id = 1
  AND jl.account_code = '51200034'
  AND je.is_posted = 1
  AND ct.expense_code IS NULL
  AND ct.direction = 'م'
  AND ct.narration LIKE '%العمالة%';

-- ─────────────────────────────────────────────────────────────────────────────
-- Update cash_transactions.expense_code for forward traceability
-- (no trigger on this table — plain UPDATE is safe)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE cash_transactions
SET expense_code = 35001
WHERE company_id = 1
  AND expense_code IS NULL
  AND direction = 'م'
  AND status = 'posted'
  AND (
    narration LIKE '%اسمدة ومبيدات%'
    OR narration LIKE '%مشتريات اسمدة%'
    OR narration LIKE '%مشتريات خل%'
  );

UPDATE cash_transactions
SET expense_code = 36014
WHERE company_id = 1
  AND expense_code IS NULL
  AND direction = 'م'
  AND status = 'posted'
  AND narration LIKE '%العمالة%';

-- =============================================================================
-- VERIFICATION:
-- SELECT account_code, SUM(debit) AS dr, SUM(credit) AS cr
-- FROM journal_entry_lines WHERE company_id=1
-- AND account_code IN ('51200034','45010001','51010001')
-- GROUP BY account_code;
-- Expected: 45010001 debit +16.7M, 51010001 debit +46,975
--           51200034 credit +16.8M (correcting entries net it down)
-- =============================================================================
