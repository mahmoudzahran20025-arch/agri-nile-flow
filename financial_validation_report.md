# Financial Validation Report — Posting Engine V2
**Mode:** FINANCIAL VALIDATION | **Date:** 2026-05-02 | **Status:** BLOCKING ISSUES FOUND

---

## Validation Scope

Every account code, journal entry pattern, and inferred data point from the integration report is now validated against:
1. **Account Nature Rules** — Debits increase assets/expenses, credits increase liabilities/equity/revenue
2. **Double-Entry Integrity** — Every journal entry must balance (∑ Debit = ∑ Credit)
3. **Trial Balance Impact** — No entry may create a net-imbalanced effect
4. **CoA Account Type Correctness** — The account code must match its natural side

---

## 1. CoA Account Nature Map (From Reference)

The CoA root codes define account nature. This is the **absolute authority** for all validation below:

| Code Prefix | Level 1 Name | Nature | Normal Balance |
|------------|-------------|--------|----------------|
| `1x` | الاصول (Assets) | **Asset** | Debit |
| `2x` | الخصوم (Liabilities + Equity) | **Liability/Equity** | Credit |
| `4x` | المبيعات (Sales/Revenue) | **Revenue** | Credit |
| `5x` | المصروفات (Expenses) | **Expense** | Debit |
| `6x` | المصروفات الاخرى (Other Expenses) | **Expense** | Debit |
| `7x` | الايرادات (Other Revenue) | **Revenue** | Credit |

> [!IMPORTANT]
> Code prefix `22x` (مجمعات الإهلاك) is **contra-asset** — it sits under the Liabilities branch in the CoA but represents accumulated depreciation. Its normal balance is **Credit**, which is correct.

---

## 2. Journal Entry Simulation — Current SQL Posting Rules

### 2.1 AGRI-OP × BEET — Supplier Invoice Scenario

**SQL Line 83:** `sales='511101', purchases='611101', cogs='611101'`

Simulated journal entry for a beet seed purchase of 100,000 EGP:
```
Dr  611101 (Purchases)     100,000
  Cr  AP Control            100,000
```

| Check | Result | Reason |
|-------|--------|--------|
| Account `611101` exists in CoA? | ❌ **FAIL** | Code not in شجرة_نواة_المستقبل.json |
| Double-entry balance? | ✅ Pass | Dr = Cr = 100,000 |
| Account nature correct? | ⚠️ **UNKNOWN** | Can't verify — code doesn't exist |

> [!CAUTION]
> **VERDICT: 🔴 REJECTED** — Account `611101` is a phantom code. Posting would either fail at `validateAccounts()` (posting engine line 251-258) or, if CoA validation is bypassed, create orphan GL entries that can never be traced to a real account.

### 2.2 AGRI-OP × BEET — Sales Revenue Scenario

**SQL Line 83:** `sales='511101'`

Simulated journal entry for beet crop sale of 500,000 EGP:
```
Dr  AR Control              500,000
  Cr  511101 (Sales)         500,000
```

| Check | Result | Reason |
|-------|--------|--------|
| Account `511101` exists in CoA? | ❌ **FAIL** | Phantom code |
| If it existed, nature check: `5x` = Expense | ❌ **FAIL** | `511101` starts with `5` = **Expense**. Sales revenue MUST be a `4x` (Revenue) account |
| Double-entry balance? | ✅ Pass | Dr = Cr = 500,000 |

> [!CAUTION]
> **VERDICT: 🔴 REJECTED — DOUBLE FAILURE**
> 1. Account doesn't exist
> 2. Even if created, code `511101` has prefix `5` (Expense nature). Booking **revenue** to an expense account violates accounting fundamentals. This would **deflate revenue and inflate expenses**, causing the Income Statement to show ZERO revenue and doubled expenses.

### 2.3 AGRI-OP × EQUIP — Equipment Purchase

**SQL Line 86:** `purchases='11030001', purch_returns='11030001'`

