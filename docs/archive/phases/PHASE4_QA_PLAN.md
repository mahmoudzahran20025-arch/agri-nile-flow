# Phase 4 — QA & UAT Plan
**Date:** 2026-05-02  
**Branch:** feature/posting-engine-v2  
**Database:** agri-nile-flow-data-lake (Cloudflare D1 Remote)  
**Target:** 0 regressions, < 120ms per transaction, V1/V2 parity

---

## Live Database Baseline (Verified 2026-05-02)

| Metric | Value | Status |
|---|---|---|
| Total journal entries | 1,590 | ✅ |
| Total journal lines | 3,172 | ✅ |
| EGP lines (V1 compat) | 3,172 / 3,172 | ✅ 100% |
| Unbalanced entries | 0 | ✅ |
| Orphan lines | 0 | ✅ |
| Lines with missing account | 0 | ✅ |
| Unposted drafts | 9 | ℹ️ expected |
| V1 posting rules | 84 / 84 | ✅ 100% |
| General rules | 19 | ✅ |
| Inventory rules | 36 | ✅ |
| Control rules | 29 | ✅ |
| Chart of accounts (leaf) | 278 | ✅ |
| FX rates | 6 (EGP/USD/EUR/SAR/AED/GBP) | ✅ |
| Event types | 14 | ✅ |
| Role mappings | 14 | ✅ |
| Posting rule resolutions | 2 | ✅ |
| Business events | 581 | ✅ |

---

## Test Categories

### CAT-1: Exchange Rate Engine (Phase 2)
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 1.01 | GET /api/gl/exchange-rates (list) | company_id=1 | 6 rates returned | count=6, HTTP 200 |
| 1.02 | GET /api/gl/exchange-rates?from=USD | company_id=1, from=USD | USD rates only | all.from='USD' |
| 1.03 | GET /api/gl/exchange-rates/convert?from=USD&to=EGP&amount=100 | valid creds | 5050.00 EGP | rate=50.5×100 |
| 1.04 | GET /api/gl/exchange-rates/convert?from=EGP&to=EGP&amount=500 | valid creds | 500.00 | identity rate |
| 1.05 | GET /api/gl/exchange-rates/convert?from=EUR&to=EGP&amount=200 | valid creds | 11040.00 | rate=55.2×200 |
| 1.06 | POST /api/gl/exchange-rates (create) | company_admin, from=GBP,to=EGP,rate=64.0 | 201 Created | new row in DB |
| 1.07 | POST /api/gl/exchange-rates (update existing) | same from/to pair, new rate | 200 OK | rate updated, old preserved |
| 1.08 | POST /api/gl/exchange-rates (non-admin) | accountant role | 403 Forbidden | role guard works |
| 1.09 | GET /api/gl/exchange-rates/convert missing from | no 'from' param | 400 Bad Request | validation works |
| 1.10 | GET /api/gl/exchange-rates/:id (valid) | id=1 | 200 + single rate | correct data |
| 1.11 | GET /api/gl/exchange-rates/:id (invalid) | id=9999 | 404 | not found |
| 1.12 | Exchange rate 60s cache | same request twice | second uses cache | no extra DB hit |
| 1.13 | No auth | no Bearer token | 401 | auth guard works |

### CAT-2: Event Types Catalogue (Phase 2)
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 2.01 | GET /api/gl/event-types | valid creds | 14 types | count=14 |
| 2.02 | GET /api/gl/event-types grouped | valid creds | grouped by module | each group non-empty |
| 2.03 | GET /api/gl/event-types/modules | valid creds | distinct module list | ≥4 modules |
| 2.04 | GET /api/gl/event-types/PURCHASE_ORDER | valid creds | single type | code='PURCHASE_ORDER' |
| 2.05 | GET /api/gl/event-types/UNKNOWN | valid creds | 404 | not found |
| 2.06 | GET /api/gl/event-types/for-event/:eventType | business_event type string | resolved type | correct code returned |
| 2.07 | POST /api/gl/event-types (super_admin) | new custom type | 201 Created | persisted in DB |
| 2.08 | POST /api/gl/event-types (company_admin) | new type | 403 Forbidden | role guard |
| 2.09 | POST /api/gl/event-types duplicate code | existing code | 409 Conflict | no duplicate |
| 2.10 | No auth | no token | 401 | auth guard |

