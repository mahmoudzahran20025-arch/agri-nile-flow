# EXECUTION CHECKLIST: Phase 2 & 3 Implementation

**Prepared:** May 11, 2026  
**Owner:** Technical Team + Finance Manager  
**Purpose:** Step-by-step checklist for Phase 2 → Phase 3 execution  
**Format:** Copy-paste ready commands + verification queries  

---

## PHASE 2: SCHEMA & API HARDENING (Week 1: May 13-17)

### ✅ PRE-DEPLOYMENT CHECKLIST

- [ ] Network connectivity verified (wrangler --version works)
- [ ] All specification docs reviewed + approved
  - [ ] PHASE_2_API_HARDENING_SPECIFICATION.md ← Finance Manager signed
  - [ ] PHASE_3_CANONICAL_REENTRY_TEMPLATES.md ← Ops Manager reviewed
  - [ ] PHASE_2_3_EXECUTIVE_SUMMARY.md ← Executive briefed
- [ ] Git repo clean, current branch backed up
- [ ] D1 database backed up
- [ ] Team notified of deployment window (no new data entry during deployment)

---

## DAY 1: MONDAY MAY 13 — SCHEMA DEPLOYMENT

### Step 1: Execute Service Taxonomy Schema

```bash
# Navigate to project
cd 'c:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow'

# Deploy Phase 2 schema (service_types, supplier_service_map, governance_flags)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/governance/05_phase2_service_taxonomy_and_mapping.sql

# Expected output: "Executed X commands in Y ms" (no errors)
```

**Verification Query:**
```bash
# Verify schema created
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) AS service_type_count FROM service_types WHERE company_id=1 AND is_active=1;"

# Expected: 7 (SRV_MECH, SRV_LABOR, SRV_SUPPLY, SRV_LOGISTICS, SRV_SUPERVISION, SRV_SPARE_PARTS, SRV_ADMIN)

npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) AS mapping_count FROM supplier_service_map WHERE company_id=1 AND is_active=1;"

# Expected: 11+ (all suppliers mapped to their services)

npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('service_types', 'supplier_service_map', 'movement_governance_flags');"

# Expected: 3 (all three tables exist)
```

**Document result:**
```
Timestamp: _______________
Status: ✅ Complete / ❌ Failed
Service Types Created: ___ (expected 7)
Mappings Created: ___ (expected 11+)
Issues: _____________
Approver Sign-Off: _______________
```

### Step 2: Backfill Legacy Transactions

```bash
# Populate statement_text + service_type_code for existing transactions
# This is deterministic mapping (no manual intervention)

npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "UPDATE supplier_transactions SET statement_text = COALESCE(statement_text, notes) WHERE company_id=1 AND statement_text IS NULL AND notes IS NOT NULL;"

npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "UPDATE cash_transactions SET statement_text = COALESCE(statement_text, narration) WHERE company_id=1 AND statement_text IS NULL AND narration IS NOT NULL;"

npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "UPDATE supplier_transactions SET service_type_code='SRV_MECH' WHERE company_id=1 AND service_type_code IS NULL AND supplier_code IN (20100033, 20300086, 20300121);"

# ... (continue for other supplier mappings per template in 05_phase2_*.sql)
```

**Verification:**
```bash
# Count how many still have NULL service_type_code
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) AS null_count FROM supplier_transactions WHERE company_id=1 AND status='posted' AND service_type_code IS NULL;"

# Document result: expect decline from initial count (some deterministic mapping applied)
```

### Step 3: Identify Gaps with Governance Flags

```bash
# Mark any transactions that still lack mandatory dimensions
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "INSERT OR IGNORE INTO movement_governance_flags (company_id, source_module, source_table, source_id, flag_code, severity, flag_status, flag_details) SELECT 1, 'suppliers', 'supplier_transactions', id, 'MISSING_SERVICE_TYPE', 'error', 'open', 'Posted TX lacks service_type_code' FROM supplier_transactions WHERE company_id=1 AND status='posted' AND service_type_code IS NULL;"
```

**Document Gap Analysis:**
```
Total supplier transactions with service_type_code = NULL: ___
Total inventory movements with service_type_code = NULL: ___
Total cash transactions with financial_account_code = NULL: ___

Action: These gaps are ACCEPTED for historical data.
        NEW transactions MUST have these fields (API enforced).
```

---

