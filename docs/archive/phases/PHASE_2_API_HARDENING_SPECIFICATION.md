# Phase 2: API Hardening & Canonical Model Specification

**Status:** In Development (May 11, 2026)  
**Objective:** Enforce strict API validation rules to ensure all data entry follows canonical dimensional model  
**Scope:** suppliers.ts, inventory/movements.ts, treasury.ts  
**Timeline:** Implementation → Gradual deployment to remote D1  

---

## 1. Core Principles

### 1.1 Canonical Dimension Model
Every transaction must carry one and ONLY ONE of these dimensional contexts:

| Context | Fields Required | Fields Optional | Movement Type | GL Account Path |
|---------|-----------------|-----------------|--|--|
| **SUPPLIER** | `supplier_code`, `document_number`, `statement_text` | `service_type_code` | GRN, Supplier Invoice, Supplier Payment | 1407 (Inventory) → 2120 (AP) |
| **OPERATIONAL** | `center_code`, `service_type_code`, `statement_text` | `season_id`, `field_id`, `work_order_id` | ISSUE, Equipment Rental, Labor | 5101 (Operating Expense) → GL |
| **FINANCIAL** | `statement_text`, `financial_account_id` | `service_type_code` | Supplier Payment, Cash Transfer | 1401 (Cash) → 2120 (AP) or GL |
| **INVENTORY** | `item_code`, `warehouse`, `movement_date` | `supplier_code` (GRN), `center_code` (ISSUE) | GRN, ISSUE, Adjustment | 1407 → Various |

### 1.2 Service Type Hierarchy (Mandatory when applicable)

**Defined Service Types (service_types table):**
```
SRV_MECH       → Mechanization/Equipment Rental → 5101.Equipment → 2120.1
SRV_LABOR      → Labor Supply → 5101.Labor → 2120.1
SRV_SUPPLY     → Material/Chemical Purchase → 1407 (Inventory) → 2120.1
SRV_LOGISTICS  → Transportation → 5101.Logistics → 2120.2
SRV_SUPERVISION → Agricultural Supervision → 33067 → 2120.2
SRV_SPARE_PARTS → Equipment Spare Parts → 1407.4 → 2120.1
SRV_ADMIN      → Admin Overhead → 33xxx → 2120.3
```

**Mandatory Service Type Rules:**
- ✅ **ISSUE movements MUST have** `service_type_code` (no exceptions)
- ✅ **Equipment Rental supplier transactions MUST have** `service_type_code = 'SRV_MECH'`
- ✅ **Labor supplier transactions MUST have** `service_type_code = 'SRV_LABOR'`
- ✅ **Material purchases MUST have** `service_type_code = 'SRV_SUPPLY'` or more specific
- ❌ **NEVER omit service_type_code** when posting operational expense

### 1.3 Dimensional Enforcement Rules

| Module | Movement Type | Constraint | Validation |
|--------|---|---|---|
| **inventory/movements.ts** | GRN | Must have supplier_code + document_number | FK check supplier exists, document_number > 0 |
| **inventory/movements.ts** | ISSUE | Must have center_code + service_type_code + statement_text | FK check center exists, service_type validates |
| **suppliers.ts** | Supplier Invoice | Must have service_type_code if debit amount > 0 | Look up service_types table, must be active |
| **suppliers.ts** | Supplier Payment | Must have service_type_code if payment > 0 | Payment routes to 2120.[service_type_subaccount] |
| **treasury.ts** | Cash Transaction | Must have financial_account_id + statement_text | statement_text ≥ 3 chars, account must exist in COA |

---

## 2. API Hardening Changes by Module

### 2.1 suppliers.ts — Enhanced POST /api/suppliers/transactions

#### Before (Current State)
```json
POST /api/suppliers/transactions
{
  "supplier_code": 20900353,
  "transaction_type": "INVOICE",
  "debit": 1000000,
  "credit": 0,
  "notes": "عرفة فاتورة شراء"
}
// ❌ Missing service_type_code — will post to default AP account 2120 (ambiguous!)
// ❌ notes field is informal — no structured statement_text
```