### CAT-3: Account Role Policy Engine (Phase 3)
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 3.01 | GET /api/gl/account-role-policy | valid creds | 14 mappings | count=14 |
| 3.02 | GET /api/gl/account-role-policy (active only) | ?active=1 | active only | is_active=1 all |
| 3.03 | GET /api/gl/account-role-policy/coverage | valid creds | coverage report | coverage_pct ≥ 70% |
| 3.04 | GET /api/gl/account-role-policy/resolve/CASH | valid creds | {account_code:'14010101'} | correct account |
| 3.05 | GET /api/gl/account-role-policy/resolve/BANK | valid creds | {account_code:'14010301'} | correct account |
| 3.06 | GET /api/gl/account-role-policy/resolve/AR | valid creds | {account_code:'14030001'} | AR receivable |
| 3.07 | GET /api/gl/account-role-policy/resolve/AP | valid creds | {account_code:'21100001'} | AP payable |
| 3.08 | GET /api/gl/account-role-policy/resolve/INVENTORY | valid creds | {account_code:'13500001'} | inventory acct |
| 3.09 | GET /api/gl/account-role-policy/resolve/UNKNOWN | valid creds | 404 | unresolvable role |
| 3.10 | POST /api/gl/account-role-policy (create) | company_admin, valid role+account | 201 Created | row in DB |
| 3.11 | POST /api/gl/account-role-policy (update existing) | same role+account, new priority | 200 OK | priority updated |
| 3.12 | POST /api/gl/account-role-policy invalid role_code | bad role | 404 Not Found | role not in md_account_roles |
| 3.13 | POST /api/gl/account-role-policy invalid account | bad account_code | 404 Not Found | account not in COA |
| 3.14 | POST /api/gl/account-role-policy (accountant role) | accountant | 403 Forbidden | role guard |
| 3.15 | DELETE /api/gl/account-role-policy/:id | valid id, company_admin | 200 OK, deactivated | is_active=0 in DB |
| 3.16 | DELETE non-existent | id=9999 | 404 | not found |
| 3.17 | resolveAccountByRole (lib function) | COGS → company_id=1 | '45010001' | direct lib test |
| 3.18 | resolveAccountByRole (cache hit) | same call twice | second = cache hit | clearV2Caches() clears it |
| 3.19 | Coverage gap detection | deactivate a mapping | coverage_pct drops | gap appears in response |
| 3.20 | No auth | no token | 401 | auth guard |

### CAT-4: Posting Engine V2 Resolution (Phase 2)
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 4.01 | V2 resolve: BPG+PPG+WH (level 1) | all 3 keys populated | level=1 rule found | cascade correct |
| 4.02 | V2 resolve: BPG+PPG (level 2) | no WH match | level=2 fallback | next cascade level |
| 4.03 | V2 resolve: BPG only (level 5) | no PPG/WH match | level=5 fallback | BPG global |
| 4.04 | V2 resolve: global (level 8) | no keys match | global fallback | last resort rule |
| 4.05 | V2 resolve: no rule found | no match anywhere | null result | graceful null |
| 4.06 | V2 multi-currency: USD amount | USD→EGP, amount=100 | base_amount=5050 | FX applied |
| 4.07 | V2 multi-currency: EGP identity | EGP→EGP | same amount | rate=1.0 |
| 4.08 | V2 multi-currency: missing FX | unknown pair | warning, original amount | no block |
| 4.09 | V2 batch resolve: 10 events | mixed rules | all resolved | batch handles misses |
| 4.10 | V2 valid_from/valid_to date filter | rule with future valid_from | NOT matched today | date filter works |
| 4.11 | V2 priority_index ordering | 2 rules same BPG+PPG | lowest priority wins | ordering correct |
| 4.12 | V2 cache 60s | same resolution twice | cache hit | clearV2Caches() works |
| 4.13 | V1 rules still resolve | rule with valid_from=NULL | resolves as before | backward compat |
| 4.14 | resolvePostingBatchV2 empty input | [] | [] | no crash |
| 4.15 | getExchangeRate missing pair | ZZZ→EGP | throws or returns 1 | predictable behavior |