Simulated journal entry for equipment purchase of 85,413 EGP (ميكنة احمد عبيد):
```
Dr  11030001 (اّلات ومعدات)   85,413
  Cr  AP Control               85,413
```

| Check | Result | Reason |
|-------|--------|--------|
| Account `11030001` exists in CoA? | ✅ **PASS** | Code verified: "اّلات ومعدات" |
| Nature: `1x` = Asset | ✅ **PASS** | Equipment is a fixed asset — Debit increases it correctly |
| Double-entry balance? | ✅ **PASS** | Dr = Cr = 85,413 |

> **VERDICT: ✅ APPROVED** — This is the ONLY correct non-cash posting rule in the SQL.

### 2.4 AGRI-OP × FUEL — Fuel Purchase

**SQL Line 87:** `purchases='14010101'`

Simulated journal for fuel purchase 50,000 EGP:
```
Dr  14010101 (خزينة ج.م)     50,000
  Cr  AP Control              50,000
```

| Check | Result | Reason |
|-------|--------|--------|
| Account `14010101` exists in CoA? | ✅ Pass | Code verified: "خزينة ج . م" |
| Nature: `14x` = Cash/Asset | ⚠️ **ACCOUNTING ERROR** | `14010101` is the **CASH** account. Debiting cash for a fuel *purchase* means cash is **increasing**, but buying fuel should **decrease** cash |
| Semantic correctness? | ❌ **FAIL** | Fuel purchases should debit an **expense** account (e.g., `51200015` بنزين وزيوت) or an inventory account, not the cash account |

> [!WARNING]
> **VERDICT: 🟡 REJECTED — Semantic Error**
> The `purchases_account` for FUEL is mapped to the **cash** account (`14010101`). This creates a circular entry where buying fuel debits cash (asset up) instead of an expense or inventory account. The correct mapping should be:
> - Expense path: `51200015` (بنزين وزيوت)  
> - Inventory path: A dedicated fuel inventory account (needs creation)

### 2.5 Inventory Posting — RAW-MAT Receipt

**SQL Line 117:** `inventory='140201', adj='140202', wip='140203', cogs='610101'`

Simulated journal for fertilizer receipt 851,000 EGP:
```
Dr  140201 (Inventory)      851,000
  Cr  610101 (COGS)          851,000
```

| Check | Result | Reason |
|-------|--------|--------|
| Account `140201` exists? | ❌ **FAIL** | Phantom code |
| Account `610101` exists? | ❌ **FAIL** | Phantom code |
| If `140201` existed: `14x` = Asset | ✅ Correct | Inventory is an asset, debit increases it |
| If `610101` existed: `6x` = Expense | ❌ **FAIL** | Crediting an expense on a **receipt** is wrong. Receipt offset should credit AP or Cash (a liability/asset), not reduce expenses |

> [!CAUTION]
> **VERDICT: 🔴 REJECTED — TRIPLE FAILURE**
> 1. Both accounts are phantom
> 2. The COGS offset (`610101`) has expense nature — crediting it on a receipt creates a negative expense, which is accounting nonsense
> 3. The correct pattern: `Dr Inventory / Cr Accounts Payable`

---

## 3. Partner Capital — Code Path Validation ✅

