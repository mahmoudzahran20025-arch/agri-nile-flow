-- ============================================================
-- Migration 0099: Season ID Backfill — supplier_transactions
-- Problem: All 313 posted supplier_transactions have season_id=NULL.
-- Coverage audit (2026-05-10):
--   307 rows → الموسم الشتوي 2025-2026 (id=1, 2025-11-06 to 2026-04-30)
--   0 rows   → الموسم الصيفي 2026     (id=2, 2026-05-01 to 2026-10-31)
--   6 rows   → outside all seasons    (2026-12-28 to 2026-12-31, supplier 20900353)
--              → logged to system_error_logs, assigned closest season by proximity
-- ============================================================

-- ── Step 1: Backfill winter season (id=1) ─────────────────────
UPDATE supplier_transactions
SET season_id = 1
WHERE company_id = 1
  AND status = 'posted'
  AND season_id IS NULL
  AND transaction_date >= '2025-11-06'
  AND transaction_date <= '2026-04-30';

-- ── Step 2: Backfill summer season (id=2) ─────────────────────
-- (0 rows currently, but kept for correctness if new data arrives)
UPDATE supplier_transactions
SET season_id = 2
WHERE company_id = 1
  AND status = 'posted'
  AND season_id IS NULL
  AND transaction_date >= '2026-05-01'
  AND transaction_date <= '2026-10-31';

-- ── Step 3: Log the 6 out-of-range rows before forcing assignment ──
-- IDs 3827-3832 (supplier 20900353, Dec 2026) — no season covers them.
-- They are future-dated contracts that were posted before the season was created.
-- Governance decision: assign to summer season (id=2) as closest end-boundary,
-- and log the anomaly for Finance review.
INSERT INTO system_error_logs
  (company_id, user_id, endpoint, method, error_message, stack_trace, request_payload, created_at)
VALUES
  (1, 1,
   'FINANCIAL_WORKFLOW:season_backfill',
   'MIGRATION_0099',
   '6 posted supplier_transactions (ids 3827-3832, supplier 20900353) have transaction_date in Dec 2026 which falls outside all configured seasons. Assigned to season_id=2 (الموسم الصيفي 2026) as closest by end boundary. Finance must confirm or extend season end_date.',
   'Migration 0099 governance log. Dates: 2026-12-28 and 2026-12-31. Total value: 1,850,000 EGP (credit only). No debit rows affected.',
   '{"migration":"0099","anomaly":"out_of_season_transactions","supplier_code":20900353,"record_ids":[3827,3828,3829,3830,3831,3832],"transaction_dates":["2026-12-28","2026-12-31"],"total_credit":1850000,"assigned_season_id":2,"action":"assigned_to_nearest_season"}',
   datetime('now'));

-- ── Step 4: Force-assign remaining NULL rows to nearest season ──
-- These are the 6 Dec-2026 rows assigned to summer season as closest boundary.
UPDATE supplier_transactions
SET season_id = 2
WHERE company_id = 1
  AND status = 'posted'
  AND season_id IS NULL;

-- ── Verification query (run manually after apply to confirm 0 NULLs) ──
-- SELECT COUNT(*) AS remaining_nulls
-- FROM supplier_transactions
-- WHERE company_id = 1 AND status = 'posted' AND season_id IS NULL;
-- Expected: 0
