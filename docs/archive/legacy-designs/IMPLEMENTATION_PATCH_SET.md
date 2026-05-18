# Implementation Patch Set

## Objective
Execute the Harvest-to-GL integration and Type-Safety purge, with immediate enterprise hardening on RBAC and tenant isolation.

## Completed Changes

### 1. Harvest-to-GL Integration
- Added delta-based posting helper in FinanceCore:
  - postHarvestDelta(company_id, harvest_id, harvest_date, crop_name, field_name, center_code, revenue_delta, cost_delta)
- Wired harvest create flow to auto-post revenue/cost journal entries.
- Added rollback behavior when harvest posting fails (delete inserted harvest row).
- Wired harvest update flow to post only revenue/cost deltas.

Primary files:
- src/lib/finance_core.ts
- src/api/fields.ts

### 2. Type-Safety Purge (Target Scope)
Removed unsafe any usage from:
- src/lib/finance_core.ts
  - Introduced typed interfaces (CashMovementInput, CashDraftRow)
  - Replaced untyped statement arrays with D1PreparedStatement[]
- src/api/suppliers.ts
  - Replaced catch(e: any) with catch(e: unknown)
  - Replaced .first<any>() with explicit typed select shape
- web/src/api/client.ts
  - Replaced Paginated<any> and get<any>/post<any> with named interfaces
  - Typed admin switch callback payloads

### 3. RBAC Hardening
Introduced role-based middleware and applied to sensitive modules:
- middleware roleGuard added in src/middleware/auth.ts
- Applied to finance, treasury, GL, HR, operations, suppliers, employees, fields

### 4. Tenant Isolation Hardening (High Priority Joins)
Added explicit company_id predicates to high-risk joins in:
- src/api/fields.ts
- src/api/operations.ts
- src/api/finance.ts
- src/api/hr.ts

### 5. GL Safety Hardening
- Added CoA cycle prevention and parent validation in src/api/gl.ts.
- Added recursive cycle detection guard in descendant builder.

## Validation Results
Diagnostics after edits:
- src/api/fields.ts: no errors
- src/lib/finance_core.ts: no errors
- src/api/suppliers.ts: no errors
- web/src/api/client.ts: no errors
- src/api/operations.ts: no errors
- src/api/finance.ts: no errors
- src/api/hr.ts: no errors

Type-safety spot-check for target files:
- No remaining any matches in patched targets.

## Residual Work (Next Wave)
1. Run full tenant-join sweep across remaining API modules.
2. Add CI static checks for tenant join predicates.
3. Extend idempotency keys to remaining heavy write endpoints.
4. Add automated integration tests for harvest delta posting and reversal edge cases.
