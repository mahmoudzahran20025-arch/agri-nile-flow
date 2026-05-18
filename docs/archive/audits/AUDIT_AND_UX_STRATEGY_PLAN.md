# Audit & UX Strategy Plan: Production-Grade ERP System
**Date**: 2026-05-02  
**Branch**: feature/posting-engine-v2  
**Focus**: End-to-End System Quality, Data Integrity → User Trust

---

## EXECUTIVE SUMMARY

Your system is **functionally sound** (GL balanced, 0 orphans, V1 parity confirmed), but needs **three critical improvements** to feel enterprise-grade:

1. **Routing architecture fragility** (sub-routers colliding) — breaks modularity
2. **Data quality gaps** (weak input validation, incomplete required fields) — undermines final number reliability
3. **UI/UX trust gaps** (final numbers not highlighted, reconciliation workflows opaque) — users don't know if they can trust the numbers

**Outcome**: By fixing these three areas systematically, you move from "working app" to **"trusted enterprise system"** where users understand the data flow, verify correctness, and trust the final GL.

---

---

# PART 1: NEXT AUDIT PLAN (Phases & Scope)

## Phase A: Routing & API Stability Audit (1 week)
**Goal**: Verify all GL endpoints are reachable, consistent, and maintainable.

### Scope
| Module | Focus | Key Questions |
|--------|-------|---|
| **GL routing** | Route mounting, path collisions | Are all endpoints resolvable? Do overlapping paths cause shadowing? |
| **Request/Response contracts** | Type safety, schema alignment | Do all endpoints return typed, documented responses? |
| **Error handling** | Standardization across 30+ endpoints | Do all errors follow a common format? Are validation errors clear? |

### Audit Checklist
- [ ] **CAT-1a**: Verify all 50+ GL endpoints return 401 without auth (smoke test coverage)
- [ ] **CAT-1b**: Map all posting-setup routes vs. mounted paths (check for shadowing)
- [ ] **CAT-1c**: Validate request/response types match TypeScript interfaces
- [ ] **CAT-1d**: Test error paths (400, 404, 403, 409, 422) for consistency
- [ ] **CAT-1e**: Check that all endpoints properly isolate by `company_id`
- [ ] **CAT-1f**: Performance: measure 10 sequential GL calls (should be < 500ms total)

### Expected Outcome
- ✅ All endpoints routable and type-safe
- ✅ No route shadowing or collisions
- ✅ Standardized error responses
- ✅ Company isolation verified

---

## Phase B: Data Quality Audit (2 weeks)
**Goal**: Measure how "clean" input data is and where validation gaps exist.

### Scope
| Module | Focus | Key Metrics |
|--------|-------|---|
| **Suppliers** | Posting group assignment, GL account mapping | % with bus_posting_group_code, % with valid GL accounts |
| **Items/Materials** | Product posting group, cost assignment | % with prod_posting_group_code, cost method conflict |
| **Inventory movements** | Warehouse, date, quantity validity | % with wh_id, % with valid_from/valid_to dates |
| **Cash transactions** | Currency, account code, reconciliation | % with currency_code, % matched to bank statements |
| **Supplier invoices** | AP account, PO link, payment term | % with valid AP account, % with PO link |

### Input-to-GL Data Flow
```
Form Input → Operational Table → GL Journal → Trial Balance → Reports
    ↓              ↓                  ↓              ↓            ↓
Validation?   Missing fields?   Rule resolved?   Balanced?    Traceable?
```

### Audit Checklist
- [ ] **CAT-2a**: Run completeness check on all master data
  - `SELECT table_name, COUNT(*) AS total, COUNT(bus_posting_group_code) AS with_bpg FROM suppliers GROUP BY 1`
  - `SELECT COUNT(*) AS items_without_ppg FROM items WHERE prod_posting_group_code IS NULL`
  - `SELECT COUNT(*) AS inv_no_wh FROM inventory_movements WHERE wh_id IS NULL`
  
- [ ] **CAT-2b**: Trace 50 journal entries backward to source document
  - Pick 50 random GL lines
  - Can we identify the source (supplier_invoice, cash_transaction, inventory_movement)?
  - Are all GL fields populated correctly?
  
- [ ] **CAT-2c**: Validate cross-table consistency
  - supplier_invoices.total_amount == SUM(journal_lines) for that invoice?
  - stock_quants.quantity == SUM(inventory_movements)?
  - cash_account balance == SUM(cash_transactions)?
  
- [ ] **CAT-2d**: Check for "orphaned" or "half-filled" records
  - Drafts (unposted for >7 days)
  - Invoices with zero amount
  - Movements without warehouse
  
- [ ] **CAT-2e**: Measure data decay over time
  - How many records haven't been modified in 6 months?
  - How many have conflicting/stale values?

