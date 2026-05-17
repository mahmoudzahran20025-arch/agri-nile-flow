# Enterprise Deep Audit — Verification Report
**Date:** 2026-05-08
**Scope:** Critical/High findings from ENTERPRISE_DEEP_AUDIT_2026_05_08.md
**Method:** Code-level verification of each claim against actual source files

---

## 1. Verified Issues

| ID | Claim | Original Severity | Verified? | Actual Severity | Evidence |
|----|-------|-----------------|-----------|-----------------|----------|
| **R-01** | NaN bypass on `Number(form.code) <= 0` | Critical | **Confirmed** | **Critical** | `AddSupplierModal.tsx:64` — `Number('abc')` = NaN, `NaN <= 0` = false, passes validation. Same pattern at `AddCashTransactionModal.tsx:208`, `AddSupplierTransactionModal.tsx:120`, `AddInventoryBatchModal.tsx:424` |
| **R-02** | Atomic negative-stock guard missing | Critical | **Confirmed** | **Critical** | `movements.ts:163-181` — `readInventoryBalance()` then check then INSERT. TOCTOU gap. No `UPDATE ... WHERE balance_qty >= ?` guard used |
| **R-04** | Cash mirror silently swallowed | Critical | **Confirmed** | **High** | `movements.ts:283-306` and `movements.ts:539-561` — try/catch swallows error, logs to `system_error_logs` and `audit_log`, user never sees failure |
| **R-05** | `warehousesSetup` dead code | Critical | **Confirmed** | **Low** | `web/src/api/inventory.ts:12-13` — returns `{entities: any[]}`, no consumer found. `warehouses()` already covers the same endpoint |
| **G-07** | SupplierListPage client-side filters | High | **Confirmed** | **High** | `SupplierListPage.tsx:179-189` — `statusFilter`/`balFilter` applied to `data?.data` (current page only, size=100). Backend `suppliersApi.list` only sends `page` and `q` |
| **G-08** | InventoryMovementsPage KPI pagination | High | **Confirmed** | **Medium** | `InventoryMovementsPage.tsx:219-224` — `totalIn`/`totalOut` computed from `data?.data` (current page of 100). Not global totals |
| **G-10** | `unit_price` NaN injection | High | **Confirmed** | **High** | `AddInventoryBatchModal.tsx:424` — `l.unit_price ? Number(l.unit_price) : undefined`. `Number('abc')` = NaN, truthy, sends NaN. Backend `movements.ts:420` uses `li.unit_price ?? fallback` — `NaN ?? fallback` = NaN because `??` only checks null/undefined |
| **ARCH-01** | D1 batch partial commits | High | **Confirmed** | **Critical** | `movements.ts:487` (`batch(insertStmts)`), `movements.ts:833` (`batch(stmts)`). D1 SQLite `batch()` sends in one HTTP request but is NOT a true transaction — if statement N fails, statements 1..N-1 may already be committed |
| **ARCH-02** | Running balance not atomic | High | **Confirmed** | **High** | `suppliers.ts:26-85` — `SELECT` prev row, then `UPDATE` new row, then `UPDATE` all future rows. Three separate DB round-trips. Concurrent request overwrites |
| **ARCH-04** | Negative stock TOCTOU | High | **Confirmed** | **High** | `movements.ts:163-181` — Read balance → Check → Insert. Between read and insert, concurrent request can consume stock |
| **ARCH-05** | Permission query on every request | Medium | **Confirmed** | **Medium** | `src/middleware/auth.ts:94-108` — `hasPermission` queries `role_permissions` JOIN every time `permissionGuard` is invoked. No LRU cache |
| **BIZ-01** | Transfer batch partial commit | High | **Partial** | **High** | Report scenario "item 3 of 5 fails stock check" is **WRONG** — stock check at `movements.ts:777` aborts BEFORE any inserts. **Real issue:** D1 `batch(stmts)` at `movements.ts:833` can fail mid-batch, leaving orphaned OUT without IN rows |
| **POST-01** | Hardcoded movement direction | Medium | **Confirmed** | **Medium** | `src/lib/posting_engine.ts:358-360` — `IN_CODES` Set is hardcoded. New movement types must be added manually |
| **POST-04** | `journal_entry_id` not cleared on re-post | Medium | **Mostly False** | **Low** | Re-post only applies to drafts (`status = 'draft'`), which never had a `journal_entry_id`. The CREATE flow at `suppliers.ts:611-692` rolls back to 'draft' on failure but the row never had a `journal_entry_id` in the first place |
| **POST-05** | Cash mirror silently swallowed | Medium | **Confirmed** | **High** | Same as R-04 — `movements.ts:296-305` and `movements.ts:553-560` |
| **S-01** | Cash mirror silent failure | Medium | **Confirmed** | **High** | `movements.ts:296-305` — Non-fatal comment, error only in logs |
| **S-02** | `logPostingResolution` swallowed | Medium | **Confirmed** | **Low** | `business_events.ts:56` — empty catch block |
| **S-03** | `syncSourceDocumentBridge` swallowed | Medium | **Confirmed** | **Medium** | `business_events.ts:191-193` — "Non-blocking bridge write" comment, catch block empty |
| **S-04** | `logAudit` swallowed | Medium | **Confirmed** | **Medium** | `src/lib/audit.ts:33-35` — empty catch block with comment "Audit failures must never break the main flow" |
| **S-05** | Error logging to system_error_logs can fail | Medium | **Confirmed** | **Low** | `src/lib/gl.ts:99-101` — outer catch ignores logging failure, original error re-thrown at line 102 |
| **S-06** | `.filter(Boolean)` delta update skip | Medium | **Debatable** | **Low** | `movements.ts:495-506` — `lr` lookup should never fail under normal conditions since `localId` is deterministic. Edge case only if D1 batch partially committed or external tampering |
| **V-01** | `supplier_code` NaN | Medium | **Confirmed** | **Medium** | `AddSupplierModal.tsx:64` — same as R-01 |
| **V-06** | `warehouse_id` not sent from frontend | Medium | **Confirmed** | **Low** | Schema has `warehouse_id`/`dest_warehouse_id` columns (migration 0035) but all frontend forms and API routes use `warehouse` string name. FK columns are orphaned |