#### After (Canonical Model)
```json
POST /api/suppliers/transactions
{
  "supplier_code": 20900353,
  "transaction_type": "INVOICE",
  "document_number": 105231,
  "document_date": "2026-05-11",
  "debit": 1000000,
  "credit": 0,
  "statement_text": "فاتورة شراء اسمدة - الدفعة 2026-Q2",  // ← MANDATORY, ≥ 3 chars
  "service_type_code": "SRV_SUPPLY",                           // ← MANDATORY (no default fallback)
  "season_id": 3,
  "center_code": 1006011,                                      // ← Optional for multi-center suppliers
  "notes_internal": "[DEBUG] Mapped from legacy code 20900353.1"  // ← Audit trail only
}
// ✅ service_type_code → routes payment to 2120.1 (commodity AP subaccount)
// ✅ statement_text is formal and meaningful
// ✅ season_id + center_code enable cost allocation
```

**Validation Rules (NEW):**
```typescript
// In POST /suppliers/transactions handler:

// 1. statement_text is mandatory and must be meaningful
if (!body.statement_text || body.statement_text.trim().length < 3) {
  throw "STATEMENT_TEXT_REQUIRED: minimum 3 characters"
}

// 2. If debit > 0 (expense posting), service_type_code is mandatory
if ((body.debit ?? 0) > 0) {
  if (!body.service_type_code) {
    throw "SERVICE_TYPE_CODE_REQUIRED: debit transactions must specify service type"
  }
  // 3. service_type_code must exist and be active
  const serviceType = await db.prepare(
    "SELECT * FROM service_types WHERE company_id=? AND code=? AND is_active=1"
  ).bind(company_id, body.service_type_code).first()
  if (!serviceType) {
    throw "UNKNOWN_SERVICE_TYPE: check service_types table"
  }
}

// 4. Supplier must exist and have matching service capability
const supplier = await db.prepare(
  "SELECT * FROM suppliers WHERE company_id=? AND code=?"
).bind(company_id, body.supplier_code).first()
if (!supplier) {
  throw "SUPPLIER_NOT_FOUND"
}

// 5. For multi-service suppliers, validate supplier-service mapping
const mapping = await db.prepare(
  "SELECT * FROM supplier_service_map WHERE supplier_code=? AND service_type_code=?"
).bind(body.supplier_code, body.service_type_code).first()
if (!mapping) {
  throw "SUPPLIER_SERVICE_MISMATCH: supplier not authorized for this service type"
}

// 6. GL account is DERIVED from service_type, not from supplier default
const glCredit = serviceType.default_ap_account_code  // e.g., "2120.1" for SRV_SUPPLY
```

**Error Messages (NEW):**
- `STATEMENT_TEXT_REQUIRED`: statement_text field must be ≥ 3 chars
- `SERVICE_TYPE_CODE_REQUIRED`: debit transactions require service_type_code
- `UNKNOWN_SERVICE_TYPE`: service_type_code not found or inactive
- `SUPPLIER_SERVICE_MISMATCH`: supplier not mapped to this service type
- `INVALID_SEASON_ALLOCATION`: season_id must match active season

---

### 2.2 inventory/movements.ts — Enhanced POST /api/inventory/movements

#### Before (Current State)
```json
POST /api/inventory/movements
{
  "movement_date": "2026-05-11",
  "movement_type": "ISSUE",
  "item_code": 1234,
  "warehouse": "WAREHOUSE_A",
  "quantity": 100,
  "center_code": 1006011
  // ⚠️ Missing service_type_code — posting logic can't determine GL account!
}
// ❌ Ambiguous routing: should this be COGS, Equipment Expense, or Overhead?
```

#### After (Canonical Model)
```json
POST /api/inventory/movements
{
  "movement_date": "2026-05-11",
  "movement_type": "ISSUE",
  "item_code": 1234,
  "warehouse": "WAREHOUSE_A",
  "quantity": 100,
  "center_code": 1006011,                             // ← MANDATORY for ISSUE
  "service_type_code": "SRV_MECH",                    // ← MANDATORY for ISSUE (debit account)
  "statement_text": "صرف مواد للبيفوت 1006011 - ميكنة",  // ← MANDATORY, ≥ 3 chars
  "season_id": 3,
  "field_id": 42,                                      // ← Optional but recommended for traceability
  "work_order_id": 5001,                               // ← Optional, links to maintenance order
  "notes_internal": "[AUTO] Mapped from warehouse bin 12-C-05"
}
// ✅ service_type_code → routes debit to 5101.Equipment (operating expense)
// ✅ center_code → cost allocation to pivot 1006011
// ✅ field_id + season_id → traceability for yield costing
```