## DAY 2-3: TUESDAY-WEDNESDAY MAY 14-15 — API CODE CHANGES

### Step 1: Update suppliers.ts

**File:** `src/api/suppliers.ts`

Find the POST /api/suppliers/transactions handler and add this validation (BEFORE INSERT):

```typescript
// ✅ ADD THIS VALIDATION BLOCK (after body parsing, before INSERT)

// Validate mandatory fields for new transactions
if (!body.statement_text || body.statement_text.trim().length < 3) {
  return c.json({ 
    success: false, 
    error: 'statement_text مطلوب وليجب أن يكون 3 أحرف على الأقل' 
  }, 422)
}

// If debit > 0, service_type_code is mandatory
if ((body.debit ?? 0) > 0) {
  if (!body.service_type_code) {
    return c.json({ 
      success: false, 
      error: 'service_type_code مطلوب للحركات المدينة (الحركات عملاء)' 
    }, 422)
  }
  
  // Verify service_type_code exists and is active
  const serviceType = await c.env.DB.prepare(
    'SELECT * FROM service_types WHERE company_id = ? AND code = ? AND is_active = 1 LIMIT 1'
  ).bind(company_id, body.service_type_code).first()
  
  if (!serviceType) {
    return c.json({ 
      success: false, 
      error: `service_type_code '${body.service_type_code}' غير معروف أو غير نشط` 
    }, 422)
  }
}

// Verify supplier-service mapping (if mapping table exists and is used)
if (body.service_type_code) {
  const mapping = await c.env.DB.prepare(
    'SELECT * FROM supplier_service_map WHERE company_id = ? AND supplier_code = ? AND service_type_code = ? AND is_active = 1 LIMIT 1'
  ).bind(company_id, body.supplier_code, body.service_type_code).first()
  
  if (!mapping) {
    console.warn(`SUPPLIER_SERVICE_MISMATCH: supplier ${body.supplier_code} not mapped for ${body.service_type_code}`)
    // For now, WARN only; can be stricter later
  }
}
```

**Document status:**
- [ ] Code change implemented
- [ ] Tested locally (no TypeScript errors)
- [ ] Ready for deployment

### Step 2: Update inventory/movements.ts

**File:** `src/api/inventory/movements.ts`

The ISSUE validation is already in place (see validateInventoryGovernance function). Verify it's correct:

```typescript
// ✅ VERIFY THIS EXISTS IN validateInventoryGovernance():

if (input.movement_type === 'ISSUE') {
  if (input.center_code == null) {
    throw new Error('ISSUE_REQUIRES_CENTER')
  }
  if (!statementText || statementText.length < 3) {
    throw new Error('ISSUE_REQUIRES_STATEMENT')
  }
  if (!serviceTypeCode) {
    throw new Error('ISSUE_REQUIRES_SERVICE_TYPE')
  }
}
```

**Document status:**
- [ ] Validation logic verified in code
- [ ] Test cases prepared (3 valid ISSUE, 3 invalid ISSUE)

### Step 3: Update treasury.ts

**File:** `src/api/treasury.ts` (or treasury/cash_transactions.ts)

Find the POST /api/treasury/cash-transactions handler and add:

```typescript
// ✅ ADD THIS VALIDATION BLOCK (after body parsing, before INSERT)

// Validate mandatory fields
if (!body.financial_account_code) {
  return c.json({ 
    success: false, 
    error: 'financial_account_code مطلوب - يجب تحديد حساب GL للنقود' 
  }, 422)
}

if (!body.statement_text || body.statement_text.trim().length < 3) {
  return c.json({ 
    success: false, 
    error: 'statement_text مطلوب وليجب أن يكون 3 أحرف على الأقل' 
  }, 422)
}

// Verify GL account exists and is cash/bank type
const account = await c.env.DB.prepare(
  `SELECT * FROM chart_of_accounts 
   WHERE company_id = ? AND account_code = ? AND account_type IN ('CASH', 'BANK')
   LIMIT 1`
).bind(company_id, body.financial_account_code).first()

if (!account) {
  return c.json({ 
    success: false, 
    error: `حساب GL '${body.financial_account_code}' غير موجود أو ليس نقد/بنك` 
  }, 422)
}

// Verify supplier_code if provided
if (body.supplier_code) {
  const supplier = await c.env.DB.prepare(
    'SELECT * FROM suppliers WHERE company_id = ? AND code = ? LIMIT 1'
  ).bind(company_id, body.supplier_code).first()
  
  if (!supplier) {
    return c.json({ 
      success: false, 
      error: `مورد برقم '${body.supplier_code}' غير موجود` 
    }, 422)
  }
}
```