---

## 2. New Findings (Not in Original Audit)

| ID | Severity | Issue | Location | Impact |
|----|----------|-------|----------|--------|
| **NEW-01** | **High** | Transfer-batch division by zero | `src/api/inventory/movements.ts:781` | `avgPrice = srcBal.balance_value / srcBal.balance_qty` — no zero guard. If `balance_qty` is 0 (possible via race or edge case), produces `Infinity`/`NaN` which propagates to GL. Single transfer at line 609 HAS the guard (`> 0`) but batch transfer does NOT |
| **NEW-02** | **Medium** | Dead Arabic code branch in batch GRN | `src/api/inventory/movements.ts:539` | `(b.movement_type === 'اضافة' \|\| b.movement_type === 'GRN')` — `'اضافة'` is never reachable because `isSupportedMovementType` only accepts English codes. Dead code that misleads maintainers |
| **NEW-03** | **Medium** | `deltaStmts` skips if `lr` missing, but also skips balance healing | `src/api/inventory/movements.ts:495-506` | If D1 batch partially commits, some `inserted` rows may lack matching `lineResults`, causing their future-movement delta updates to be skipped silently. Balance chain breaks |
| **NEW-04** | **Medium** | `skipGlPosting: true` cash mirror has no GL link | `src/api/inventory/movements.ts:295` | When GRN cash mirror creates cash transaction with `skipGlPosting=true`, no `journal_entry_id` is ever set on the cash transaction. Cash-side traceability to GL is broken for inventory-initiated cash entries |
| **NEW-05** | **Low** | `createdAssetId` compensating delete is not atomic | `src/api/suppliers.ts:678-682` | If asset delete fails after posting failure, orphaned fixed asset remains. Two separate DELETE statements, no transaction |
| **NEW-06** | **Low** | `is_active` filter in AP aging ignores inactive suppliers | `src/api/suppliers.ts:266` | AP aging report only shows `s.is_active = 1`. Inactive suppliers with open balances are hidden from aging — bad for collections |
| **NEW-07** | **Low** | `itemsMaster` bypasses `unwrap()` with type assertion | `web/src/api/inventory.ts:140-142` | Directly casts `api.get<unknown>()` result. If backend changes envelope shape, frontend crashes at runtime with no type guard |