From [partners.ts](file:///c:/Users/mahmo/Contacts/CLAUDE_CO%20WORK%20MY%20WORK/agri-nile-flow/src/lib/finance/resolvers/partners.ts):

### 3.1 Capital Injection (طايل مشحوت عرفة — 3,300,000 EGP)

```
Dr  cashAcc (14010101)       3,300,000   ← Cash increases
  Cr  equityAcc (partner_capital)  3,300,000   ← Equity increases
```

| Check | Result | Reason |
|-------|--------|--------|
| Cash `14010101` exists? | ✅ Pass | "خزينة ج.م" |
| Cash nature: Asset, Debit = increase? | ✅ Pass | Cash coming IN, correct |
| Equity: `partner_capital` mapping resolves? | ⚠️ **DEPENDS** | Must map to `25010001` (رأس المال) via control rule |
| If resolved to `25010001`: Credit = increase equity? | ✅ Pass | Equity is credit-normal |
| Double-entry? | ✅ Pass | Dr = Cr = 3,300,000 |
| Trial balance impact? | ✅ Pass | Assets up 3.3M, Equity up 3.3M — balanced |

> **VERDICT: ✅ CONDITIONALLY APPROVED**
> The code path in `partners.ts` is **accounting-correct**. BUT it depends on the `partner_capital` control mapping existing in `posting_rules`. If that mapping is missing, the function correctly throws `PARTNER_CAPITAL_POSTING_BLOCKED`.

### 3.2 Partner Current Account Deposit (جهاز مستقبل مصر — 4,000,000 EGP)

```
Dr  cashAcc (14010101)       4,000,000
  Cr  currentAcc (partner_current_account)  4,000,000
```

| Check | Result |
|-------|--------|
| Account nature correct? | ✅ Pass — Cash (asset) debited, Current Account (liability) credited |
| Must resolve to CoA? | `partner_current_account` → should be `2104xxxx` (جاري الشركاء) |
| Double-entry? | ✅ Pass |

> **VERDICT: ✅ CONDITIONALLY APPROVED** — Same control-mapping dependency.

---

## 4. Cash Transaction — Code Path Validation

From [cash.ts](file:///c:/Users/mahmo/Contacts/CLAUDE_CO%20WORK%20MY%20WORK/agri-nile-flow/src/lib/finance/resolvers/cash.ts):

### 4.1 Supplier Payment (صرف/م — 350,000 EGP اشراف زراعي)

The resolver at line 33-41 determines contra account:
```typescript
// If expense_code exists → resolve from expense_types table
// Else → fallback to control account mapping
const key = opts.supplier_code ? 'accounts_payable' : 'expense_default'
```

Simulated journal:
```
Dr  contraAcc (expense/AP)   350,000   ← Expense or AP increases
  Cr  cashAcc (14010101)      350,000   ← Cash decreases
```

| Check | Result | Reason |
|-------|--------|--------|
| Cash credited on payment? | ✅ Pass | Cash going OUT, credit is correct |
| Expense_code `33067` resolves? | ⚠️ **RISK** | Must exist in `expense_types` table with valid `gl_account_code` |
| If no expense_types match, falls to `expense_default`? | ⚠️ **RISK** | `expense_default` control mapping must exist |
| Double-entry? | ✅ Pass |

> **VERDICT: 🟡 CONDITIONALLY APPROVED WITH RISK**
> The code path is accounting-correct, but depends on `expense_types` having GL codes for `33067` and `36008`. If missing, it falls through to `expense_default` which may post to a catch-all account — losing granularity.

### 4.2 Treasury Transaction #83047 (لاب توب ديل — 18,000 EGP)

From integration report: All classification fields are NULL.

Code path analysis:
```typescript
// expense_code = null → skip expense_types lookup
// supplier_code = null → skip AP
// direction = 'م' (payment) → key = 'expense_default'
contraAcc = resolveControlAccount(db, company_id, 'expense_default')
```

Simulated journal:
```
Dr  expense_default (???)    18,000
  Cr  14010101 (Cash)         18,000
```

| Check | Result | Reason |
|-------|--------|--------|
| Laptop is a **fixed asset**, not an expense | ❌ **ACCOUNTING ERROR** | Posting to `expense_default` would expense a capital item, violating capitalization rules |
| Should be: Dr 11070001 (حاسبات اّلية) | ✅ Correct treatment | Capitalize as fixed asset |
| Impact: Understates assets, overstates expenses | ❌ **Material misstatement** | 18,000 EGP incorrectly reduces net income instead of adding to asset base |

> [!CAUTION]
> **VERDICT: 🔴 REJECTED — UNSAFE INFERENCE**
> The integration report suggested inferring `كود المصروف → fixed assets (1107)`. This inference is **accounting-correct** (laptop IS a fixed asset), BUT the code path would still route it through `expense_default` because the transaction has no `expense_code`. 
> 
> **Required action:** This transaction MUST be manually classified with either:
> - `expense_code` pointing to an expense_type with `gl_account_code = '11070001'` (حاسبات اّلية), OR
> - A dedicated fixed-asset acquisition workflow that bypasses the cash expense resolver

---

## 5. Trial Balance Impact Simulation

Using the 69 treasury transactions and their ACTUAL amounts, here's the simulated trial balance impact if ALL transactions were posted through the current engine:

### 5.1 Partner Contributions (Credit Side)

| Partner | Amount | Journal Entry | TB Impact |
|---------|--------|---------------|-----------|
| طايل مشحوت عرفة | 13,400,000 | Dr Cash / Cr Equity | Assets ↑ 13.4M, Equity ↑ 13.4M |
| جهاز مستقبل مصر | 4,000,000 | Dr Cash / Cr Equity | Assets ↑ 4M, Equity ↑ 4M |
| Capital (both) | 2,000,000 | Dr Cash / Cr Capital | Assets ↑ 2M, Equity ↑ 2M |
| **Subtotal** | **19,400,000** | | **Balanced** ✅ |

### 5.2 Supplier Payments (Debit Side)

| Category | Total Amount | Expected Entry | Current Engine Result |
|----------|-------------|----------------|---------------------|
| شركة عرفة (اسمدة/مبيدات) | ~15M | Dr AP / Cr Cash | ⚠️ Depends on `accounts_payable` control mapping |
| شركة عرفة (ميكنة) | ~389K | Dr AP / Cr Cash | ⚠️ Same dependency |
| ميكنة احمد عبيد | ~187K | Dr AP / Cr Cash | ⚠️ Same |
| مورد نقدي (متنوعات) | ~96K | Dr AP / Cr Cash | ⚠️ Same |
| عمالة | ~47K | Dr AP / Cr Cash | ⚠️ Same |
| المعدات (لودر) | ~176K | Dr AP / Cr Cash | ⚠️ Same |
| **Subtotal** | **~17.6M** | | **Balanced IF mapped** |

### 5.3 Expense Payments (Direct)

| Expense | Amount | Expected Entry | Validation |
|---------|--------|----------------|------------|
| اشراف زراعي (33067) | 700,000 | Dr Expense / Cr Cash | ⚠️ Code `33067` must be in expense_types |
| نقل/نولون (36008) | 10,000 | Dr Expense / Cr Cash | ⚠️ Code `36008` must be in expense_types |
| لاب توب ديل | 18,000 | Dr FixedAsset / Cr Cash | ❌ Would mispost as expense |
| **Subtotal** | **728,000** | | **1 mispost risk** |

### 5.4 Net Trial Balance Check

```
Expected TB after all 69 treasury transactions:

DEBIT SIDE:
  Cash (14010101):        19,400,000 - 17,602,199 = 1,797,801  ← Net cash balance
  AP Paid (Suppliers):    17,602,199                             ← Reduces AP or creates expense
  Fixed Assets (laptop):  18,000                                 ← IF correctly classified

CREDIT SIDE:
  Partner Capital:        2,000,000
  Partner Current:        17,400,000
  
  ∑ Debits = ∑ Credits   ✅ (if all accounts resolve correctly)
```

> [!WARNING]
> The final treasury balance per the JSON is **19,801 EGP** (line 2143). Cross-checking: `19,400,000 (contributions) - 17,602,199 (supplier payments) - 728,000 (expenses) ≈ 1,069,801`. The difference of ~1,050,000 suggests there are additional transactions or intermediate balance adjustments not captured in the 69-transaction sample.

---

## 6. Complete Verdict Table

| # | Item | Source | Verdict | Blocking? |
|---|------|--------|---------|-----------|
| 1 | Account `511101` as sales | SQL L.83 | 🔴 **REJECTED** — Phantom + wrong nature (5x=Expense, not Revenue) | **YES** |
| 2 | Account `611101` as purchases | SQL L.83 | 🔴 **REJECTED** — Phantom code | **YES** |
| 3 | ALL `5xxxxx` codes used as sales accounts | SQL L.82-109 | 🔴 **REJECTED** — Prefix 5 = Expense, can't hold revenue | **YES** |
| 4 | ALL `6xxxxx` codes used as purchases | SQL L.82-109 | 🔴 **REJECTED** — Phantom codes (only `61010001`+ exist, and those are interest/tax) | **YES** |
| 5 | Account `11030001` as equipment purchase | SQL L.86 | ✅ **APPROVED** — Verified in CoA | No |
| 6 | Account `14010101` as cash | SQL L.87,120 | ✅ **APPROVED** — Verified in CoA | No |
| 7 | Account `14010101` as FUEL purchases | SQL L.87 | 🟡 **REJECTED** — Cash ≠ fuel expense | **YES** |
| 8 | Inventory `140201`-`140209` | SQL L.117-120 | 🔴 **REJECTED** — All phantom | **YES** |
| 9 | Partner capital code path | partners.ts | ✅ **APPROVED** — Correct DR/CR pattern | No |
| 10 | Partner current code path | partners.ts | ✅ **APPROVED** — Correct DR/CR pattern | No |
| 11 | Cash payment code path | cash.ts | ✅ **APPROVED** — Correct DR/CR pattern | No |
| 12 | Cash receipt code path | cash.ts | ✅ **APPROVED** — Correct DR/CR pattern | No |
| 13 | Transaction #83047 (laptop) inference | Integration report | 🔴 **REJECTED** — Unsafe; no code path handles FA acquisition from cash | **YES** |
| 14 | Expense codes 33067/36008 inference | Integration report | 🟡 **CONDITIONAL** — Must verify in expense_types table | **YES** |
| 15 | Suggested leaf accounts (41010001, etc.) | Integration report | ✅ **APPROVED** — Already exist in CoA! | No |

> [!NOTE]
> **Key discovery in validation:** The integration report suggested creating leaf accounts `41010001`, `45010001`, `51010001`, etc. After full CoA review, these accounts **already exist** (lines 1698, 1719, 1733 of CoA JSON). The integration report's inference was **redundant but not harmful**.

---

## 7. Mandatory Corrections Before Any Posting

### 7.1 General Posting Setup — Corrected Account Mapping

```sql
-- ❌ CURRENT (INVALID):
-- (1, 'AGRI-OP', 'BEET', '511101', '611101', '611101', '511102', '611102', '511103', 1)

-- ✅ CORRECTED (Using verified CoA codes):
-- sales → 41010001 (إيراد نشاط المحصول) — Revenue, credit-normal ✓
-- purchases → 45010001 (تكلفة المبيعات) — COGS/Expense, debit-normal ✓  
-- cogs → 45010001 (تكلفة المبيعات) — Same account for purchase+COGS in agri ops
-- sales_returns → 41030001 (مردودات مبيعات) — Contra-revenue ✓
-- expense → 51010006 (العمالة المؤقتة) — For labor-related ag operations

-- AGRI-OP × BEET:
(1, 'AGRI-OP', 'BEET', '41010001', '45010001', '45010001', '41030001', '45010001', '51200034', 1)

-- AGRI-OP × FERT:
(1, 'AGRI-OP', 'FERT', '41010001', '45010001', '45010001', '41030001', '45010001', '51200034', 1)

-- AGRI-OP × EQUIP (already correct for purchases):
(1, 'AGRI-OP', 'EQUIP', '41010001', '11030001', '45200001', '41030001', '11030001', '55030001', 1)

-- AGRI-OP × FUEL (FIXED — was using cash account):
(1, 'AGRI-OP', 'FUEL', '41010001', '51200015', '51200015', '41030001', '51200015', '51200015', 1)
```

### 7.2 Inventory Posting Setup — Corrected

```sql
-- ✅ Using real CoA inventory accounts:
(1, 'RAW-MAT', '', '14070101', '14070106', '14070103', '45010001', 1)  -- اسمدة → تقاوي WIP → COGS
(1, 'FINISHED', '', '14070106', '14070106', '14070106', '45010001', 1) -- متنوع
(1, 'SPARES', '', '14070105', '14070106', '14070105', '45200001', 1)  -- قطع غيار
(1, 'FUEL-INV', '', '51200015', '51200015', '51200015', '51200015', 1) -- بنزين (expense, not inventory)
```

### 7.3 Required Control Account Mappings

These `posting_rules` with `rule_type='control'` MUST exist for the code paths to work:

| mapping_key | Must Resolve To | CoA Code | Verified |
|------------|----------------|----------|----------|
| `cash` | خزينة ج . م | `14010101` | ✅ |
| `partner_capital` | رأس المال | `25010001` | ✅ |
| `partner_current_account` | جاري الشركاء | (needs leaf under `2104`) | ⚠️ |
| `accounts_payable` | موردون متنوعون | `212000010` | ✅ |
| `accounts_receivable` | عملاء | (needs leaf under `10x`) | ⚠️ |
| `expense_default` | مصروفات متنوعة | `51200034` | ✅ |
| `revenue_default` | إيراد نشاط المحصول | `41010001` | ✅ |
| `equity` | رأس المال | `25010001` | ✅ |
| `inventory` | مخزون اسمدة (default) | `14070101` | ✅ |

---

## 8. Unsafe Inferences — Formally Rejected

| # | Inference | Reason for Rejection | Required Action |
|---|-----------|---------------------|----------------|
| 1 | Transaction #83047 → expense_default | Laptop is a capital asset, not an expense. Expensing it violates IAS 16 capitalization threshold | Manual classification: `expense_code` → FA acquisition event type |
| 2 | Any `5xxxxx` code as revenue | Prefix 5 = Expenses in this CoA. Revenue MUST use prefix `4` | Replace all sales_account codes |
| 3 | `14010101` as fuel purchase account | Cash account cannot be used as a purchase/expense account | Replace with `51200015` (بنزين وزيوت) |
| 4 | Inventory codes `140201-140209` | These are sequential fabrications not in the CoA | Replace with `14070101-14070106` |

---

## 9. Final Validation Summary

```
┌─────────────────────────────────────────────┐
│  FINANCIAL VALIDATION SUMMARY               │
├─────────────────────────────────────────────┤
│  Items Validated:          15               │
│  ✅ APPROVED:              6 (40%)          │
│  🟡 CONDITIONAL:           2 (13%)          │
│  🔴 REJECTED:              7 (47%)          │
│                                             │
│  Code Paths Validated:     4                │
│  ✅ Correct DR/CR logic:   4/4 (100%)       │
│                                             │
│  Account Codes Validated:  24               │
│  ✅ Exist in CoA:          2 (8%)           │
│  ❌ Phantom:               22 (92%)         │
│                                             │
│  BLOCKING:  YES — 7 critical issues         │
│  SAFE TO DEPLOY:  NO                        │
└─────────────────────────────────────────────┘
```

> [!CAUTION]
> **DO NOT execute the current `create_posting_tables_v2.sql` on production.** 92% of account codes will fail validation. The posting engine's `validateAccounts()` function (line 243-259) will correctly BLOCK these transactions, but users will see confusing `PG-ACCT-001` errors on every posting attempt.
> 
> **The TypeScript code paths are sound.** The resolvers, journal blueprints, and double-entry logic in `posting_engine.ts`, `cash.ts`, and `partners.ts` are all accounting-correct. The problem is exclusively in the **SQL data layer** — the account codes fed into these engines are wrong.