**Document status:**
- [ ] Code change implemented
- [ ] Tested locally
- [ ] Ready for deployment

### Step 4: Compile & Test Locally

```bash
# Compile TypeScript
npm run build

# Expected: 0 errors, 0 warnings

# Run test suite (if available)
npm run test -- src/api/suppliers.test.ts
npm run test -- src/api/inventory/movements.test.ts
npm run test -- src/api/treasury.test.ts

# Expected: All tests pass
```

**Document result:**
```
Build Status: ✅ Success / ❌ Failed
Test Results: ___ passed, ___ failed
Issues: _______________
```

---

## DAY 4: THURSDAY MAY 16 — DEPLOYMENT

### Step 1: Deploy to Cloudflare Workers

```bash
# Deploy backend changes
npm run backend:deploy:prod

# Expected: "✅ Deployment successful" message
# Note the version/deployment ID for reference
```

**Document deployment:**
- [ ] Deployment ID: __________________
- [ ] Timestamp: _______________
- [ ] Status: ✅ Success / ❌ Failed

### Step 2: Verify Deployed API (Smoke Test)

**Test Case 1: VALID Supplier Invoice (with service_type_code)**
```bash
# Create PowerShell script: test_supplier_valid.ps1

$token = "YOUR_AUTH_TOKEN"  # Replace with actual token
$body = @{
  supplier_code = 20900353
  transaction_type = "INVOICE"
  document_number = 999999
  document_date = "2026-05-16"
  debit = 100000
  credit = 0
  statement_text = "فاتورة اختبار API hardening - اسمدة"
  service_type_code = "SRV_SUPPLY"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "https://pharma-cloud-backend.mahmoud-once2026.workers.dev/api/suppliers/transactions" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
  } `
  -Body $body `
  -ErrorAction Stop

$response | ConvertTo-Json | Write-Host
```

**Expected Result:**
```json
{
  "success": true,
  "data": {
    "id": 123456,
    "supplier_code": 20900353,
    "service_type_code": "SRV_SUPPLY",
    "statement_text": "فاتورة اختبار API hardening - اسمدة",
    ...
  }
}
```

**Test Case 2: INVALID Supplier Invoice (MISSING service_type_code)**
```bash
# Same as above, but remove service_type_code from body
# Expected: 422 Unprocessable Entity
# Error message: "service_type_code مطلوب للحركات المدينة"
```

**Test Case 3: VALID ISSUE Movement**
```bash
$body = @{
  movement_date = "2026-05-16"
  movement_type = "ISSUE"
  item_code = 1000
  warehouse = "WH_NORTH"
  quantity = 100
  center_code = 1006011
  service_type_code = "SRV_LABOR"
  statement_text = "صرف اسمدة لبيفوت 11 - عمالة - اختبار API"
} | ConvertTo-Json

# Expected: 201 Created
```

**Test Case 4: INVALID ISSUE (MISSING center_code)**
```bash
# Remove center_code and service_type_code from body
# Expected: 422 Unprocessable Entity
# Error: "ISSUE_REQUIRES_CENTER"
```

**Test Case 5: VALID Cash Transaction**
```bash
$body = @{
  transaction_date = "2026-05-16"
  direction = "م"
  amount = 50000
  statement_text = "سداد فاتورة عرفة - اختبار API hardening"
  financial_account_code = "1204"
  supplier_code = 20900353
  document_number = 999999
  service_type_code = "SRV_SUPPLY"
} | ConvertTo-Json

# Expected: 201 Created
```

**Test Case 6: INVALID Cash Transaction (MISSING financial_account_code)**
```bash
# Remove financial_account_code from body
# Expected: 422 Unprocessable Entity
# Error: "financial_account_code مطلوب"
```

**Document Test Results:**
```
Test Case 1 (Valid Supplier): ✅ Pass / ❌ Fail
Test Case 2 (Invalid Supplier): ✅ Pass / ❌ Fail
Test Case 3 (Valid ISSUE): ✅ Pass / ❌ Fail
Test Case 4 (Invalid ISSUE): ✅ Pass / ❌ Fail
Test Case 5 (Valid Cash): ✅ Pass / ❌ Fail
Test Case 6 (Invalid Cash): ✅ Pass / ❌ Fail

Overall: ✅ PASS (all 6 tests pass) / ❌ FAIL (some tests failed)

Issues (if any): _______________
```