**Validation Rules (NEW):**
```typescript
// In POST /inventory/movements handler (ISSUE type):

// 1. ISSUE must have center_code (non-nullable)
if (!body.center_code && body.movement_type === 'ISSUE') {
  throw "ISSUE_REQUIRES_CENTER: center_code is mandatory for inventory issuance"
}

// 2. ISSUE must have service_type_code (ALWAYS required, no fallback)
if (!body.service_type_code && body.movement_type === 'ISSUE') {
  throw "ISSUE_REQUIRES_SERVICE_TYPE: service_type_code is mandatory for inventory issuance"
}

// 3. statement_text is mandatory for ISSUE (meaningful business description)
if (body.movement_type === 'ISSUE') {
  if (!body.statement_text || body.statement_text.trim().length < 3) {
    throw "ISSUE_REQUIRES_STATEMENT: statement_text must be ≥ 3 characters"
  }
}

// 4. GRN must have supplier_code and document_number (source validation)
if (body.movement_type === 'GRN') {
  if (!body.supplier_code) {
    throw "GRN_REQUIRES_SUPPLIER: supplier_code is mandatory for goods receipt"
  }
  if (!body.document_number) {
    throw "GRN_REQUIRES_DOCUMENT: document_number is mandatory for goods receipt"
  }
}

// 5. service_type_code must be active
const serviceType = await db.prepare(
  "SELECT * FROM service_types WHERE company_id=? AND code=? AND is_active=1"
).bind(company_id, body.service_type_code).first()
if (!serviceType) {
  throw "UNKNOWN_SERVICE_TYPE"
}

// 6. Debit GL account is derived from service_type (not from hardcoded defaults)
const glDebit = serviceType.default_expense_account_code  // e.g., "5101" for SRV_LABOR
```

**Error Messages (NEW):**
- `ISSUE_REQUIRES_CENTER`: center_code mandatory for ISSUE
- `ISSUE_REQUIRES_SERVICE_TYPE`: service_type_code mandatory for ISSUE (no fallback)
- `ISSUE_REQUIRES_STATEMENT`: statement_text must be ≥ 3 chars for ISSUE
- `GRN_REQUIRES_SUPPLIER`: supplier_code mandatory for GRN
- `GRN_REQUIRES_DOCUMENT`: document_number mandatory for GRN
- `UNKNOWN_SERVICE_TYPE`: service_type_code not found or inactive
- `INSUFFICIENT_STOCK`: quantity exceeds available balance

---

### 2.3 treasury.ts — Enhanced POST /api/treasury/cash-transactions

#### Before (Current State)
```json
POST /api/treasury/cash-transactions
{
  "transaction_date": "2026-05-11",
  "direction": "م",  // مصروف (expense)
  "amount": 50000,
  "narration": "دفعة لشركة عرفة"
  // ⚠️ Missing financial_account_id — which GL account is this posting to?
  // ⚠️ Missing statement_text — unclear business purpose
}
// ❌ Routing unknown: should debit 1201 (bank) or 1204 (cash box)?
```

#### After (Canonical Model)
```json
POST /api/treasury/cash-transactions
{
  "transaction_date": "2026-05-11",
  "direction": "م",
  "amount": 50000,
  "financial_account_code": "1204",                    // ← MANDATORY (which cash account?)
  "statement_text": "سداد فاتورة عرفة 105231 - اسمدة",   // ← MANDATORY, ≥ 3 chars, formal
  "service_type_code": "SRV_SUPPLY",                   // ← Optional but recommended for cost tracking
  "supplier_code": 20900353,                           // ← Optional but recommended for AP matching
  "document_number": 105231,                           // ← Optional, reference to source invoice
  "notes_internal": "[AUTO] Payment matches GRN 2026-05-10"
}
// ✅ financial_account_code → cash GL posting is explicit
// ✅ statement_text is meaningful and audit-ready
// ✅ supplier_code + document_number enable AP matching
```

