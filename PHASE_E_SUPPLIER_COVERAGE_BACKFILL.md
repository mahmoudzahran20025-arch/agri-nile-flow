# Phase E: Supplier Coverage Remediation
**Status:** PLANNED & READY  
**Target Coverage:** 69.65% → 90%+  
**Scope:** 95 supplier transactions (all center + expense missing)  
**Priority Supplier:** 20900353 (66 tx, EGP 33.77M)

---

## Baseline (May 9, 2026 08:33 UTC)

| Metric | Count | Amount | Notes |
|--------|-------|--------|-------|
| Total supplier transactions | 313 | — | company_id=1 |
| **Missing center_code** | 95 | 33.95M | 30.35% gap |
| **Missing expense_category** | 95 | 33.95M | Same 95 rows |
| **Both missing (target)** | 95 | 33.95M | Phase E scope |

### Top 5 Backfill Targets

| Rank | Supplier | Name | Tx | Amount | Type | Strategy |
|------|----------|------|----|---------|----|----------|
| 1 | 20900353 | عرفة للتصدير والتنمية الزراعية | 66 | 33.77M | Company | Cost center inference |
| 2 | 20900151 | جهاز مستقبل مصر (حكومي) | 16 | 0 | Government | Grant/subsidy routing |
| 3 | 20100033 | عمرو السمالوسي - لودر | 10 | 169K | Service | Auto-classify as equipment |
| 4 | 20300121 | ميكنة أحمد عبيد | 2 | 188K | Service | Auto-classify as equipment |
| 5 | 20300086 | عيد شعبان - لودر | 1 | 11K | Service | Auto-classify as equipment |

---

## Phase E Strategy (4 substeps, each idempotent)

### E1: Service Supplier Auto-Classification (Contractor/Technician)
**Scope:** Suppliers with names containing ("لودر", "ميكنة", "عامل", "فني")  
**Action:** Set expense_category=33003 (Equipment Services), center_code from transaction date + context  
**SQL:** `UPDATE supplier_transactions SET expense_category='33003' WHERE supplier_code IN (...) AND expense_category IS NULL AND company_id=1`  
**Expected:** +13 rows fixed (all service workers)  
**Safety:** Idempotent (NULL check before update)

### E2: Government/Institutional Grants (supplier 20900151)
**Scope:** Supplier 20900151 (جهاز مستقبل مصر) + amount=0  
**Action:** Set center_code to primary agricultural center (1006001), expense_category=NULL (policy: non-expense items)  
**SQL:** Special rule for zero-amount suppliers (subsidies/grants)  
**Expected:** +16 rows fixed  
**Safety:** Zero-amount guard prevents cost center mismatch

### E3: Large Company Backfill (20900353 - Priority)
**Scope:** Supplier 20900353 (عرفة للتصدير) - 66 transactions  
**Strategy:**
  - Option A (Heuristic): Cost center from transaction description or payment voucher reference
  - Option B (Manual): Create mapping: supplier → default center (e.g., 1006011 for procurement)
  - Option C (Validation): Query accounting team for policy (one-time)
  
**Recommended:** Option B (heuristic with fallback center=1006001) + expense_category from supplier_type_code  
**SQL:** UPDATE with COALESCE fallback  
**Expected:** +66 rows fixed (biggest impact)

### E4: Remaining Sparse Suppliers (20300121, 20300086, others)
**Scope:** 0-2 transactions each  
**Action:** Bulk classify by category inference (equipment/service/material)  
**SQL:** Batch UPDATE with category-based logic  
**Expected:** +2-3 rows fixed (minimal impact but completes coverage)

---

## Idempotent Backfill SQL Template

### Template Structure (Safe for Repeat Runs)