---

## DAY 5: FRIDAY MAY 17 — MONITORING & DATA ANALYSIS

### Step 1: Run Daily Control Queries

```bash
# Stream live logs during tests
npx wrangler tail

# (Run test cases 1-6 in another terminal while watching logs)
```

### Step 2: Verify Governance Flags

```bash
# Query open governance flags
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT flag_code, COUNT(*) AS cnt FROM movement_governance_flags WHERE company_id=1 AND flag_status='open' GROUP BY flag_code;"

# Document any new flags that appeared
```

### Step 3: Check API Usage Metrics

```bash
# (If monitoring is available) Review error rates for new error codes:
# - SERVICE_TYPE_CODE_REQUIRED
# - ISSUE_REQUIRES_SERVICE_TYPE
# - FINANCIAL_ACCOUNT_CODE_REQUIRED
# - STATEMENT_TEXT_REQUIRED

# Expected: Very few errors (these are new validations; users will need to adapt)
```

### Step 4: Sign-Off & Notification

**Prepare communications:**
- [ ] Technical summary (schema deployed, API hardening active)
- [ ] User notification (new mandatory fields + error messages)
- [ ] FAQ doc (common errors + how to fix them)

**Document Phase 2 Completion:**
```
Phase 2 Status: ✅ COMPLETE
Date Completed: _______________
Approval Signature: _______________

Summary:
- ✅ Service taxonomy deployed (7 services, 11+ mappings)
- ✅ API validation enforced (6 test cases pass)
- ✅ Governance flags operational
- ✅ Monitoring active

Next Phase: Phase 3 Data Wipe & Re-Entry (Week 3-4)
```

---

## PHASE 3: FULL DATA WIPE & RE-ENTRY (Week 3-4: May 27 - Jun 7)

### ✅ PRE-WIPE CHECKLIST

- [ ] Phase 2 verification complete + approved
- [ ] Final backup of current data taken
  - [ ] Backup exported to CSV (suppliers, items, transactions)
  - [ ] Backup exported to SQL dump (full schema + data)
- [ ] D1 test environment set up (staging database for dry-run)
- [ ] All re-entry SQL scripts prepared (05_*.sql files)
- [ ] Finance Manager & Ops Manager sign-off obtained
- [ ] Go/No-Go decision made (CEO/Owner approval)

### MONDAY MAY 27 — FULL DATA WIPE

```bash
# ⚠️ THIS IS THE POINT OF NO RETURN ⚠️
# Execute only after all approvals obtained and backup verified

# Step 1: Final verification that backup is safe
ls -lh backup/  # Verify backup file size is reasonable (>10MB for full data)
file backup/*   # Verify file type (SQL dump or CSV)

# Step 2: Execute full cleanup
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/governance/04_full_clean_reseed_scope_company1.sql

# Step 3: VERIFY ALL OPERATIONAL TABLES ARE EMPTY
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT 'suppliers' tbl, COUNT(*) cnt FROM suppliers WHERE company_id=1 
   UNION ALL SELECT 'items', COUNT(*) FROM items WHERE company_id=1 
   UNION ALL SELECT 'supplier_transactions', COUNT(*) FROM supplier_transactions WHERE company_id=1 
   UNION ALL SELECT 'cash_transactions', COUNT(*) FROM cash_transactions WHERE company_id=1 
   UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements WHERE company_id=1 
   UNION ALL SELECT 'journal_entries', COUNT(*) FROM journal_entries WHERE company_id=1;"

# Expected: All counts = 0
```

**Document wipe result:**
```
Wipe Execution: ✅ Success / ❌ Failed
Timestamp: _______________
Issues: _______________

Verification Result:
suppliers: 0
items: 0
supplier_transactions: 0
cash_transactions: 0
inventory_movements: 0
journal_entries: 0

Status: ✅ VERIFIED CLEAN
```

### TUESDAY-WEDNESDAY MAY 28-29 — MASTER DATA RE-ENTRY