### Key Metrics
- **Data Completeness**: % of critical fields filled (target: ≥95%)
- **Traceability**: % of GL lines that trace back to source document (target: 100%)
- **Cross-table Consistency**: % of amounts matching between operational and GL (target: 100%)
- **Orphan Rate**: % of draft/half-filled records (target: <1%)

### Expected Outcome
- ✅ Identify 5–10 top data quality gaps
- ✅ Understand which modules leak bad data into GL
- ✅ Propose validation rules to prevent future gaps

---

## Phase C: GL-to-Reports Reconciliation (1 week)
**Goal**: Verify final numbers (P&L, Balance Sheet, Trial Balance) are accurate and trust-worthy.

### Scope
| Report | Verification | Key Checks |
|--------|--|--|
| **Trial Balance** | Debit = Credit per account, period integrity | Balanced by design? All accounts reconcile? |
| **Income Statement** | Revenue - Expense = Net Income, period consistency | Correct period filter? Sign convention? |
| **Balance Sheet** | Assets = Liabilities + Equity | Accounting equation holds for all periods? |
| **Ledger (by account)** | Chronological order, running balance, traceability | Can users see entry → line → source? |

### Audit Checklist
- [ ] **CAT-3a**: Trial Balance validation
  - GET /api/gl/reports/trial-balance for each period
  - Verify: total_debit === total_credit
  - Verify: each account_code appears only once
  - Compare with DB: SUM(debit) WHERE period_id=X vs. report number
  
- [ ] **CAT-3b**: Income Statement validation
  - GET /api/gl/reports/income-statement
  - Verify: revenue accounts (4XXXXX) all positive
  - Verify: expense accounts (5XXXXX) all negative
  - Verify: net_income = revenue - expenses
  
- [ ] **CAT-3c**: Balance Sheet validation
  - GET /api/gl/reports/balance-sheet
  - Verify: assets + liabilities + equity = 0 (double-entry bookkeeping)
  - Verify: all balance sheet accounts (1XXX, 2XXX, 3XXX) included
  
- [ ] **CAT-3d**: Ledger integrity
  - GET /api/gl/reports/ledger/:account_code for a sample of 10 high-volume accounts
  - Verify: entries sorted chronologically
  - Verify: running_balance calculated correctly
  - Verify: each entry traces back to journal_entries table
  
- [ ] **CAT-3e**: Period close consistency
  - Verify: closed periods are immutable (no new entries post-close)
  - Verify: closing balances match opening balances of next period

### Expected Outcome
- ✅ Trial Balance verified correct for all periods
- ✅ All reports produce correct sums and sign conventions
- ✅ Traceability: users can click through entry → ledger → source
- ✅ Period close integrity confirmed

---

## Phase D: User Acceptance Testing (UAT) — Operational Flows (2 weeks)
**Goal**: Test real workflows that users care about; verify GL posting happens as expected.

### UAT Scenarios
| Scenario | Operational Flow | GL Verification |
|--|--|--|
| **UAT-01: Supplier Invoice Cycle** | Create PO → Receive → Invoice → Pay → Match bank | COGS/AP posted? GL entry created? AP balance correct? |
| **UAT-02: Inventory Receipt & Movement** | Receive goods → Create inventory movement → Cost allocation | Inventory account updated? COGS posted? Warehouse cost roll-up correct? |
| **UAT-03: Cash Transactions** | Cash out (expense) → Bank transfer → Reconcile | Cash account decremented? GL entry created? Bank statement matched? |
| **UAT-04: Harvest Cycle** | Crop planted → Grow → Harvest → Post-harvest cost → P&L impact | WIP cost capitalized? Harvest GL entry posted? P&L impact correct? |
| **UAT-05: Season Close** | Close season → Carry WIP → Generate P&L → Archive | WIP carried forward? P&L generated? Old season immutable? |

### Audit Checklist per Scenario
For each UAT scenario:
- [ ] **Step 1**: Execute the operational flow (PO → Invoice → Payment)
- [ ] **Step 2**: Query GL for expected journal entry
  - `SELECT * FROM journal_entries WHERE ref_type='supplier_invoice' AND ref_id=X`
- [ ] **Step 3**: Verify lines balance (debit = credit)
- [ ] **Step 4**: Check account role policy resolved correctly
  - `SELECT * FROM journal_lines WHERE entry_id=X AND account_code=Y`
- [ ] **Step 5**: Verify trial balance includes the entry
  - `SELECT SUM(debit), SUM(credit) FROM journal_lines WHERE account_code='YYYY' AND period_id=Z`
- [ ] **Step 6**: Confirm no duplicates or reversals (unless intentional)

### Expected Outcome
- ✅ All 5 major workflows post GL entries correctly
- ✅ Trial Balance reflects operational activity
- ✅ No orphaned or unposted entries
- ✅ Users can trace operational action → GL → reports

---

---

# PART 2: Input → Final Numbers — Data Quality Assessment

## The Quality Chain