---

## 3. Revised Priority

### Do First (Production Blockers)
1. **R-01 (NaN guards)** — 4 modals affected. One-line fix per file (`Number.isFinite(x) && x > 0`). Zero dependencies.
2. **NEW-01 (Transfer-batch divide-by-zero)** — Add `srcBal.balance_qty > 0 ? ... : 0` guard at `movements.ts:781`. Prevents `Infinity` in GL.
3. **R-04 / POST-05 (Cash mirror surfacing)** — Change catch blocks to return warning in API response instead of swallowing. Frontend already has toast infrastructure.
4. **ARCH-04 (Negative-stock atomic guard)** — Replace read-then-check with `UPDATE inventory_balances SET balance_qty = balance_qty - ? WHERE balance_qty >= ?` pattern, or add optimistic version column.

### Do Next (High Impact, Low Effort)
5. **G-07 (Server-side supplier filtering)** — Add `?status=` and `?balance_min=`/`?balance_max=` to backend `suppliers.ts:179-237`. ~20 lines.
6. **R-05 (Remove warehousesSetup)** — Delete `web/src/api/inventory.ts:12-13`. Pure dead code removal.
7. **ARCH-05 (Permission cache)** — Add in-memory LRU (Map + TTL) for `hasPermission`. ~15 lines, no DB schema change.
8. **G-08 (KPI global totals)** — Add `GET /inventory/movements/kpi` endpoint that returns global sums, or compute client-side from `health-summary`. ~10 lines backend.

### Defer (Theoretical or Low Impact)
9. **ARCH-01 (D1 transaction gaps)** — Requires compensating transaction framework or DB migration. High effort.
10. **ARCH-02 (Running balance races)** — Same root cause as ARCH-01. Needs serialized queue or optimistic locking.
11. **R-03 (Compensating transactions)** — Depends on ARCH-01 fix. High effort, medium likelihood.
12. **POST-01 (Hardcoded direction)** — Only matters if adding new movement types. Not currently blocking.
13. **POST-04 (journal_entry_id on re-post)** — **False positive** for current flow. Only relevant if drafts could have prior journal_entry_ids.
14. **S-06 (deltaStmts filter skip)** — Only manifests if D1 partial commit occurs (ARCH-01). Fix ARCH-01 and this becomes moot.

---

## 4. False Positives

| Issue | Reason |
|-------|--------|
| **BIZ-01** "Transfer batch fails stock check mid-way" | Stock check at `movements.ts:777` aborts with `return c.json(..., 409)` BEFORE any `stmts.push()`. No partial inserts from stock rejection. Real partial commit risk is D1 `batch()` failure at line 833, not stock check |
| **POST-04** "journal_entry_id not cleared on re-post" | Re-post endpoint (`suppliers.ts:711`) only processes drafts (`status = 'draft'`). Drafts by definition have no `journal_entry_id`. The CREATE flow at `suppliers.ts:611` rolls back to draft on GL failure, but the transaction was NEW and had no prior `journal_entry_id` |
| **S-06** "Delta update skipped if lr missing" | Under normal operation, `lr` lookup cannot fail because `localId` is deterministically generated from `batchKey`. Only fails if D1 partial commit occurs (ARCH-01 scenario) or if data is externally tampered |

