# Phase 3: Canonical Re-Entry Data Templates & Format Specification

**Status:** Specification Draft (May 11, 2026)  
**Purpose:** Define canonical data format for clean re-entry after full data wipe  
**Scope:** All operational master data and transactions  
**Timeline:** Ready for execution when Phase 2 deployed + D1 connectivity restored  

---

## 1. Overview: Why Canonical Format?

After full cleanup (DELETE all operational rows), re-entry must follow **canonical format** to:
- ✅ Avoid recreating the ambiguity and data quality issues of the past
- ✅ Enforce dimensional consistency at entry time (not post-hoc via backfill)
- ✅ Enable automated GL posting from day 1 (posting rules engine is deterministic)
- ✅ Create audit trail that aligns with tax/legal requirements
- ✅ Support proper cost allocation to pivots, seasons, and service types

---

## 2. Master Data Re-Entry Templates

### 2.1 Suppliers (Master Data)

#### Schema: suppliers table
```sql
CREATE TABLE suppliers (
  code INTEGER PRIMARY KEY,                  -- Legacy supplier code
  company_id INTEGER,
  name TEXT NOT NULL,
  activity TEXT,                            -- Supplier activity description
  gl_account_code TEXT,                     -- Default GL account (for single-service suppliers)
  gl_subaccount_code TEXT,                  -- Subaccount code (e.g., for AP splits)
  is_active INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
```

#### Re-Entry Template (CSV Format)
```csv
code,name,activity,service_type_code_primary,service_type_code_secondary,notes
20100033,عمرو السمالوسي - لودر,Equipment Rental,SRV_MECH,,Single service supplier - fixed 842.857 EGP/hour
20300086,عيد شعبان - لودر,Equipment Rental,SRV_MECH,,Single service supplier - loader hire
20300121,ميكنة احمد عبيد,Mechanization,SRV_MECH,,Single service supplier - equipment operator
21400002,احمد دسوقي - عمالة,Labor Supply,SRV_LABOR,,Fixed daily rate 325 EGP per worker
21400108,ابراهيم رمضان الكيلاوي,Labor Supply,SRV_LABOR,,Premium labor supervisor
20900353,شركة عرفة للتصدير والتنمية الزراعية,Mixed: Materials + Supervision,SRV_SUPPLY,SRV_SUPERVISION,CRITICAL: Split into two service streams for GL routing
20800286,مورد نقدي,Misc Small Purchases,SRV_SPARE_PARTS,,Cash supplier for tools and small items
```

#### SQL Re-Entry Script
```sql
-- Re-entry: Suppliers (Phase 3)
-- Inserts canonical supplier records for company_id = 1

BEGIN TRANSACTION;

INSERT INTO suppliers 
(code, company_id, name, activity, is_active, created_at)
VALUES
(20100033, 1, 'عمرو السمالوسي - لودر', 'Equipment Rental', 1, '2026-05-15'),
(20300086, 1, 'عيد شعبان - لودر', 'Equipment Rental', 1, '2026-05-15'),
(20300121, 1, 'ميكنة احمد عبيد', 'Mechanization', 1, '2026-05-15'),
(21400002, 1, 'احمد دسوقي - عمالة', 'Labor Supply', 1, '2026-05-15'),
(21400108, 1, 'ابراهيم رمضان الكيلاوي', 'Labor Supply', 1, '2026-05-15'),
(20900353, 1, 'شركة عرفة للتصدير والتنمية الزراعية', 'Mixed Services', 1, '2026-05-15'),
(20800286, 1, 'مورد نقدي', 'Misc Purchases', 1, '2026-05-15');

-- Verify insertion
SELECT code, name, activity FROM suppliers WHERE company_id = 1 ORDER BY code;

COMMIT;
```

---

### 2.2 Items (Inventory Master)