```
STAGE 1: Input       STAGE 2: Processing      STAGE 3: GL Output       STAGE 4: Reporting
Form Entry  ────→   Validation & Rules  ──→  Journal Entry  ────→   Trial Balance
  ↓                        ↓                        ↓                      ↓
Do we prevent      Do we enforce correct    Do we balance?        Do final numbers
bad input?         account mapping?          Do we audit?          match reality?
```

### Current State Assessment

#### Strengths ✅
1. **GL foundation is solid**
   - 1,590 journal entries balanced (debit = credit)
   - 3,172 lines traced to 278 active accounts
   - 0 orphaned lines
   - V1 rules intact, V2 multi-currency support added

2. **Atomic posting engine**
   - FinanceCore handles rule resolution, compensating rollbacks
   - Cache invalidation (60s TTL) prevents stale reads
   - Role-based access control (RBAC) enforces who can post

3. **Audit trail in place**
   - logAudit() logs all mutations
   - Journal entries immutable post-posting
   - Reversals tracked (not deletes)

#### Gaps 🔴

| Gap | Impact | Example |
|-----|--------|---------|
| **Form validation too loose** | Bad data enters → GL posting fails silently | Supplier created without bus_posting_group → Invoice posts to CATCH_ALL account |
| **Required fields not enforced** | Half-filled records block reporting | Inventory movement without wh_id → Warehouse balance unreliable |
| **Account mapping not pre-validated** | Wrong GL account used | Item without prod_posting_group → Uses NULL×NULL rule instead of correct rule |
| **No pre-posting validation workflow** | Users discover errors after posting | Invoice posted, then user realizes AP account is wrong |
| **Reports don't highlight "final" status** | Users unsure if numbers are trustworthy | Trial balance shown, but is it closed? Are there unposted entries? |
| **Reconciliation workflows incomplete** | Users can't verify GL matches source | Bank statement shown, but are entries matched to GL? |

---

## Data Quality Improvements by Module

### 1. Suppliers Module
**Current Risk**: Suppliers without posting group → invoices post to fallback rule

**Required Changes**:
```typescript
// FORM VALIDATION (frontend + backend)
- bus_posting_group_code: REQUIRED (select from dropdown, not free text)
- supplier_account_code: AUTO-FILLED (from account role policy for AP)
- default_currency: REQUIRED (default to company currency)

// API VALIDATION (backend)
POST /suppliers: 
  - Reject if bus_posting_group_code not in md_posting_groups
  - Reject if supplier_account_code not in chart_of_accounts
  - Test rule resolution before saving: resolve(bus_posting_group=X, prod_posting_group=NULL) must return valid rule

// DATABASE CONSTRAINT
ALTER TABLE suppliers ADD CONSTRAINT check_posting_group
  CHECK (bus_posting_group_code IS NOT NULL AND bus_posting_group_code IN (SELECT code FROM md_posting_groups))
```

**Validation Checklist**:
- [ ] Supplier form has mandatory dropdown for posting group (no free text)
- [ ] Supplier form shows "GL Account will be X" (preview of resolved account)
- [ ] Backend rejects supplier without posting group
- [ ] Existing suppliers without posting group identified and flagged in UI

---

### 2. Items/Materials Module
**Current Risk**: Items without product posting group → inventory costs post to wrong account

**Required Changes**:
```typescript
// FORM VALIDATION
- prod_posting_group_code: REQUIRED
- costing_method: REQUIRED (ACTUAL, STANDARD, FIFO)
- default_warehouse: OPTIONAL (suggests where inventory is stored)
- unit_cost: AUTO-CALCULATED if costing_method=STANDARD

// API VALIDATION
POST /items:
  - Reject if prod_posting_group_code not valid
  - Reject if costing_method not in allowed list
  - Test rule resolution: resolve(bus_posting_group=NULL, prod_posting_group=X) must return valid rule

// UI FEEDBACK
- Show estimated GL account for inventory: "Inventory will post to: 13500001"
- Show estimated GL account for COGS: "COGS will post to: 45010001"
```

**Validation Checklist**:
- [ ] Item form has mandatory dropdown for product posting group
- [ ] Item form shows "Inventory Account: XXXXX" preview
- [ ] Backend rejects item without product posting group
- [ ] Existing items without product posting group: audit & fix

---

### 3. Inventory Movements Module
**Current Risk**: Movements without warehouse → stock balance unreliable

