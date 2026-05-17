# Treasury / Cash Module — Audit & Full-Stack Fix Log
**Date:** 2026-05-07  
**Branch:** feature/posting-engine-v2  
**Scope:** Data layer · Backend logic · Frontend UI

---

## 1. What Was Audited

The treasury/cash module was audited end-to-end:
- `cash_transactions` table — data integrity, running-balance chain, local_id presence
- `supplier_transactions` — mirror rows, balance propagation
- `expense_types` — GL account code correctness
- `cash_transactions` → `journal_entries` linkage
- Backend: `prepareCashMovement`, `resolveCashLedger`, `treasury.ts` validation
- Frontend: `AddCashTransactionModal.tsx` — form validation, UX hints

---

## 2. Data Fixes Applied (D1 Remote)

### 2a. Running Balance Correction
- **Row 459** (`ct_legacy_459`, 2025-12-20, 53,943 EGP, supplier 20900353) had a wrong running_balance (7,725,325 instead of 7,672,382).
- Fixed by setting the correct balance on row 459; subsequent rows that were incorrectly shifted were restored.
- Final balance of the account chain: **19,801 EGP** ✓

### 2b. local_id Backfill
- All 69 real `cash_transactions` had `local_id = NULL`.
- Backfilled with format `ct_legacy_<id>` for all rows.
- Required for supplier mirror JOIN (`'st_' || ct.local_id`) to work correctly going forward.

### 2c. Expense Types GL Code Fix
| Code | Name | Old GL | New GL | Reason |
|---|---|---|---|---|
| 33067 | اشراف زراعي | 55010001 (تكلفة مبيعات بنجر) | 62010001 (مصروفات تشغيل معدات زراعية) | Wrong — was posting supervision costs as beet sales cost |
| 36008 | نقل / نولون | 51200034 (مصروفات متنوعة) | 51200024 (مقاولات نقل - مشتريات) | Too generic — now maps to specific transport account |

### 2d. Supplier Mirror Backfill — Decision NOT to Backfill
- Investigated 59 `cash_transactions` with `supplier_code` that had no `st_ct_*` mirror row.
- Found that `supplier_transactions` already contained manually-entered payment entries (`اذن صرف نقدية`) covering the same amounts — backfilling would have **tripled** those entries.
- Backfill was executed and immediately **rolled back** (59 rows deleted).
- **Conclusion:** Historical data is correctly represented in `supplier_transactions` via manual entry; the linkage via `local_id` is a forward-only feature.

---

## 3. Backend Code Fixes

### 3a. `src/lib/finance/cash_movement.ts` — Supplier Mirror Balance Propagation
**Problem (Audit item #4 — HIGH):**  
The mirror INSERT into `supplier_transactions` computed a snapshot balance from the last row globally, but never shifted subsequent rows. Any backdated payment created a broken balance chain in the supplier ledger.

**Fix:**  
- Balance anchor narrowed to `transaction_date <= ?` (not globally last row).
- Before INSERT: shift all subsequent supplier_transactions by `supDelta` via an UPDATE in the same `db.batch()`.
- Pattern now matches the same delta-propagation used in `cash_transactions` running balance.

```ts
// BEFORE: snapshot only, no propagation
const lastSupRow = await db.prepare(`... ORDER BY ... LIMIT 1`).first()

// AFTER: anchor at date, then shift subsequent rows
stmts.push(db.prepare(`
  UPDATE supplier_transactions
  SET balance_no_checks = balance_no_checks + ?,
      balance_with_checks = balance_with_checks + ?
  WHERE company_id=? AND supplier_code=?
    AND (transaction_date > ? OR (transaction_date=? AND local_id IS NOT NULL AND local_id != ?))
`).bind(supDelta, supDelta, ...))
```

### 3b. `src/lib/finance/resolvers/cash.ts` — Capital Injection Routing
**Problem:**  
Inflows linked to a `partner_id` posted to `revenue_default` control account — incorrect for capital injections (should be equity).

**Fix:**  
Resolution chain now:
1. Partner inflow (`direction='د'` + `partner_id`) → `equity_default` control account
2. Fallback: `partner_current_account` if `equity_default` not configured
3. Partner outflow → `partner_current_account` (unchanged)
4. Supplier outflow → `accounts_payable` (unchanged)
5. No-party inflow → `revenue_default` (unchanged)
6. No-party outflow → `expense_default` (unchanged)

### 3c. `src/api/treasury.ts` — Expense Code Validation
**Problem:**  
Posted outflows with no supplier and no partner had no contra account resolved — fell to `expense_default` (too generic, no audit trail).

**Fix:**  
Added validation:
```ts
if (status === 'posted' && direction === 'م' && !supplier_code && !partner_id && !expense_code) {
  return 422: 'بند المصروف مطلوب للصرف بدون مورد أو شريك'
}
```

---

## 4. Frontend Fixes

### `web/src/components/forms/AddCashTransactionModal.tsx`

| Change | Detail |
|---|---|
| Expense code required validation | Posted outflow + no supplier/partner → blocks submission, shows error in Arabic |
| Dynamic label asterisk | `بند المصروف *` shown when required, `(موصى به)` shown otherwise |
| Partner inflow note | When beneficiary = partner and direction = وارد: shows blue info box explaining capital injection → equity routing |

---

## 5. What Was NOT Fixed (Intentional Scope Freeze)

These items remain open per the Phase-Close Audit:

| # | Item | Why Not Fixed Now |
|---|---|---|
| 1 | Inventory transfer snapshot update (`movements.ts:860`) | Inventory module scope — separate session |
| 2 | Batch failure clobber (`movements.ts:1012`) | Same |
| 3 | Cash/GL desync on inventory movements | Same |
| 4 | `GET /inventory/balances` legacy view | Same |
| 5 | Historical GL entries posted to wrong accounts | Reversing 62 historical entries requires manual approval per transaction — too risky to automate |
| 6 | `posting_engine_v2.ts` dead code | Design decision needed (wire vs. delete) |
| 7 | Arabic literal fallbacks in `posting_engine.ts` | Needs coordinated frontend + backend migration |

---

## 6. Verification Queries

Run these on D1 to confirm health after fixes:

```sql
-- 1. Verify cash running balance chain is monotonically consistent
SELECT id, transaction_date, amount, direction, running_balance,
       LAG(running_balance) OVER (ORDER BY transaction_date, id) AS prev_bal,
       running_balance - LAG(running_balance) OVER (ORDER BY transaction_date, id)
         - CASE WHEN direction='د' THEN amount ELSE -amount END AS drift
FROM cash_transactions
WHERE company_id=1 AND status='posted' AND financial_account_id=1
ORDER BY transaction_date, id;
-- Expect: drift = 0 for all rows

-- 2. Verify supplier mirror rows link correctly (forward-only, post-fix)
SELECT ct.id, ct.local_id, st.local_id AS mirror_key, st.balance_no_checks
FROM cash_transactions ct
JOIN supplier_transactions st ON st.local_id = 'st_' || ct.local_id
WHERE ct.company_id=1 AND ct.supplier_code IS NOT NULL AND ct.status='posted'
ORDER BY ct.transaction_date, ct.id;

-- 3. Verify expense_types GL codes are not pointing to revenue/sales accounts
SELECT et.code, et.name, et.gl_account_code, coa.account_type
FROM expense_types et
JOIN chart_of_accounts coa ON coa.code = et.gl_account_code AND coa.company_id = et.company_id
WHERE et.company_id=1
ORDER BY et.code;
-- Expect: no expense_type should map to account_type='revenue'
```

---

*End of Treasury Audit & Fix Log.*