#### Schema: items table
```sql
CREATE TABLE items (
  code INTEGER PRIMARY KEY,
  company_id INTEGER,
  name TEXT NOT NULL,
  unit TEXT,
  warehouse_type TEXT,               -- e.g., 'FERTILIZER', 'SEEDS', 'CHEMICALS', 'SPARE_PARTS'
  density_factor REAL,               -- For لتر ↔ كجم conversion (if applicable)
  is_active INTEGER,
  created_at DATETIME
);
```

#### Re-Entry Template (Sample: Top 10 Items by Historical Volume)
```csv
code,name,unit,warehouse_type,density_factor
1000,حمض الفوسفوريك,لتر,FERTILIZER,0.86
1001,نترات الأمونيوم,كجم,FERTILIZER,1.0
1002,كلوريد البوتاسيوم,كجم,FERTILIZER,1.0
1003,سماد 20-20-20,كجم,FERTILIZER,1.0
1004,مبيد الحشرات ألفا,لتر,CHEMICALS,0.92
1005,مبيد الفطريات بيتا,لتر,CHEMICALS,0.88
1006,بذور بنجر السكر,كجم,SEEDS,1.0
1007,قطع غيار لودر - فلتر,عدد,SPARE_PARTS,
1008,زيت محرك 15W40,لتر,SPARE_PARTS,0.85
1009,فتيل مضخة مياه,عدد,SPARE_PARTS,
```

#### SQL Re-Entry Script
```sql
-- Re-entry: Items (Phase 3) - Top items by historical volume
-- Inserts canonical item records for company_id = 1

BEGIN TRANSACTION;

INSERT INTO items
(code, company_id, name, unit, warehouse_type, density_factor, is_active, created_at)
VALUES
(1000, 1, 'حمض الفوسفوريك', 'لتر', 'FERTILIZER', 0.86, 1, '2026-05-15'),
(1001, 1, 'نترات الأمونيوم', 'كجم', 'FERTILIZER', 1.0, 1, '2026-05-15'),
(1002, 1, 'كلوريد البوتاسيوم', 'كجم', 'FERTILIZER', 1.0, 1, '2026-05-15'),
(1003, 1, 'سماد 20-20-20', 'كجم', 'FERTILIZER', 1.0, 1, '2026-05-15'),
(1004, 1, 'مبيد الحشرات ألفا', 'لتر', 'CHEMICALS', 0.92, 1, '2026-05-15'),
(1005, 1, 'مبيد الفطريات بيتا', 'لتر', 'CHEMICALS', 0.88, 1, '2026-05-15'),
(1006, 1, 'بذور بنجر السكر', 'كجم', 'SEEDS', 1.0, 1, '2026-05-15'),
(1007, 1, 'قطع غيار لودر - فلتر', 'عدد', 'SPARE_PARTS', NULL, 1, '2026-05-15'),
(1008, 1, 'زيت محرك 15W40', 'لتر', 'SPARE_PARTS', 0.85, 1, '2026-05-15'),
(1009, 1, 'فتيل مضخة مياه', 'عدد', 'SPARE_PARTS', NULL, 1, '2026-05-15');

COMMIT;
```

---

## 3. Operational Transaction Re-Entry Templates

### 3.1 Capital Injection (Equity)

#### Canonical Format
```json
{
  "transaction_date": "2025-11-06",
  "transaction_type": "EQUITY_INJECTION",
  "partner_code": "1001",           // Partner SUB entity code
  "partner_name": "جهاز مستقبل مصر",
  "amount": 5000000,
  "document_number": "EQ_2025_001",
  "statement_text": "حقن رأس المال من جهاز مستقبل مصر - الشطر الأول",
  "notes_internal": "Per board resolution dated 2025-11-01"
}
```

#### GL Posting (Deterministic)
```
Debit:  1401 (Cash/Bank) ..................... 5,000,000
Credit: 210101 (Paid-In Capital) ............ 5,000,000
  (Or split between multiple partner equity accounts)
```

