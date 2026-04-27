# Code Audit Report
Date: 2026-04-27
Scope: Backend `src/` + Frontend `web/src/`

## Executive Summary
- Total backend TypeScript files: 50
- Total frontend page files: 65
- Total frontend component files: 31
- `@deprecated` tags found: 2
- Long commented blocks (>10 lines): 0
- Suspected dead/low-usage exported functions: 8

## Backend API Surface (by route file)
Top endpoint-heavy modules:

| File | Endpoint count (approx) |
|---|---:|
| `src/api/gl.ts` | 38 |
| `src/api/config.ts` | 17 |
| `src/api/operations.ts` | 16 |
| `src/api/documents.ts` | 15 |
| purchasing module routes | 12 |
| `calendar.ts`, `contracts.ts`, `export.ts`, `fields.ts` | ~10 each |

Observation: GL is the largest domain and should keep strict architecture ownership (posting engine + health + setup endpoints).

## Table Usage Map (Core Tables)
| Table | Usage Count (approx) | Main backend files | Main frontend pages/components |
|---|---:|---|---|
| suppliers | 48 | `src/api/suppliers.ts` | supplier hub/details/reports |
| journal_entries | 32 | `src/lib/gl.ts`, `src/api/gl.ts` | GL entries/statements pages |
| cash_transactions | 31 | `src/lib/finance_core.ts`, treasury APIs | treasury pages/reports |
| items | 29 | `src/lib/finance_core.ts`, inventory APIs | item/warehouse pages |
| gl_account_mappings | 29 | `src/lib/finance_core.ts`, `src/api/gl.ts` | legacy GL mapping pages |
| supplier_transactions | 26 | `src/api/suppliers.ts` | supplier statements/reports |
| journal_entry_lines | 24 | `src/lib/gl.ts`, `src/api/gl.ts` | GL reporting pages |
| chart_of_accounts | 20 | `src/api/gl.ts`, `src/lib/gl.ts` | chart/ledger pages |
| inventory_movements | 20 | inventory/admin APIs | inventory movement pages |
| general_posting_setup | 14 | `src/lib/posting_engine.ts`, `src/api/gl.ts` | posting setup pages |
| inventory_posting_setup | 14 | `src/lib/posting_engine.ts`, `src/api/gl.ts` | posting setup pages |
| financial_periods | 10 | `src/api/gl.ts` | period pages |
| audit_log | 7 | `src/api/audit.ts`, `src/lib/audit.ts` | audit center pages |
| system_error_logs | 4 | `src/api/audit.ts` | error log page |

## Dead Code Analysis

### Suspected Unused/Low-Use Exported Functions (REVIEW)
| Function | File | Reason |
|---|---|---|
| `glCashTransaction` | `src/lib/gl.ts` | exported legacy helper; primary flow now goes through `FinanceCore` in route layer |
| `glSupplierTransaction` | `src/lib/gl.ts` | likely superseded by posting-engine orchestrated calls |
| `glSupplierInvoice` | `src/lib/gl.ts` | routing now centralized via `FinanceCore.resolveSupplierInvoice` |
| `glInventoryMovement` | `src/lib/gl.ts` | inventory flow now uses `FinanceCore.resolveInventoryMovement` |
| `glWagesPayment` | `src/lib/gl.ts` | check payroll route usage before removal |
| `glPayroll` | `src/lib/gl.ts` | check payroll run integration before removal |
| `resolveCustomerSale` | `src/lib/posting_engine.ts` | exported but low/zero external references in current route graph |
| `resolveCustomerPayment` | `src/lib/posting_engine.ts` | exported but low/zero external references in current route graph |

### Deprecated API Surface
| Symbol | File | Note |
|---|---|---|
| `glApi.mappings()` | `web/src/api/gl.ts` | marked deprecated; replacement is posting setup + posting groups |
| `glApi.saveMappings()` | `web/src/api/gl.ts` | marked deprecated; replacement is posting setup APIs |

### Unused Imports
No large hotspot pattern found in this audit pass. Use lint rule (`no-unused-vars` + import plugin) for deterministic detection.

### Commented-Out Legacy Blocks
No >10-line commented blocks detected in backend/frontend TS/TSX.

### Duplicate Logic Candidates
| Candidate | Evidence | Action |
|---|---|---|
| direct `postAutoEntry` in some route files vs `FinanceCore` orchestration | mixed patterns in treasury/suppliers/inventory paths | standardize to one service boundary (`FinanceCore`) |
| legacy mapping fallback + posting-group flow | both visible in compatibility routes | keep compat now, then remove fallback after sunset |

## Frontend Audit Addendum
- Router inventory (`web/src/App.tsx`) confirms active routing for all modules listed in sidebar.
- Backward-compat GL routes remain (`/gl/mappings`, `/gl/periods`, `/gl/integrations`) and should be sunset according to deprecation plan.
- No obvious orphan page components were found in this pass.

## Recommendations
1. Remove or internalize low-use exports in `src/lib/gl.ts` after confirming no dynamic imports/tests rely on them.
2. Keep deprecation period for mapping APIs until all clients migrate; then delete endpoint + UI tab.
3. Add linting + import-cycle checks to CI (currently scripts not present in package manifests).
4. Add code ownership tags for large modules (`gl.ts`, `config.ts`, `operations.ts`).
5. Enforce integration through `FinanceCore` only; ban direct posting side-effects from route handlers except explicitly approved exceptions.