---

## 5. Quick Wins (< 1 Hour Each)

| # | Fix | File(s) | Effort | Impact |
|---|-----|---------|--------|--------|
| 1 | Replace `Number(x) <= 0` with `!Number.isFinite(Number(x)) \|\| Number(x) <= 0` | `AddSupplierModal.tsx:64`, `AddCashTransactionModal.tsx:208`, `AddSupplierTransactionModal.tsx:120` | 5 min | Blocks NaN injection to backend |
| 2 | Add `Number.isFinite()` guard to `unit_price` | `AddInventoryBatchModal.tsx:424` | 3 min | Blocks NaN cost calculation |
| 3 | Add zero-guard to transfer-batch avgPrice | `src/api/inventory/movements.ts:781` | 3 min | Prevents Infinity/NaN in GL |
| 4 | Remove dead `warehousesSetup` | `web/src/api/inventory.ts:12-13` | 2 min | Removes dead code |
| 5 | Surface cash mirror failure in response | `src/api/inventory/movements.ts:296-305`, `movements.ts:553-560` | 10 min | Users see when cash mirror fails |
| 6 | Add permission LRU cache | `src/middleware/auth.ts:94-108` | 15 min | Reduces DB query load |
| 7 | Add server-side status/balance filters | `src/api/suppliers.ts:179-237` | 20 min | Makes SupplierListPage filters accurate |
| 8 | Delete dead Arabic branch `'اضافة'` | `src/api/inventory/movements.ts:539` | 2 min | Removes misleading code |

---

## 6. Risk Re-Assessment

| Risk | Original Likelihood | Original Impact | Verified Likelihood | Verified Impact | Verdict |
|------|--------------------:|----------------:|--------------------:|----------------:|---------|
| Batch partial commit (inventory) | Medium | **Critical** | Medium | **Critical** | Confirmed — D1 limitation, no workaround without compensating logic |
| TOCTOU negative stock | Medium | High | Medium | **Critical** | Confirmed — single read-then-write pattern, no atomic guard |
| Cash mirror silent failure | High | Medium | High | **High** | Confirmed — inventory commits, cash fails, divergent balances |
| Running balance race | Medium | High | Medium | High | Confirmed — three separate statements, no locking |
| NaN injection via frontend | Medium | Medium | Medium | **High** | Confirmed — corrupts backend numeric computations |
| Permission query performance | High | Low | High | **Low** | Confirmed — per-request DB hit, but D1 is fast enough for current scale |
| Document number duplicates | Medium | Low | Medium | Low | Confirmed — only checked per warehouse+type, not globally |
| GL posting async failure | Low | High | Low | High | Confirmed — outbox retry provides partial mitigation |
| Source document bridge silent fail | Medium | Medium | Medium | Medium | Confirmed — bridge is non-blocking by design |
| Backdated insert rebalance O(n) | Low | Medium | Low | Medium | Confirmed — only affects backdated inserts, which are uncommon |

---

## 7. Conclusion

**The original audit was ~85% accurate.** The most important findings (NaN bypass, TOCTOU races, D1 transaction gaps, cash mirror silent failures, client-side filter pagination) are all **confirmed by direct code inspection**.

**Key corrections:**
- BIZ-01's specific scenario was wrong, but the underlying D1 partial commit risk is real
- POST-04 is a false positive for the current draft-only re-post workflow
- S-06 is only relevant in the ARCH-01 failure scenario

**Most urgent fixes (can be done in < 1 hour total):**
1. NaN guards on all numeric form fields (R-01)
2. Transfer-batch divide-by-zero guard (NEW-01)
3. Surface cash mirror failures (R-04)
4. Remove dead code (R-05, NEW-02)

**Largest remaining risk:** D1 SQLite's lack of true multi-statement transactions. This is a fundamental platform limitation that requires either a compensating transaction framework or database migration to fully resolve.