#### SQL Re-Entry
```sql
-- Capital Injections
INSERT INTO cash_transactions
(company_id, transaction_date, direction, amount, statement_text, 
 financial_account_code, service_type_code, notes_internal, status)
VALUES
(1, '2025-11-06', 'ح', 5000000, 'حقن رأس المال جهاز مستقبل مصر', '1401', 'SRV_ADMIN', 'Equity Injection', 'confirmed'),
(1, '2025-11-08', 'ح', 5000000, 'حقن رأس المال طايل عرفة', '1401', 'SRV_ADMIN', 'Equity Injection', 'confirmed');
```

---

### 3.2 Supplier Invoice (Material Purchase)

#### Canonical Format
```json
{
  "supplier_code": 20900353,
  "supplier_name": "شركة عرفة للتصدير والتنمية الزراعية",
  "transaction_type": "INVOICE",
  "document_number": 105231,
  "document_date": "2025-12-15",
  "amount": 1835000,
  "statement_text": "فاتورة شراء اسمدة ومبيدات - ديسمبر 2025 الدفعة الأولى",
  "service_type_code": "SRV_SUPPLY",
  "season_id": 3,
  "center_code": 1006011,
  "notes_internal": "4830 line items; fertilizer 80%, pesticides 20%"
}
```

#### GL Posting (Deterministic)
```
Debit:  1407 (Inventory - Materials) ........ 1,835,000
Credit: 2120.1 (AP - Commodity Suppliers) .. 1,835,000
```

#### SQL Re-Entry (Batch Example)
```sql
-- Supplier Invoices (Material Purchases)
INSERT INTO supplier_transactions
(company_id, supplier_code, transaction_type, document_number, transaction_date,
 debit, credit, statement_text, service_type_code, center_code, season_id, status)
VALUES
(1, 20900353, 'INVOICE', 105231, '2025-12-15', 1835000, 0, 
 'فاتورة شراء اسمدة ومبيدات - ديسمبر', 'SRV_SUPPLY', 1006011, 3, 'posted');

-- Note: Actual re-entry will include many more line items per supplier
```

---

### 3.3 Inventory Goods Receipt (GRN)

#### Canonical Format
```json
{
  "movement_date": "2025-12-15",
  "movement_type": "GRN",
  "supplier_code": 20900353,
  "document_number": 105231,
  "item_code": 1000,
  "warehouse": "WH_NORTH",
  "quantity": 50000,
  "unit_price": 36.70,
  "statement_text": "استلام 50 طن حمض فوسفوريك - فاتورة 105231",
  "service_type_code": "SRV_SUPPLY",
  "season_id": 3
}
```

#### GL Posting (Deterministic)
```
Debit:  1407 (Inventory) .................. (qty * unit_price)
Credit: 2120.1 (AP - Commodities) ........ (qty * unit_price)
```

#### SQL Re-Entry (Batch)
```sql
-- Inventory GRNs (sample: 3 items from invoice 105231)
INSERT INTO inventory_movements
(company_id, movement_date, movement_type, warehouse, supplier_code, item_code,
 document_number, quantity, unit_price, statement_text, service_type_code, season_id, status)
VALUES
(1, '2025-12-15', 'GRN', 'WH_NORTH', 20900353, 1000, 105231, 50000, 36.70, 
 'استلام حمض فوسفوريك', 'SRV_SUPPLY', 3, 'posted'),
(1, '2025-12-15', 'GRN', 'WH_NORTH', 20900353, 1001, 105231, 25000, 8.40, 
 'استلام نترات أمونيوم', 'SRV_SUPPLY', 3, 'posted'),
(1, '2025-12-15', 'GRN', 'WH_NORTH', 20900353, 1004, 105231, 100, 185.00, 
 'استلام مبيد حشرات', 'SRV_SUPPLY', 3, 'posted');
```

---

### 3.4 Equipment Rental (Supplier Transaction + ISSUE)

#### Canonical Format (Two separate entries: Header + Issuance)