**Required Changes**:
```typescript
// FORM VALIDATION
- wh_id: REQUIRED (select from warehouses list)
- movement_type: REQUIRED (IN, OUT, TRANSFER, RETURN, ADJUSTMENT)
- ref_type: REQUIRED (PURCHASE_ORDER, SALES_ORDER, PRODUCTION, ADJUSTMENT)
- quantity: REQUIRED & VALIDATED (> 0 for IN/OUT, ≠ 0 for ADJUSTMENT)
- unit_cost: AUTO-FILLED (from current stock valuation)

// API VALIDATION
POST /inventory-movements:
  - Reject if wh_id not in warehouses
  - Reject if movement_type + ref_type combination invalid (e.g., IN without PO is suspicious)
  - Reject if quantity ≤ 0 for IN/OUT movements
  - Calculate future impact: "This movement will decrement wheat stock from 500kg to 350kg"

// FIELD-LEVEL GUARDS
- If movement_type=OUT: verify wh.current_stock >= quantity (prevent negative stock)
- If movement_type=TRANSFER: verify destination warehouse exists
- Backdated movements: flag with "this is historical, impact is N GL lines"
```

**Validation Checklist**:
- [ ] Inventory movement form has mandatory warehouse dropdown
- [ ] Form shows "Stock balance will change from X to Y"
- [ ] Backend rejects movement without warehouse
- [ ] Backend prevents negative stock (unless explicitly allowed)
- [ ] Audit: identify all backdated movements and review for correctness

---

### 4. Cash Transactions Module
**Current Risk**: Cash transactions without proper GL mapping → bank reconciliation breaks

**Required Changes**:
```typescript
// FORM VALIDATION
- transaction_type: REQUIRED (CASH_IN, CASH_OUT, BANK_TRANSFER, CHECK)
- amount: REQUIRED & VALIDATED (> 0, precision to 2 decimals)
- currency_code: REQUIRED (default to company currency)
- counterparty_account: REQUIRED (AP account, AR account, or bank account)
- description: REQUIRED (min 10 chars, describe the transaction)
- gl_account_code: AUTO-FILLED (from account role policy for CASH)

// API VALIDATION
POST /cash-transactions:
  - FX convert to base currency (EGP) if currency_code ≠ company currency
  - Resolve GL account via account role policy (CASH role)
  - Verify counterparty_account exists in chart_of_accounts
  - Reject if amount is zero or negative

// RECONCILIATION LINK
- Bank statement import: auto-match by amount + date ± 1 day
- Manual match UI: show unmatched GL entries vs. unmatched bank entries
- Reconciliation status: "3 GL entries matched, 2 unmatched (need manual review)"
```

**Validation Checklist**:
- [ ] Cash transaction form has mandatory currency and account dropdowns
- [ ] Form shows "GL Account: 14010101 (Cash)" before posting
- [ ] Backend rejects transaction without amount or currency
- [ ] Bank reconciliation page shows matched vs. unmatched count

---

### 5. Supplier Invoices → AP Module
**Current Risk**: Invoices with missing AP account or payment terms → aging report unreliable

**Required Changes**:
```typescript
// FORM VALIDATION
- supplier_id: REQUIRED
- total_amount: REQUIRED & VALIDATED (> 0)
- payment_term: REQUIRED (NET30, NET60, COD, IMMEDIATE)
- due_date: AUTO-CALCULATED (from payment_term)
- po_id: OPTIONAL (but recommended for audit trail)
- invoice_date: REQUIRED
- invoice_number: REQUIRED (unique per supplier)

// API VALIDATION
POST /supplier_invoices:
  - Fetch supplier.bus_posting_group_code
  - Resolve AP account: resolveAccountByRole('AP', company_id)
  - Verify AP account exists and is liability type
  - Calculate due_date = invoice_date + payment_term_days
  - Reject if supplier doesn't exist or has no posting group

// GL POSTING
When invoice is confirmed:
  - DR PURCHASES account (from posting rule)
  - CR AP account (resolved from account role policy)
  - Create journal entry with full traceability
```

**Validation Checklist**:
- [ ] Invoice form shows supplier posting group and resolved AP account
- [ ] Form calculates and shows due date
- [ ] Backend rejects invoice without supplier or amount
- [ ] AP aging report shows all invoices with correct due dates

---

---

## Data Quality Metrics Dashboard

**Create a new page**: `FinanceDataQualityPage.tsx`

```typescript
interface QualityMetric {
  category: string
  metric_name: string
  current_value: number
  target_value: number
  status: 'pass' | 'warning' | 'fail'
}

const metrics: QualityMetric[] = [
  // Supplier Data Quality
  { category: 'Suppliers', metric_name: '% with posting group', current_value: 85, target_value: 100, status: 'warning' },
  { category: 'Suppliers', metric_name: '% with active account', current_value: 90, target_value: 100, status: 'warning' },
  
  // Item Data Quality
  { category: 'Items', metric_name: '% with product posting group', current_value: 78, target_value: 100, status: 'fail' },
  { category: 'Items', metric_name: '% with costing method', current_value: 95, target_value: 100, status: 'pass' },
  
  // Movement Quality
  { category: 'Movements', metric_name: '% with warehouse', current_value: 88, target_value: 100, status: 'warning' },
  { category: 'Movements', metric_name: 'Orphan rate (%)', current_value: 0.5, target_value: 0, status: 'pass' },
  
  // GL Integrity
  { category: 'GL', metric_name: 'Unbalanced entries', current_value: 0, target_value: 0, status: 'pass' },
  { category: 'GL', metric_name: 'Unposted pending entries', current_value: 9, target_value: 5, status: 'warning' },
  { category: 'GL', metric_name: 'Traceability (source → GL)', current_value: 97, target_value: 100, status: 'warning' },
]
```