```sql
-- ─────────────────────────────────────────────────────────────
-- Phase E Supplier Dimension Backfill (Idempotent)
-- Safe to re-run any time; only updates NULL values
-- Generated: 2026-05-09
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- Step E1: Service supplier classification (contractors/technicians)
UPDATE supplier_transactions
SET    expense_category = '33003'  -- Equipment Services
WHERE  company_id = 1
  AND  expense_category IS NULL
  AND  supplier_code IN (
         SELECT DISTINCT code FROM suppliers
         WHERE company_id=1 AND (
           name LIKE '%لودر%' OR 
           name LIKE '%ميكنة%' OR 
           name LIKE '%عامل%' OR 
           name LIKE '%فني%'
         )
       );

-- Step E2: Government/institutional zero-amount grants
UPDATE supplier_transactions
SET    center_code = 1006001,
       expense_category = NULL  -- Non-expense per policy
WHERE  company_id = 1
  AND  center_code IS NULL
  AND  amount = 0
  AND  supplier_code = 20900151;

-- Step E3: Large company (20900353) heuristic backfill
UPDATE supplier_transactions
SET    center_code = COALESCE(
         CASE 
           WHEN description LIKE '%الزراعة%' THEN 1006001
           WHEN description LIKE '%المبيعات%' THEN 1006011
           ELSE 1006001
         END,
         1006001
       ),
       expense_category = CASE 
         WHEN equipment IS NOT NULL THEN '33003'
         ELSE '31001'  -- Default materials/supplies
       END
WHERE  company_id = 1
  AND  supplier_code = 20900353
  AND  (center_code IS NULL OR expense_category IS NULL);

-- Step E4: Catch-all for remaining sparse suppliers
UPDATE supplier_transactions
SET    center_code = COALESCE(center_code, 1006001),
       expense_category = COALESCE(expense_category, '31001')
WHERE  company_id = 1
  AND  (center_code IS NULL OR expense_category IS NULL)
  AND  supplier_code NOT IN (20900353, 20900151);

COMMIT;

-- Verification
SELECT 
  COUNT(*) AS remaining_null_center,
  SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) AS null_centers,
  SUM(CASE WHEN expense_category IS NULL THEN 1 ELSE 0 END) AS null_expenses
FROM supplier_transactions
WHERE company_id = 1;
```

---

## Execution Plan (Safe, Reversible)

### Pre-Backfill Verification
```sql
-- Snapshot before
SELECT COUNT(*) AS null_before FROM supplier_transactions 
WHERE company_id=1 AND (center_code IS NULL OR expense_category IS NULL);
```

### Backfill Execution
```bash
# Dry-run first
node scripts/phase_e_supplier_backfill.js --dry-run

# Apply (when confident)
node scripts/phase_e_supplier_backfill.js --apply

# Stream logs
npx wrangler tail
```

### Post-Backfill Validation
```sql
-- Verify coverage improved
SELECT 
  SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS center_pct,
  SUM(CASE WHEN expense_category IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS expense_pct
FROM supplier_transactions WHERE company_id=1;

-- Should show: center_pct ≈ 100% (or ≥90%), expense_pct ≈ 100% (or ≥90%)
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Wrong center assignment (supplier spans multiple) | Use primary center only; add validation report |
| Zero-amount items mislabeled | Guard: IF amount=0 THEN skip expense assignment |
| Non-idempotent double-run corruption | WHERE clause checks NULL before UPDATE |
| Supplier code typos in mapping | Pre-validate against suppliers table EXISTS |
| Journal posting impact | Only updates NULL; already-posted entries unaffected |

---

## Success Criteria

✅ **Phase E Complete When:**
- supplier_center_pct ≥ 95% (current 69.65% → target ≥90% min, 95% ideal)
- supplier_expense_pct ≥ 95%
- No broken posting links (orphans remain 0)
- Daily gate check: PASS

---

## Next: Phase F (Future Roadmap)

Once Phase E reaches 95%+:
1. **Equipment Type Enrichment** (supplier_equipment_type_id coverage)
2. **Inventory Header Postings** (Level 2 balance sheet clean-up)
3. **Work Order Cost Allocation** (indirect cost routing)

---

## Decision Log

- **2026-05-09 08:33 UTC**: Phase E drafted based on top-5 supplier analysis
- **Scope:** 95 rows, 33.95M EGP, 4 substeps
- **Strategy:** Heuristic + manual category mapping + zero-amount guard
- **Next action:** Implement Phase E SQL generator script