```bash
# Execute in order (master data first, then transactions)

# Step 1: Cost Centers (reference data)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/10_cost_centers.sql

# Verify
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) AS cnt FROM cost_centers WHERE company_id=1;"
# Expected: ~11 (one per pivot + admin centers)

# Step 2: Suppliers
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/20_suppliers.sql

# Verify
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT code, name FROM suppliers WHERE company_id=1 ORDER BY code;"
# Expected: 8-10 supplier rows

# Step 3: Items (Inventory Master)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/30_items.sql

# Verify
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) AS item_count FROM items WHERE company_id=1;"
# Expected: 100-500 items (depending on data scope)
```

**Document master data status:**
```
Cost Centers: ___ rows (expected ~11)
Suppliers: ___ rows (expected 8-10)
Items: ___ rows (expected 100-500)

Status: ✅ Complete / ⚠️ Investigate
```

### THURSDAY-FRIDAY MAY 30-31 — TRANSACTION RE-ENTRY (PHASED)

```bash
# Execute transactions in chronological order (important for inventory balance calculations)

# Step 1: Capital Injections (Nov 2025)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/40_capital_injections.sql

# Verify
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) FROM cash_transactions WHERE company_id=1 AND statement_text LIKE '%رأس المال%';"

# Step 2: Supplier Invoices (Nov 2025)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/50_supplier_invoices_nov_2025.sql

# Verify
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) FROM supplier_transactions WHERE company_id=1 AND transaction_date >= '2025-11-01' AND transaction_date < '2025-12-01';"

# Step 3: Supplier Invoices (Dec 2025)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/50_supplier_invoices_dec_2025.sql

# Step 4: Supplier Invoices (Jan 2026)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/50_supplier_invoices_jan_2026.sql

# Step 5: Inventory GRNs
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/60_inventory_grns.sql

# Verify inventory receipt counts
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) FROM inventory_movements WHERE company_id=1 AND movement_type='GRN';"

# Step 6: Supplier Payments
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/70_supplier_payments.sql

# Step 7: Inventory Issuances
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/80_inventory_issuances.sql

# Verify ISSUE counts
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) FROM inventory_movements WHERE company_id=1 AND movement_type='ISSUE';"
```

**Document transaction re-entry status:**
```
Capital Injections: ___ (expected 2)
Supplier Invoices (Nov): ___ (expected ~20-30)
Supplier Invoices (Dec): ___ (expected ~50-100 — peak month)
Supplier Invoices (Jan): ___ (expected ~30-50)
GRNs: ___ (expected ~100+)
Payments: ___ (expected ~50-100)
Issues: ___ (expected ~200-500)

Total Transactions: ___
Status: ✅ Complete / ⚠️ Investigate
```

### MONDAY-WEDNESDAY JUN 3-5 — POSTING ENGINE EXECUTION & RECONCILIATION

```bash
# Step 1: Execute posting engine
npm run scripts -- execute_posting_job.js --company_id=1 --cutoff=2026-05-31 --mode=deterministic

# Monitor logs
npx wrangler tail

# Wait for completion (should be <5 minutes for 500-1000 transactions)
```

**Document posting result:**
```
Posting Job: ✅ Success / ❌ Failed
Timestamp: _______________
Total JE Created: ___
Total Lines Posted: ___
Errors: ___
```

### Step 2: Reconciliation Checks

```bash
# Run reconciliation query pack
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/governance/03_daily_finance_control_query_pack.sql

# Key verifications:
# 1. AP Balance = sum(supplier_transactions.debit - supplier_transactions.credit)
# 2. Inventory Balance = sum(inventory_movements.qty_in - qty_out) per item
# 3. GL Balance = sum(journal_entry_lines.debit) = sum(journal_entry_lines.credit)
# 4. Cash Balance = sum(cash_transactions) by account

# Compare with GL chart accounts balance snapshot
# Expected: all sub-ledgers = GL accounts (within rounding)
```

**Document reconciliation:**
```
AP Reconciliation: ✅ Pass / ❌ Fail (variance: ___)
Inventory Reconciliation: ✅ Pass / ❌ Fail (variance: ___)
GL Reconciliation: ✅ Pass / ❌ Fail (variance: ___)
Cash Reconciliation: ✅ Pass / ❌ Fail (variance: ___)

Overall Reconciliation: ✅ PASS / ❌ FAIL
```

### THURSDAY-FRIDAY JUN 6-7 — FINAL VERIFICATION & SIGN-OFF