### CAT-5: GL Periods & Journal Entries
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 5.01 | GET /api/gl/periods | valid creds | 4 periods | count=4 |
| 5.02 | POST journal entry (balanced) | debit=credit=1000 | 201 Created | entry stored |
| 5.03 | POST journal entry (unbalanced) | debit≠credit | 400 Bad Request | validation rejects |
| 5.04 | POST journal entry wrong period | closed/missing period | 422 | period guard |
| 5.05 | POST journal entry invalid account | account not in COA | 404 | account guard |
| 5.06 | GET /api/gl/entries | valid creds, company_id=1 | 1590 entries | full history |
| 5.07 | GET /api/gl/entries?period_id=X | filter by period | period-only entries | correct filter |
| 5.08 | GET /api/gl/entries/:id | valid entry id | single entry + lines | complete data |
| 5.09 | Reversal entry | POST reversal of entry id | signs flipped | debit↔credit swap |
| 5.10 | Audit trail | CREATE journal entry | audit_log row created | logAudit called |

### CAT-6: Batch Posting Jobs
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 6.01 | GET /api/gl/batch-jobs | valid creds | list returned | HTTP 200 |
| 6.02 | POST /api/gl/batch-jobs (create) | event_type + date range | job created | status='pending' |
| 6.03 | Batch job run: inventory_movement | ref_type='inventory_movement', 601 entries | all posted | 0 errors |
| 6.04 | Batch job run: supplier_transaction | 581 entries | all posted | 0 errors |
| 6.05 | Batch job idempotency | run same job twice | second = no-op | no duplicates |
| 6.06 | Batch job with V2 rules | event using V2 multi-currency rule | FX converted | base_amount populated |
| 6.07 | GET /api/gl/batch-jobs/:id | job id | status + progress | item counts correct |
| 6.08 | Error in batch job item | bad posting rule | item status='error' | job continues |

### CAT-7: Reconciliation & Integrity
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 7.01 | GET /api/gl/reconciliation/status | valid creds | reconciliation state | HTTP 200 |
| 7.02 | Bank statement reconcile | bank_statement + journal entries | matched items | no unmatched |
| 7.03 | GET /api/gl/integrity | valid creds | integrity scores | HTTP 200 |
| 7.04 | Integrity check: debit=credit | all 1590 entries | 0 unbalanced | confirmed 0 |
| 7.05 | Integrity check: orphan lines | all 3172 lines | 0 orphans | confirmed 0 |
| 7.06 | Integrity check: missing accounts | all lines | 0 missing | confirmed 0 |
| 7.07 | Period account balances | company_id=1, period | balances = sum of lines | math check |

### CAT-8: Reports
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 8.01 | GET /api/gl/reports/trial-balance | valid creds, period | balanced trial balance | total_debit = total_credit |
| 8.02 | GET /api/gl/reports/balance-sheet | valid creds | assets = liabilities + equity | accounting equation holds |
| 8.03 | GET /api/gl/reports/income-statement | valid creds | revenue - expenses = net income | sign correct |
| 8.04 | GET /api/gl/reports/ledger/:account_code | valid account | chronological entries | ordered by date |
| 8.05 | Report with date range filter | ?from=2025-11-01&to=2026-04-30 | filtered results | dates within range |
| 8.06 | Report unauthorized | accountant role | 200 (read allowed) | read-only access |

### CAT-9: Master Data (Phase 1)
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 9.01 | GET /api/gl/master-data/material-groups | valid creds | list | HTTP 200 |
| 9.02 | GET /api/gl/master-data/business-units | valid creds | list | HTTP 200 |
| 9.03 | GET /api/gl/master-data/account-roles | valid creds | ≥14 roles | md_account_roles populated |
| 9.04 | GET /api/gl/master-data/currencies | valid creds | ≥6 currencies | EGP/USD/EUR present |
| 9.05 | GET /api/gl/master-data/costing-methods | valid creds | costing methods | ACTUAL present |
| 9.06 | POST /api/gl/master-data/material-groups | company_admin | 201 Created | persisted |
| 9.07 | PATCH /api/gl/master-data/material-groups/:id | company_admin | 200 Updated | field updated |
| 9.08 | Audit log on create | POST master data | audit_log row | action='CREATE' |