---

---

# PART 3: UX & UI Impact for Enterprise-Grade Use

## What "Enterprise-Grade" Means for UX

| Characteristic | Today | Target |
|--|--|--|
| **Clarity** | Users uncertain what they're posting | Users see exactly what will happen (preview) |
| **Consistency** | Same data shown differently across pages | Unified vocabulary (AP = "Accounts Payable") |
| **Trust** | "Did my entry post correctly?" | Clear green checkmark showing entry is posted + GL impact |
| **Traceability** | Hard to find source of GL line | One click: entry → ledger → source document |
| **Error Handling** | Vague error messages | Clear guidance: "Supplier is missing posting group. Choose one from: ..." |

---

## Critical UX Improvements

### 3.1 Forms: Input Quality & Preview

#### Pattern: Pre-Action Preview
Every form that creates GL entries should show "GL Impact Preview" before posting.

**Example: Supplier Invoice Form**
```
┌─────────────────────────────────────────────────┐
│ New Supplier Invoice                            │
├─────────────────────────────────────────────────┤
│ Supplier:        [Dropdown: "Nile Seeds"]       │
│ Amount:          5,000                          │
│ Due Date:        2026-06-02 (auto-calculated)   │
│ Invoice Date:    2026-05-02                     │
├─────────────────────────────────────────────────┤
│ ⚡ GL IMPACT PREVIEW                            │
│ When posted, this will create:                  │
│                                                  │
│  DR Purchases (45020001)         5,000 EGP     │
│  CR Accounts Payable (21100001)   5,000 EGP    │
│                                                  │
│  Status: ✅ Balanced (debit=credit)            │
│  Supplier: ✅ Has posting group (DOMESTIC)     │
│  AP Account: ✅ Exists and is liability type   │
│                                                  │
│ [PREVIEW ERROR] ❌ Missing: PO link (optional  │
│                but recommended)                 │
├─────────────────────────────────────────────────┤
│ [Back]                              [Post Entry]│
└─────────────────────────────────────────────────┘
```

**Implementation**:
- When form loads: `POST /api/gl/preview` with partial data
- Real-time updates as user changes fields
- Show blockers (red), warnings (yellow), all-clear (green)
- Users see exactly what GL entry will be created

---

#### Pattern: Mandatory vs. Optional with Clear Labels
Current form: all fields look the same  
Target: distinguish required, optional, auto-filled

**Example: New Item Form**
```
REQUIRED (must fill)
  Product Name:          [Textbox: "Wheat Seed"]
  Product Posting Group: [Dropdown ↓] ← RED border: REQUIRED
  Costing Method:        [ACTUAL | STANDARD | FIFO] ← RED border
  Default Unit:          [kg] ← RED border

OPTIONAL (nice-to-have)
  Description:           [Textbox]
  Reorder Threshold:     [Number] (gray label: optional)
  Supplier Code:         [Textbox] (gray label: optional)

AUTO-FILLED (calculated)
  Inventory GL Account:  13500001 ← Locked, based on posting group
  COGS GL Account:       45010001 ← Locked, based on posting group
  Created At:            2026-05-02 ← Locked
```

**CSS Pattern**:
```css
.field--required label::after { content: " *"; color: red; }
.field--optional label { color: #888; font-size: 0.9em; }
.field--auto-filled { background: #f0f0f0; pointer-events: none; }
```

---

### 3.2 Final Numbers: Clarity & Trust

#### Pattern: Highlight "Final Status" on Reports

**Trial Balance Page - Before**:
```
Account Code | Name              | Debit    | Credit
13500001     | Inventory         | 50,000   |
21100001     | Accounts Payable  |          | 35,000
40000001     | Sales Revenue     |          | 200,000
...
Total                             | 500,000  | 500,000
```

**Trial Balance Page - After (with trust indicators)**:
```
┌─────────────────────────────────────────────┐
│ TRIAL BALANCE — April 2026 (DRAFT)          │  ← Status badge
├─────────────────────────────────────────────┤
│ ⏱️ Last Updated: 2026-05-02 14:35:22         │  ← Timestamp
│ 📊 Entries Included: 1,590 total            │  ← Count
│ ⚠️ 9 Unposted Entries (will be posted soon) │  ← Warning if any
│                                              │
│ Status: ✅ BALANCED (debit = credit)        │  ← Green if balanced
│                                              │
Account Code | Name              | Debit    | Credit
13500001     | Inventory         | 50,000   |
21100001     | Accounts Payable  |          | 35,000
40000001     | Sales Revenue     |          | 200,000
...
Total                             | 500,000  | 500,000

┌─────────────────────────────────────────────┐
│ 🔍 DRILL-DOWN CAPABILITY                    │
│ Click account code to view ledger           │
│ Click ledger entry to view journal entry    │
│ Click journal entry to view source doc      │
└─────────────────────────────────────────────┘
```