**Header:**
```json
{
  "supplier_code": 20100033,
  "supplier_name": "عمرو السمالوسي - لودر",
  "transaction_type": "INVOICE",
  "document_number": 456789,
  "document_date": "2026-01-15",
  "amount": 50000,
  "statement_text": "فاتورة ساعات تشغيل لودر - يناير 2026 (100 ساعة × 500 ساعة/الشهر)",
  "service_type_code": "SRV_MECH",
  "center_code": 1006005,
  "season_id": 3,
  "notes_internal": "100 operating hours at fixed rate 500 EGP/hour"
}
```

**GL Posting (Header - Posting):**
```
Debit:  5101 (Equipment Operating Expense) . 50,000
Credit: 2120.1 (AP - Equipment) ........... 50,000
```

#### SQL Re-Entry (Equipment Rental Example)
```sql
-- Equipment Rental Invoices
INSERT INTO supplier_transactions
(company_id, supplier_code, transaction_type, document_number, transaction_date,
 debit, credit, statement_text, service_type_code, center_code, season_id, status)
VALUES
(1, 20100033, 'INVOICE', 456789, '2026-01-15', 50000, 0,
 'فاتورة ساعات تشغيل لودر - يناير', 'SRV_MECH', 1006005, 3, 'posted'),
(1, 20300086, 'INVOICE', 456790, '2026-01-15', 42500, 0,
 'فاتورة ساعات تشغيل لودر - يناير', 'SRV_MECH', 1006007, 3, 'posted');
```

---

### 3.5 Labor Supply

#### Canonical Format
```json
{
  "supplier_code": 21400002,
  "supplier_name": "احمد دسوقي - عمالة",
  "transaction_type": "INVOICE",
  "document_number": 789456,
  "document_date": "2025-12-05",
  "amount": 52000,
  "statement_text": "فاتورة عمالة ديسمبر 2025 - (160 عامل × 325 EGP)",
  "service_type_code": "SRV_LABOR",
  "center_code": 1006011,
  "season_id": 3,
  "notes_internal": "160 workers × 325 EGP/day = 52,000 EGP for month of Dec"
}
```

#### GL Posting (Deterministic)
```
Debit:  5101 (Labor Operating Expense) ... 52,000
Credit: 2120.1 (AP - Labor) .............. 52,000
```

#### SQL Re-Entry
```sql
-- Labor Supply Invoices
INSERT INTO supplier_transactions
(company_id, supplier_code, transaction_type, document_number, transaction_date,
 debit, credit, statement_text, service_type_code, center_code, season_id, status)
VALUES
(1, 21400002, 'INVOICE', 789456, '2025-12-05', 52000, 0,
 'فاتورة عمالة ديسمبر 2025', 'SRV_LABOR', 1006011, 3, 'posted');
```

---

### 3.6 Inventory Issuance (to Field / Center)

#### Canonical Format
```json
{
  "movement_date": "2026-01-10",
  "movement_type": "ISSUE",
  "item_code": 1000,
  "warehouse": "WH_NORTH",
  "quantity": 5000,
  "center_code": 1006011,
  "service_type_code": "SRV_MECH",
  "statement_text": "صرف حمض فوسفوريك لبيفوت 11 - ميكنة شهر يناير",
  "season_id": 3,
  "field_id": 42,
  "work_order_id": 5001
}
```

#### GL Posting (Deterministic)
```
Debit:  5101 (Operating Expense by Service) .. (qty * WAC)
Credit: 1407 (Inventory) .................... (qty * WAC)

(GL account routed by service_type_code: SRV_MECH → 5101.Equipment)
```