### CAT-10: Security & Auth
| # | Test | Input | Expected | Pass Criteria |
|---|---|---|---|---|
| 10.01 | No auth on all GL endpoints | no token | 401 everywhere | auth middleware blanket |
| 10.02 | Expired JWT | exp in past | 401 | token expiry check |
| 10.03 | Wrong company in JWT | company_id=999 | 404 / empty results | company isolation |
| 10.04 | Accountant cannot POST entries via admin routes | accountant role | 403 | roleGuard works |
| 10.05 | SQL injection in account_code | '; DROP TABLE--' | 400 or no effect | prepared statements |
| 10.06 | SQL injection in role param | CASH'; -- | 404 or safe | no exec |
| 10.07 | Oversized payload | 10MB JSON body | 413 or safe error | no memory blow |
| 10.08 | Cross-company data isolation | company_id=2 reads company_id=1 data | empty results | WHERE company_id filter |

---

## V1 / V2 Parity Validation (Historical Data)

| Check | Query Result | Status |
|---|---|---|
| 84 V1 rules all have valid_from=NULL | 84/84 ✅ | Pass |
| 3172 existing lines all currency_code='EGP' | 3172/3172 ✅ | Pass |
| 0 unbalanced entries in 1590 | 0 unbalanced ✅ | Pass |
| 0 orphan lines | 0 ✅ | Pass |
| 0 lines pointing to missing accounts | 0 ✅ | Pass |
| Entry distribution: inventory_movement (601), supplier_transaction (581), supplier (260), cash (75), cash_transaction (71), business_event (2) | All accounted ✅ | Pass |
| 9 unposted drafts | Expected ℹ️ | Acceptable |

---

## Performance Targets

| Operation | Target | Notes |
|---|---|---|
| V2 rule resolution (single) | < 10ms | In-memory cascade |
| V2 rule resolution (with FX) | < 15ms | Includes FX cache lookup |
| V2 batch resolve (10 events) | < 50ms | Parallel D1 queries |
| POST journal entry | < 120ms | Includes validation + audit |
| GET trial balance (1590 entries) | < 800ms | Aggregate query |
| GET ledger (single account) | < 200ms | Indexed by account_code |
| Exchange rate convert | < 30ms | Cached after first hit |
| Role resolve | < 20ms | Cached after first hit |
| Batch job (100 events) | < 5s | Per-item < 50ms |

---

## Finance UAT Scenarios

### UAT-01: Full Purchase Cycle
1. Create supplier invoice (supplier_transaction)
2. Confirm posting rule resolves via V2 (BPG+PPG)
3. Verify journal entry: DR Purchases / CR Accounts Payable
4. Verify account_role_mappings: PURCHASES→21020001, AP→21100001
5. Check trial balance reflects change

### UAT-02: Inventory Movement Posting
1. Create inventory movement record
2. Batch post via `/api/gl/batch-jobs`
3. Verify: DR Inventory (13500001) / CR COGS or Purchases based on movement type
4. Check stock_quants alignment with journal

### UAT-03: Multi-Currency Invoice (Phase 2)
1. Create USD invoice at rate 50.5
2. Post via V2 engine with `currency_code='USD'`
3. Verify journal line: amount=USD value, `amount_in_base_currency`=USD×50.5 EGP
4. Verify FX conversion logged
5. Reconcile EGP base amounts

### UAT-04: Period Close
1. Close financial period (PUT /api/gl/periods/:id status→closed)
2. Attempt to post new entry to closed period
3. Verify 422 error returned
4. Open next period, confirm entries route to new period

### UAT-05: Account Role Policy Change
1. GET /api/gl/account-role-policy/resolve/CASH → 14010101
2. POST new higher-priority mapping: CASH → 14010201
3. GET resolve/CASH again → new account wins (priority=0)
4. Delete new mapping
5. GET resolve/CASH → back to 14010101