**HTML Structure**:
```tsx
<TrialBalance>
  <Header status="draft|closed|final" timestamp={...} entryCount={...} />
  <UnpostedWarning count={9} />
  <BalanceIndicator debit={500000} credit={500000} isBalanced={true} />
  <DataTable columns={...} onRowClick={handleDrillDown} />
</TrialBalance>
```

---

#### Pattern: Traceability Chain (Click-Through Journey)

**From Report → Ledger → Journal Entry → Source Document**

```
TRIAL BALANCE (User clicks "13500001 Inventory")
    ↓
ACCOUNT LEDGER (Shows all debits/credits to Inventory)
  Entry 1234: 2026-04-15 | DR 5,000 (Supplier Invoice)
    ↓
  (User clicks entry 1234)
    ↓
JOURNAL ENTRY (Shows both lines)
  Entry 1234: DR 13500001 (Inventory) 5,000
             CR 45020001 (Purchases)  5,000
    ↓
  (User clicks "Source: Supplier Invoice #INV-2026-0042")
    ↓
SUPPLIER INVOICE (Shows original document)
  Supplier: Nile Seeds
  Amount: 5,000 EGP
  Status: ✅ Posted (GL entry 1234)
  ← Back to Ledger
```

**Implementation**:
```typescript
// Ledger row shows: "Supplier Invoice #INV-2026-0042"
// User clicks → navigate(`/suppliers/invoices/${invoice_id}`)
// Invoice detail shows: "Posted as GL Entry #1234"
// User clicks → navigate(`/gl/entries/${entry_id}`)
```

---

### 3.3 Error Handling: Guidance Instead of Vagueness

#### Pattern: Actionable Error Messages

**Bad**: ❌
```
"Error 409: Conflict"
```

**Good**: ✅
```
"Cannot create supplier. This supplier code already exists.
Existing Supplier: Nile Farming Co.
Options:
  1. Use a different code
  2. View existing supplier → [Link]
  3. Update existing supplier → [Link]
"
```

**Bad**: ❌
```
"Error: Invalid posting group"
```

**Good**: ✅
```
"Cannot save item. Product posting group is required.
Available options:
  • DOMESTIC (most items)
  • IMPORTED (foreign goods)
  • SERVICES (non-inventory items)
  
Choose one from the dropdown above, then try again.
"
```

**Bad**: ❌
```
"Error: Rule not resolved"
```

**Good**: ✅
```
"Cannot post invoice. Posting rule not found.
Details:
  Supplier: Nile Seeds (BPG=DOMESTIC)
  Item: Wheat Seed (PPG=GRAIN)
  Warehouse: Main Store
  
No posting rule matches this combination.
Action Required:
  1. Create a posting rule for:
     Business Posting Group = DOMESTIC
     Product Posting Group = GRAIN
     Warehouse = Main Store
  2. Or use a catch-all rule (NULL × NULL)
  
[Create Rule]  [Use Catch-All]
"
```

---

### 3.4 Reconciliation Workflows: Opacity → Clarity

#### Current State: Reconciliation is Hidden
- Bank statements imported
- Entries posted
- Users don't know: "Are entries matched? Which ones are unmatched?"

#### Target: Reconciliation Status is Front & Center

**New Reconciliation Hub Page**:
```tsx
export default function ReconciliationHub() {
  return (
    <div>
      <KpiStrip items={[
        { label: 'Bank Statements', value: 42, variant: 'default' },
        { label: 'Unmatched GL Entries', value: 7, variant: 'warning' },
        { label: 'Matched This Month', value: 95, variant: 'success' },
        { label: 'Reconciliation Rate', value: '93.1%', variant: 'warning' },
      ]} />
      
      <Section title="Outstanding Items Requiring Action">
        <Table 
          columns={['Date', 'Amount', 'Type', 'Status', 'Action']}
          rows={unmatched_items}
          onRowClick={item => drillToMatch(item)}
        />
      </Section>
      
      <Section title="Reconciliation History">
        {/* Last 10 reconciliations */}
      </Section>
    </div>
  )
}
```

**Match Workflow**:
```
1. User sees: "2 GL entries unmatched to bank statement"
2. Click → Shows: 
   GL Entry: Check #1234, 5,000 EGP, 2026-04-15
   Bank Entry: "Check 1234", 5,000 EGP, 2026-04-16
3. User clicks "Match"
4. System: Marks both as matched, journal entry status updates
5. Reconciliation rate: 93.1% → 95.2%
```

---

---

# PART 4: Concrete Recommendations