**Validation Rules (NEW):**
```typescript
// In POST /treasury/cash-transactions handler:

// 1. financial_account_code is mandatory (no implicit defaults)
if (!body.financial_account_code) {
  throw "FINANCIAL_ACCOUNT_CODE_REQUIRED: specify which GL account to post cash to"
}

// 2. account must exist in chart of accounts and be cash-type
const account = await db.prepare(
  "SELECT * FROM chart_of_accounts WHERE company_id=? AND account_code=? AND account_type IN ('CASH', 'BANK')"
).bind(company_id, body.financial_account_code).first()
if (!account) {
  throw "INVALID_FINANCIAL_ACCOUNT: account does not exist or is not cash-type"
}

// 3. statement_text is mandatory (meaningful business description)
if (!body.statement_text || body.statement_text.trim().length < 3) {
  throw "STATEMENT_TEXT_REQUIRED: minimum 3 characters, formal description"
}

// 4. If supplier_code is provided, it must exist
if (body.supplier_code) {
  const supplier = await db.prepare(
    "SELECT * FROM suppliers WHERE company_id=? AND code=?"
  ).bind(company_id, body.supplier_code).first()
  if (!supplier) {
    throw "SUPPLIER_NOT_FOUND"
  }
}

// 5. If service_type_code is provided, it must be active (optional but validates if present)
if (body.service_type_code) {
  const serviceType = await db.prepare(
    "SELECT * FROM service_types WHERE company_id=? AND code=? AND is_active=1"
  ).bind(company_id, body.service_type_code).first()
  if (!serviceType) {
    throw "UNKNOWN_SERVICE_TYPE"
  }
}

// 6. Balance check (optional: warn if payment > current AP)
if (body.supplier_code) {
  const currentAP = await getSupplierAPBalance(company_id, body.supplier_code)
  if (body.amount > currentAP) {
    // Log warning but don't fail (allows overpayment with audit trail)
    console.warn(`OVERPAYMENT_WARNING: payment ${body.amount} exceeds AP balance ${currentAP}`)
  }
}
```

**Error Messages (NEW):**
- `FINANCIAL_ACCOUNT_CODE_REQUIRED`: cash account is mandatory
- `INVALID_FINANCIAL_ACCOUNT`: account does not exist or is not cash-type
- `STATEMENT_TEXT_REQUIRED`: statement_text must be ≥ 3 chars
- `SUPPLIER_NOT_FOUND`: supplier_code does not exist
- `UNKNOWN_SERVICE_TYPE`: service_type_code not found or inactive
- `INSUFFICIENT_CASH_BALANCE`: amount exceeds available cash (warning only, does not fail)

---

## 3. Governance Flags & Data Quality

### 3.1 movement_governance_flags Table

Replaces inline "NEEDS_DIMENSION" tags in notes with formal flag records.

```sql
CREATE TABLE movement_governance_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  source_module TEXT NOT NULL,      -- 'treasury', 'suppliers', 'inventory'
  source_table TEXT NOT NULL,       -- 'cash_transactions', 'supplier_transactions', 'inventory_movements'
  source_id INTEGER NOT NULL,
  flag_code TEXT NOT NULL,          -- 'MISSING_SERVICE_TYPE', 'MISSING_STATEMENT_TEXT', 'MISSING_CENTER', etc.
  flag_status TEXT NOT NULL DEFAULT 'open',  -- 'open', 'resolved', 'waived'
  flag_details TEXT,
  created_by INTEGER,
  resolved_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  UNIQUE(company_id, source_table, source_id, flag_code)
);
```

**Flag Codes (Standardized):**
- `MISSING_SERVICE_TYPE`: service_type_code is null/empty for operation that requires it
- `MISSING_STATEMENT_TEXT`: statement_text is null/empty or < 3 chars
- `MISSING_SUPPLIER_CODE`: supplier_code is null for GRN
- `MISSING_DOCUMENT_NUMBER`: document_number is null for GRN
- `MISSING_CENTER_CODE`: center_code is null for ISSUE
- `MISSING_FINANCIAL_ACCOUNT`: financial_account_code is null for cash transaction
- `UNKNOWN_SERVICE_TYPE`: service_type_code refers to non-existent/inactive service
- `SUPPLIER_SERVICE_MISMATCH`: supplier not authorized for specified service type
- `INVALID_FUTURE_DATE`: movement_date is in future (blocks posting)
- `OVERPAYMENT_DETECTED`: payment amount > supplier AP balance

### 3.2 Data Quality Queries (Daily Check-in)

**Query Pack Location:** `sql/governance/03_daily_finance_control_query_pack.sql`