### UAT-06: Reconciliation Workflow
1. Import bank statement entries
2. Match against journal entries by amount + date
3. GET /api/gl/reconciliation/status → unmatched count
4. Manually match remaining
5. Confirm reconciliation complete

---

## Go / No-Go Checklist

### Technical Gates
- [x] TypeScript backend: 0 errors — ✅ 2026-05-02
- [x] TypeScript frontend: 0 errors — ✅ 2026-05-02
- [x] Frontend `npm run build` succeeds (built in 19.42s) — ✅ 2026-05-02
- [ ] All CAT-1 through CAT-10 tests: PASS (target 95%+ pass rate)
- [x] V1/V2 parity: ALL historical data checks PASS — ✅ 2026-05-02
- [x] 0 unbalanced journal entries — ✅ confirmed
- [x] 0 orphan lines — ✅ confirmed
- [x] 0 entries without lines (7 backfill artifacts deleted) — ✅ 2026-05-02
- [ ] POST journal entry < 120ms (measure via wrangler tail)
- [ ] V2 batch resolve (10 events) < 50ms (measure via wrangler tail)
- [ ] Exchange rate cache working (same pair, second call faster)

### Data Gates
- [x] exchange_rates: 6 rates for EGP pairs — ✅ confirmed
- [x] md_event_types: 14 active types — ✅ confirmed
- [x] account_role_mappings: 14 mappings, coverage ≥ 70% — ✅ confirmed
- [x] posting_rules: 84 V1 rules intact (valid_from=NULL) — ✅ confirmed
- [x] chart_of_accounts: 278 leaf accounts active — ✅ confirmed

### Deployment Gates
- [x] `npx wrangler deploy` succeeds — ✅ 2026-05-02
- [x] All smoke tests return 401 (5/5) — ✅ 2026-05-02
- [x] `/api/gl/account-role-policy/coverage` live — ✅ 401 confirms endpoint registered
- [x] `/api/gl/exchange-rates` live — ✅ 401 confirms endpoint registered
- [x] Frontend `npm run build` succeeds — ✅ 2026-05-02

### Finance Sign-Off Gates
- [ ] UAT-01 (Purchase Cycle) — Finance team sign-off
- [ ] UAT-02 (Inventory Posting) — Warehouse team sign-off
- [ ] UAT-03 (Multi-Currency) — Finance team sign-off
- [ ] UAT-04 (Period Close) — Accounting team sign-off
- [ ] UAT-05 (Role Policy Change) — Admin team sign-off
- [ ] UAT-06 (Reconciliation) — Finance team sign-off

### Security Gates
- [ ] All endpoints return 401 without auth
- [ ] Company isolation verified (no cross-tenant data)
- [ ] SQL injection test passes (prepared statements protect)
- [ ] role guards prevent unauthorized mutations

---

## Known Acceptable Exceptions

| Item | Reason | Action |
|---|---|---|
| 9 unposted drafts | In-progress work, not errors | Monitor only |
| 2 posting_rule_resolutions | Expected for business_event entries | Expected |
| posting_rules.rule_type='control' (29) | Control accounts — no auto-post | By design |
| FX rates missing `is_active` column | V1 table, add in Phase 5 schema cleanup | Phase 5 ticket |

---

## Phase 5 Pre-Requisites (Go-Live)

1. Add `is_active` column to `exchange_rates` (currently missing)
2. Add `status` column to `financial_periods` (currently missing)
3. Frontend: Build `AccountRolePolicyPage.tsx` UI
4. Frontend: Build `ExchangeRatesPage.tsx` UI
5. Cron job for FX rate auto-fetch (CBE / ECB API)
6. Automated backup policy (D1 export daily)
7. Monitoring: wrangler tail alerts on `[ERROR]` pattern
8. Rate limiting on posting endpoints (prevent abuse)

---

## Execution Backlog Reference

The actionable, ticket-based audit backlog is maintained in:

- `EXECUTABLE_AUDIT_BACKLOG.md`

It includes:

- Named tickets (AUD-001 .. AUD-010)
- SQL and API checks per ticket
- Owner assignment (Finance, Backend, Frontend, QA)
- Exit criteria and execution order