## Quick Wins (This Month)

### 1. Form Validation Rules
**Impact**: Immediate data quality improvement  
**Effort**: 2-3 days  
**What to do**:

- [ ] Suppliers: Make bus_posting_group_code mandatory (enforce with DB constraint)
- [ ] Items: Make prod_posting_group_code mandatory
- [ ] Inventory movements: Make wh_id mandatory
- [ ] Cash transactions: Make currency_code mandatory
- [ ] Invoices: Make supplier_id and amount mandatory

**How**:
```sql
ALTER TABLE suppliers ADD CONSTRAINT NOT NULL (bus_posting_group_code);
ALTER TABLE items ADD CONSTRAINT NOT NULL (prod_posting_group_code);
ALTER TABLE inventory_movements ADD CONSTRAINT NOT NULL (wh_id);
```

**Frontend**:
```tsx
// Supplier form
<Select 
  label="Business Posting Group *"
  required={true}
  options={postingGroups}
  error={form.bus_posting_group_code ? '' : 'Required'}
/>
```

---

### 2. GL Impact Preview
**Impact**: Users see exactly what GL entry will be created before posting  
**Effort**: 3-4 days  
**What to do**:

- [ ] Add `POST /api/gl/preview` endpoint
- [ ] Takes partial invoice/movement data
- [ ] Returns: expected GL entry (debit/credit lines)
- [ ] Returns: validation checks (supplier has posting group? GL account exists?)
- [ ] Frontend renders preview in real-time as user types

**Example Endpoint**:
```typescript
config.post('/preview', async (c) => {
  const { company_id } = getUser(c)
  const { ref_type, supplier_id, amount, currency_code } = await c.req.json()
  
  // Fetch supplier
  const supplier = await db.prepare('SELECT bus_posting_group_code FROM suppliers WHERE id=?').bind(supplier_id).first()
  
  // Resolve posting rule
  const rule = await resolvePostingRule(db, {
    bus_posting_group: supplier.bus_posting_group_code,
    prod_posting_group: null,
  })
  
  // Calculate lines
  const lines = [
    { account: rule.purchases_account, debit: amount, credit: 0 },
    { account: rule.ap_account, debit: 0, credit: amount },
  ]
  
  // Validation
  const checks = {
    has_posting_group: !!supplier.bus_posting_group_code,
    has_ap_account: !!rule.ap_account,
    is_balanced: amount === amount, // debit === credit
  }
  
  return c.json({
    success: true,
    data: {
      expected_lines: lines,
      validation_checks: checks,
      is_ready_to_post: Object.values(checks).every(v => v),
    }
  })
})
```

---

### 3. Unposted Entries Dashboard
**Impact**: Users see what's waiting to be posted  
**Effort**: 1-2 days  
**What to do**:

- [ ] Create `UnpostedEntriesWidget.tsx`
- [ ] Show: Count of unposted entries, oldest unposted date, action to post
- [ ] Add to Finance Home Page (FinanceHomePage.tsx)
- [ ] Add warning badge if >5 unposted entries

**Widget**:
```tsx
function UnpostedEntriesWidget() {
  const { data: entries } = useQuery({
    queryKey: ['gl-unposted'],
    queryFn: () => glApi.entries({ is_posted: 0 })
  })
  
  return (
    <SectionCard title="Pending Posting" icon={<AlertTriangle />}>
      {entries?.length > 0 ? (
        <>
          <div className="text-3xl font-bold">{entries.length}</div>
          <p className="text-sm text-slate-500">Oldest: {entries[0].created_at}</p>
          <button onClick={handlePostAll}>Post All Now</button>
        </>
      ) : (
        <p className="text-green-600">✅ All entries posted</p>
      )}
    </SectionCard>
  )
}
```

---

### 4. Route Stability Fixes
**Impact**: Removes technical debt, makes code maintainable  
**Effort**: 2 days  
**What to do**:

- [ ] Fix route mounting in `src/api/gl/index.ts`
  - Move from `gl.route('/', postingSetup)` to `gl.route('/posting-setup', postingSetup)`
  - Update all sub-routers to use relative paths
  - Test all 50+ endpoints still resolve

**Before**:
```typescript
gl.route('/', postingSetup)   // collides with others
gl.route('/', batchJobs)      // collides
```

**After**:
```typescript
gl.route('/posting-setup', postingSetup)
gl.route('/batch-post', batchJobs)
```

---

### 5. Trial Balance Status Indicators
**Impact**: Users know if trial balance is final or still changing  
**Effort**: 1 day  
**What to do**:

- [ ] Update `FinancialStatementsPage.tsx`
- [ ] Add status badge: "Draft" or "Closed"
- [ ] Add last updated timestamp
- [ ] Add unposted entries warning (if any)