#### SQL Re-Entry (Batch)
```sql
-- Inventory Issuances (sample)
INSERT INTO inventory_movements
(company_id, movement_date, movement_type, warehouse, item_code, center_code,
 quantity, service_type_code, statement_text, season_id, field_id, status)
VALUES
(1, '2026-01-10', 'ISSUE', 'WH_NORTH', 1000, 1006011, 5000, 'SRV_MECH',
 'صرف حمض فوسفوريك - بيفوت 11 - ميكنة', 3, 42, 'pending'),
(1, '2026-01-10', 'ISSUE', 'WH_NORTH', 1001, 1006011, 2000, 'SRV_LABOR',
 'صرف نترات - بيفوت 11 - عمالة', 3, 42, 'pending'),
(1, '2026-01-12', 'ISSUE', 'WH_NORTH', 1004, 1006007, 25, 'SRV_SUPPLY',
 'صرف مبيد - بيفوت 7 - معالجة', 3, 40, 'pending');
```

---

### 3.7 Supplier Payment (Cash Disbursement)

#### Canonical Format
```json
{
  "transaction_date": "2026-01-20",
  "direction": "م",
  "amount": 500000,
  "statement_text": "سداد فاتورة شركة عرفة 105231 - شراء مواد",
  "financial_account_code": "1204",
  "supplier_code": 20900353,
  "document_number": 105231,
  "service_type_code": "SRV_SUPPLY",
  "notes_internal": "Payment matches invoice 105231 dated 2025-12-15"
}
```

#### GL Posting (Deterministic)
```
Debit:  2120.1 (AP - Commodity Suppliers) .. 500,000
Credit: 1204 (Cash Box) ................... 500,000
```

#### SQL Re-Entry (Batch)
```sql
-- Supplier Payments
INSERT INTO cash_transactions
(company_id, transaction_date, direction, amount, statement_text,
 financial_account_code, service_type_code, supplier_code, document_number, notes_internal, status)
VALUES
(1, '2026-01-20', 'م', 500000, 'سداد فاتورة عرفة 105231',
 '1204', 'SRV_SUPPLY', 20900353, 105231, 'Payment for invoice 105231', 'confirmed'),
(1, '2026-01-21', 'م', 150000, 'سداد فاتورة عمالة احمد دسوقي',
 '1204', 'SRV_LABOR', 21400002, 789456, 'Payment for labor invoice Dec', 'confirmed');
```

---

## 4. Re-Entry Execution Plan (Phase 3)

### Phase 3a: Data Preparation (Local, No D1 calls)
```
1. Prepare canonical SQL files for each data category
2. Validate SQL syntax locally
3. Organize by insertion order (master data first, transactions second)
4. Document data lineage (where each record came from)
```

### Phase 3b: Full Data Wipe (When connectivity restored)
```sql
-- Execute the full cleanup script
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/governance/04_full_clean_reseed_scope_company1.sql

-- Verify all operational tables are empty
SELECT COUNT(*) FROM supplier_transactions WHERE company_id=1;  -- Expected: 0
SELECT COUNT(*) FROM cash_transactions WHERE company_id=1;      -- Expected: 0
SELECT COUNT(*) FROM inventory_movements WHERE company_id=1;    -- Expected: 0
```

### Phase 3c: Master Data Re-Entry (In Order)
```bash
# 1. Cost Centers (reference data)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/10_cost_centers.sql

# 2. Suppliers
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/20_suppliers.sql

# 3. Items (Inventory Master)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/30_items.sql

# 4. Verify counts
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT 'suppliers' tbl, COUNT(*) cnt FROM suppliers WHERE company_id=1 UNION ALL SELECT 'items', COUNT(*) FROM items WHERE company_id=1;"
```

### Phase 3d: Operational Transactions Re-Entry (By Date Order)
```bash
# 5. Capital Injections (starting point)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/40_capital_injections.sql

# 6. Supplier Invoices (Nov 2025 - Jan 2026)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/50_supplier_invoices_nov_dec_2025.sql
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/50_supplier_invoices_jan_2026.sql

# 7. Inventory GRNs
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/60_inventory_grns.sql

# 8. Supplier Payments
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/70_supplier_payments.sql

# 9. Inventory Issuances
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/canonical_reentry/80_inventory_issuances.sql
```