**Critical Metrics:**
```sql
-- 1. How many posted supplier transactions lack service_type_code?
SELECT COUNT(*) FROM supplier_transactions 
WHERE company_id=1 AND status='posted' AND service_type_code IS NULL;
-- Expected: 0 (all posted transactions must have service type)

-- 2. How many posted ISSUE movements lack service_type_code?
SELECT COUNT(*) FROM inventory_movements 
WHERE company_id=1 AND movement_type='ISSUE' AND service_type_code IS NULL;
-- Expected: 0 (all ISSUE movements must have service type)

-- 3. How many cash transactions lack financial_account_code?
SELECT COUNT(*) FROM cash_transactions 
WHERE company_id=1 AND status='posted' AND financial_account_code IS NULL;
-- Expected: 0 (all cash transactions must specify account)

-- 4. How many transactions have statement_text < 3 chars?
SELECT COUNT(*) FROM (
  SELECT * FROM supplier_transactions 
  WHERE company_id=1 AND statement_text IS NOT NULL 
    AND LENGTH(TRIM(statement_text)) < 3
  UNION ALL
  SELECT * FROM cash_transactions 
  WHERE company_id=1 AND statement_text IS NOT NULL 
    AND LENGTH(TRIM(statement_text)) < 3
);
-- Expected: 0 (all posted transactions must have meaningful statement)

-- 5. Active governance flags (unresolved issues)
SELECT COUNT(*) FROM movement_governance_flags 
WHERE company_id=1 AND flag_status='open';
-- Expected: trend downward with API hardening enforcement
```

---

## 4. Deployment Strategy

### 4.1 Phase 2a: Schema & Service Types (NOW)
```bash
# Create service_types table and governance flags
# Create supplier_service_map for multi-service authorization
# Populate baseline service taxonomy (SRV_MECH, SRV_LABOR, SRV_SUPPLY, etc.)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file sql/governance/02_phase2_service_taxonomy.sql
```

### 4.2 Phase 2b: API Validation Deployment (Local Testing First)
```bash
# Test updated validators locally (no D1 calls needed)
npm run test -- src/api/suppliers.test.ts
npm run test -- src/api/inventory/movements.test.ts
npm run test -- src/api/treasury.test.ts

# Deploy API changes to Cloudflare Workers
npm run backend:deploy:prod
```

### 4.3 Phase 2c: Data Backfill & Harmonization (Gradual)
```bash
# Step 1: Mark all existing transactions with best-guess service_type (if determinable)
UPDATE supplier_transactions SET service_type_code='SRV_MECH' 
  WHERE service_type_code IS NULL AND expense_category='ميكنة';

# Step 2: Populate statement_text from legacy notes/narration fields
UPDATE supplier_transactions SET statement_text=notes 
  WHERE statement_text IS NULL AND notes IS NOT NULL;

# Step 3: Identify gaps (governance flags)
INSERT INTO movement_governance_flags (company_id, source_table, source_id, flag_code)
SELECT 1, 'supplier_transactions', id, 'MISSING_SERVICE_TYPE'
FROM supplier_transactions 
WHERE company_id=1 AND status='posted' AND service_type_code IS NULL;
```

### 4.4 Phase 2d: Cutover Rules

**STRICT Rule for NEW API Calls (after deployment):**
- ✅ All POST requests to /suppliers/transactions, /inventory/movements, /treasury/cash-transactions MUST include mandatory fields or receive 422 UNPROCESSABLE_ENTITY
- ✅ No fallback defaults — if statement_text is missing, return error immediately
- ✅ No implicit GL account assignment — service_type_code MUST be specified

**Backward Compatibility (Reading OLD data):**
- ✅ Existing transactions without service_type_code are readable but NOT editable without adding it
- ✅ Report queries warn on gaps but don't fail
- ✅ PATCH requests to update old transactions MUST provide service_type_code

---

## 5. Test Cases (PostMan / cURL Examples)

### 5.1 Supplier Transaction — VALID Request
```bash
curl -X POST http://localhost:3000/api/suppliers/transactions \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_code": 20100033,
    "transaction_type": "INVOICE",
    "document_number": 456789,
    "document_date": "2026-05-11",
    "debit": 50000,
    "credit": 0,
    "statement_text": "فاتورة ميكنة ساعات تشغيل للبيفوت",
    "service_type_code": "SRV_MECH",
    "center_code": 1006011,
    "season_id": 3
  }'
# Expected Response: 201 Created
# Transaction is posted with service_type_code → routes debit to 2120.1
```