```bash
# Step 1: Verify canonical data quality (no NULL mandatory fields in NEW data)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) AS issues FROM (
     SELECT * FROM supplier_transactions WHERE company_id=1 AND statement_text IS NULL
     UNION ALL
     SELECT * FROM inventory_movements WHERE company_id=1 AND movement_type='ISSUE' AND service_type_code IS NULL
     UNION ALL
     SELECT * FROM cash_transactions WHERE company_id=1 AND financial_account_code IS NULL
   );"

# Expected: 0 (NO issues)

# Step 2: Verify governance flags (should be ZERO for re-entered data)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT COUNT(*) FROM movement_governance_flags WHERE company_id=1 AND flag_status='open';"

# Expected: 0

# Step 3: Lock historical period
# (Set database flag or run period-close script)
# After this, NO modifications to historical data allowed

# Step 4: Enable monitoring cron job
# Ensure daily_finance_control.ps1 is scheduled in Task Scheduler
# Verify it runs tomorrow morning at 08:00

# Step 5: Notify users
# Email: "System cutover complete. NEW data entry follows canonical model. Please use updated API."
```

**Document Final Sign-Off:**
```
All Checks Passed: ✅ YES / ❌ NO

Data Quality: ✅ Pass (0 NULL mandatory fields)
Governance Flags: ✅ Pass (0 open flags)
Reconciliation: ✅ Pass (all sub-ledgers = GL)
Period Locked: ✅ Yes
Monitoring Active: ✅ Yes

AUTHORIZATION TO GO-LIVE:
Finance Manager: _______________  Date: ___
Technical Lead: _______________  Date: ___
CEO/Owner: _______________  Date: ___

IMPLEMENTATION COMPLETE: ✅ SUCCESS
Date: _______________
```

---

## POST-CUTOVER OPERATIONS (Ongoing)

### Daily (Every Morning at 08:00)
```bash
# Run control query pack
Invoke-Expression -Command "& 'C:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow\scripts\run_daily_finance_control.ps1'"

# Review output in: reports/monitoring/daily_runs/daily_control_*.json

# If ANY metric deviates from baseline → alert finance team immediately
```

### Weekly (Every Friday)
```bash
# Review governance flags (open issues)
# Review API error logs (any new validation failures)
# Review transaction volumes (trends)
```

### Monthly (Last day of month)
```bash
# Run full reconciliation
# Generate financial statements
# Lock period in database
```

---

## ROLLBACK PROCEDURE (If Something Goes Wrong)

### If Phase 2 API Fails:
```bash
# Revert code changes
git revert HEAD  # Revert last commit
npm run backend:deploy:prod  # Re-deploy old version

# Notify team: revert in progress, investigating issue
```

### If Phase 3 Wipe Was Premature:
```bash
# Restore from backup
# This is why we take multiple backups!
mysql -u root agri-nile-flow < backup/agri-nile-flow_2026-05-26.sql

# Alert stakeholders: restoration in progress
```

### If Posting Engine Creates Unbalanced GL Entries:
```bash
# PAUSE the system
# Query: SELECT * FROM journal_entries WHERE company_id=1 AND is_balanced=0
# Investigate unbalanced entries
# Fix business logic in posting_engine
# Re-run on corrected data
```

---

## SUCCESS CRITERIA FINAL CHECK

- [ ] ✅ Service taxonomy deployed and verified (7 services)
- [ ] ✅ API validation enforced (all 6 test cases pass)
- [ ] ✅ Data wipe executed cleanly (all operational tables = 0)
- [ ] ✅ Master data re-entered (suppliers, items, cost centers)
- [ ] ✅ Transactions re-entered in canonical format
- [ ] ✅ GL entries generated deterministically (posting engine works)
- [ ] ✅ All sub-ledgers reconciled to GL (0 variance)
- [ ] ✅ Period locked (no historical modifications allowed)
- [ ] ✅ Daily monitoring active (governance flags captured)
- [ ] ✅ NEW transactions follow canonical model (API enforced)
- [ ] ✅ Team trained on new system (error messages understood)
- [ ] ✅ User documentation updated (mandatory fields explained)

**FINAL STATUS: ✅ IMPLEMENTATION COMPLETE**

---

**Document Version:** 2026-05-11 v1.0  
**Prepared by:** Technical Team  
**Print & Post:** In team workspace (for easy reference during execution)  
**Next Update:** After Phase 2 Completion (May 17)