### Phase 3e: Posting Engine Execution
```bash
# 10. Execute posting rules to generate GL entries
npm run scripts -- execute_posting_job.js --company_id=1 --cutoff=2026-05-11

# 11. Verify GL balances match sub-ledgers
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/governance/03_daily_finance_control_query_pack.sql
```

### Phase 3f: Final Reconciliation
```bash
# 12. Verify counts and balances
# - Supplier AP = sum of debits - credits in supplier_transactions
# - Inventory balance = sum of GRN less sum of ISSUE
# - GL balance = sum of journal entry lines
# - Cash balance = sum of cash transactions

# 13. Sign off and mark period as closed
```

---

## 5. Sample Re-Entry SQL Files (To Be Created)

```
sql/canonical_reentry/
├── 10_cost_centers.sql                  # Reference data
├── 20_suppliers.sql                     # Master data
├── 30_items.sql                         # Inventory master
├── 40_capital_injections.sql            # Nov 2025 equity
├── 50_supplier_invoices_nov_dec_2025.sql # Operational transactions
├── 50_supplier_invoices_jan_2026.sql
├── 60_inventory_grns.sql                # GRN transactions
├── 70_supplier_payments.sql             # Cash outflows
├── 80_inventory_issuances.sql           # Cost allocations
└── README.md                            # Execution order + notes
```

---

## 6. Data Quality Checkpoints (During Re-Entry)

After each re-entry phase, run validation:

```sql
-- After Master Data
SELECT 'Suppliers', COUNT(*) cnt FROM suppliers WHERE company_id=1
UNION ALL
SELECT 'Items', COUNT(*) FROM items WHERE company_id=1;

-- After Transactions
SELECT 'Supplier TX', COUNT(*) FROM supplier_transactions WHERE company_id=1
UNION ALL
SELECT 'Cash TX', COUNT(*) FROM cash_transactions WHERE company_id=1
UNION ALL
SELECT 'Inventory Moves', COUNT(*) FROM inventory_movements WHERE company_id=1;

-- Balances
SELECT 'AP Balance', COALESCE(SUM(credit - debit), 0)
FROM supplier_transactions WHERE company_id=1 AND status='posted';

SELECT 'Inventory Val', COALESCE(SUM(balance_value), 0)
FROM inventory_balances WHERE company_id=1;

SELECT 'GL Unbalanced', COUNT(*)
FROM (
  SELECT je_id FROM journal_entry_lines
  GROUP BY je_id
  HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
);
```

---

## 7. Success Metrics (Phase 3 Complete)

✅ **Data Integrity:**
- 0 NULL values in mandatory canonical fields (statement_text, service_type_code, financial_account_code)
- 100% of posted transactions have matching GL entries
- Sub-ledger balances = GL balances (AR, AP, Inventory, Cash)

✅ **Governance Compliance:**
- 0 governance flags for missing dimensions in NEW data
- All transactions routed via service_type_code (no hardcoded GL defaults)
- Posting rules engine operates deterministically (same input → same output)

✅ **Audit Trail:**
- Every transaction has meaningful statement_text (≥ 3 chars)
- Source document reference (document_number) traceable
- Cost allocation (center_code, service_type_code) captured
- Created/Updated timestamps preserved

✅ **Cutover Readiness:**
- Historical data fully closed (period locked)
- NEW transaction entry follows canonical model (API validation enforced)
- Posting happens automatically via outbox + cron job
- Daily control queries show zero errors

---

## 8. What NOT to Re-Enter

❌ **Do NOT re-enter:**
- Future-dated transactions (blocked by 2026-05-11 cutoff)
- Transactions with ambiguous GL routing (resolve ambiguity first)
- Duplicate transactions (detected via document_number uniqueness)
- Zero-value transactions without documented reason

✅ **DO skip and mark with governance flag:**
- Rows that were "ACTIONABLE" in cutover analysis (keep them out)
- Rows that violate posting rules (re-classify first)

---

**Document Version:** 2026-05-11 v1.0  
**Prepared by:** Technical Team  
**Ready for Execution:** When Phase 2 deployed + D1 connectivity restored