### 5.2 Supplier Transaction — INVALID (Missing service_type_code)
```bash
curl -X POST http://localhost:3000/api/suppliers/transactions \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_code": 20100033,
    "transaction_type": "INVOICE",
    "debit": 50000,
    "credit": 0,
    "statement_text": "فاتورة ميكنة"
    // ❌ Missing service_type_code!
  }'
# Expected Response: 422 Unprocessable Entity
# Error: "SERVICE_TYPE_CODE_REQUIRED: debit transactions require service_type_code"
```

### 5.3 Inventory ISSUE — VALID Request
```bash
curl -X POST http://localhost:3000/api/inventory/movements \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "movement_date": "2026-05-11",
    "movement_type": "ISSUE",
    "item_code": 1234,
    "warehouse": "WH_NORTH",
    "quantity": 50,
    "center_code": 1006011,
    "service_type_code": "SRV_LABOR",
    "statement_text": "صرف اسمدة عمالة البيفوت 11 موسم Q2"
  }'
# Expected Response: 201 Created
# Debit 5101 (Labor Expense) / Credit 1407 (Inventory)
```

### 5.4 Inventory ISSUE — INVALID (Missing center_code)
```bash
curl -X POST http://localhost:3000/api/inventory/movements \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "movement_date": "2026-05-11",
    "movement_type": "ISSUE",
    "item_code": 1234,
    "warehouse": "WH_NORTH",
    "quantity": 50
    // ❌ Missing center_code and service_type_code!
  }'
# Expected Response: 422 Unprocessable Entity
# Error: "ISSUE_REQUIRES_CENTER: center_code is mandatory for inventory issuance"
```

### 5.5 Cash Transaction — VALID Request
```bash
curl -X POST http://localhost:3000/api/treasury/cash-transactions \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_date": "2026-05-11",
    "direction": "م",
    "amount": 100000,
    "financial_account_code": "1204",
    "statement_text": "سداد فاتورة شركة عرفة للشراء",
    "supplier_code": 20900353,
    "document_number": 105231,
    "service_type_code": "SRV_SUPPLY"
  }'
# Expected Response: 201 Created
# Debit 2120.1 (AP - Commodities) / Credit 1204 (Cash)
```

### 5.6 Cash Transaction — INVALID (Missing financial_account_code)
```bash
curl -X POST http://localhost:3000/api/treasury/cash-transactions \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_date": "2026-05-11",
    "direction": "م",
    "amount": 100000,
    "statement_text": "سداد"
    // ❌ Missing financial_account_code!
  }'
# Expected Response: 422 Unprocessable Entity
# Error: "FINANCIAL_ACCOUNT_CODE_REQUIRED: specify which GL account to post cash to"
```

---

## 6. Success Criteria (Phase 2 Complete)

✅ **Schema Ready:**
- service_types table exists with 7+ core services
- supplier_service_map table exists and populated
- movement_governance_flags table operational

✅ **API Hardening Applied:**
- suppliers.ts POST validates service_type_code + statement_text for debit transactions
- inventory/movements.ts POST validates center_code + service_type_code + statement_text for ISSUE
- treasury.ts POST validates financial_account_code + statement_text for cash

✅ **Data Quality Audit Trail:**
- All new transactions recorded with statement_text + service_type_code
- Governance flags capture any violations
- Daily control queries show 0 mandatory field violations for NEW data

✅ **Testing Verified:**
- Test suite passes 6 scenarios above (3 valid, 3 invalid)
- Error messages are clear and actionable
- Backend deployment successful, no TypeScript errors

✅ **Migration Readiness:**
- Legacy data backfilled with best-guess service_type where determinable
- Gap analysis complete (remaining NULL service_types identified in flags)
- Cutoff policy applied (future-dated & actionable rows handled)

---

## 7. Next Phase (Phase 3)

Once Phase 2 is deployed and validated:
1. Execute full data cleanup (DELETE old data, keep schema + taxonomies)
2. Load canonical re-entry data in correct dimensional format
3. Repost all GL entries from canonical data
4. Reconcile sub-ledgers (AP, Inventory, Cash) with GL
5. Close period and lock historical data

---

**Document Version:** 2026-05-11 v1.0  
**Owner:** الفريق التقني  
**Next Review:** After Phase 2 Deployment