**Component**:
```tsx
<div className="flex items-center gap-4">
  <h1>Trial Balance</h1>
  <StatusBadge status={period.status} /> {/* DRAFT | CLOSED */}
  <span className="text-sm text-gray-500">Last updated: {lastUpdated}</span>
  {unpostedCount > 0 && (
    <WarningBadge>⚠️ {unpostedCount} unposted entries</WarningBadge>
  )}
</div>
```

---

## Medium-Term Improvements (Next 2–3 Months)

### Phase 1: Data Quality (2 weeks)
**Impact**: Eliminate bad data at source  
**Effort**: 5 days  

- [ ] Audit all suppliers → % with posting group (expect ~85%)
  - Flag suppliers without posting group in UI
  - Create bulk update form to add missing posting groups
  
- [ ] Audit all items → % with product posting group (expect ~78%)
  - Flag items without posting group
  - Bulk update form
  
- [ ] Audit inventory movements → % with warehouse (expect ~88%)
  - Fix backdated movements without warehouse
  
- [ ] Generate Data Quality Report (metrics dashboard)
  - Show: % completeness by module
  - Show: trend (improving or declining?)

---

### Phase 2: Reconciliation Workflows (3 weeks)
**Impact**: Users can verify GL matches source documents  
**Effort**: 10 days  

- [ ] Build ReconciliationHub page
  - List unmatched GL entries
  - List unmatched bank statements
  - Match workflow: drag & drop or manual select
  
- [ ] Bank reconciliation algorithm
  - Auto-match by amount ± 1 day
  - Manual match UI for remainder
  
- [ ] Supplier reconciliation
  - Match invoices to POs
  - Match payments to invoices
  
- [ ] Inventory reconciliation
  - Match stock_quants to GL balance

---

### Phase 3: Traceability UI (2 weeks)
**Impact**: One click from report to source document  
**Effort**: 7 days  

- [ ] Implement drill-down chain:
  - Trial Balance → Ledger → Journal Entry → Source
  
- [ ] Add breadcrumb navigation
  - "Trial Balance > Account 13500001 > Entry 1234 > Supplier Invoice"
  
- [ ] Implement `onRowClick` handlers across pages

---

### Phase 4: GL Posting Dashboard (2 weeks)
**Impact**: Operational visibility of what's posting and what's not  
**Effort**: 8 days  

- [ ] Build `PostingOperationsDashboard.tsx`
  - Batch posting jobs (status, progress)
  - Event-to-GL resolution (how many rules matched? how many fell back?)
  - Error log (which events failed to post?)
  
- [ ] Real-time monitoring
  - WebSocket updates as jobs run
  - or 5s polling with React Query

---

### Phase 5: Form Validation Framework (2 weeks)
**Impact**: Consistent validation across all forms  
**Effort**: 10 days  

- [ ] Create reusable `FormValidator` hook
  - Field-level validation (required, type, format)
  - Cross-field validation (supplier must have posting group)
  - Server-side error feedback
  
- [ ] Apply to all forms:
  - Supplier form
  - Item form
  - Inventory movement form
  - Invoice form
  - etc.

---

---

# SUMMARY: Roadmap

| Phase | Focus | Timeline | Impact |
|-------|-------|----------|--------|
| **Quick Wins** | Form validation, GL preview, route fixes | Week 1 | Immediate UX improvement, technical debt reduction |
| **Phase 1** | Data quality audit & fixes | Week 2-3 | Eliminate bad data at source |
| **Phase 2** | Reconciliation workflows | Week 4-6 | Users can verify GL matches reality |
| **Phase 3** | Traceability UI | Week 7-8 | One-click navigation from report to source |
| **Phase 4** | GL posting dashboard | Week 9-10 | Operational visibility |
| **Phase 5** | Form validation framework | Week 11-12 | Consistent, enterprise-grade form experience |

**By end of this roadmap**: Your system shifts from "working ERP" to **"trusted enterprise system"** where:
- ✅ Users cannot enter bad data
- ✅ Users see exactly what GL entry will be created
- ✅ Users trust the final numbers (trial balance is balanced, entries are traceable)
- ✅ Users can verify GL matches source documents
- ✅ Operations are visible (what's posting, what's not)

---

## Success Criteria

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| **Data completeness** | ~85% suppliers with posting group | ≥99% | Phase 1 |
| **Form validation** | Loose (user can enter bad data) | Strict (all required fields validated) | Quick Wins + Phase 5 |
| **Trial Balance clarity** | Numbers shown, status unknown | Status badge + traceability chain | Quick Wins + Phase 3 |
| **Reconciliation rate** | Unknown (no tracking) | ≥95% of bank entries matched | Phase 2 |
| **Error resolution time** | Users confused ("why did posting fail?") | Users see exact error + action (pick from list) | Quick Wins + Phase 5 |
| **User confidence** | "Is this number correct?" | "Yes, I can trace it to the source" | All phases |

---

**Next Step**: Prioritize Quick Wins this month, then sequence Phases 1-5 based on team capacity and business priorities.
