# SQL Remediation Options: 2026-05-09 Non-Canonical Batch

**Date Prepared:** 2026-05-10  
**Database:** agri-nile-flow-data-lake (company_id=1)  
**Scope:** 46 inventory_movements + 2 cash_transactions + 46 journal_entries

---

## Executive Summary

Two safe SQL scripts are now ready for your decision:

| Option | Script | Impact | Risk | Action |
|--------|--------|--------|------|--------|
| **A** | Investigation_Isolation_2026-05-09.sql | Flags batch as "under investigation" without data loss | ⭐ Very Low | Safe to execute immediately |
| **B** | Controlled_Date_Correction_Template.sql | Re-dates batch to correct date with full validation | ⭐⭐ Low (with controls) | Requires target date + explicit approval |

---

## Option A: Investigation Isolation (Non-Destructive)

**File:** `sql/Investigation_Isolation_2026-05-09.sql`

### What It Does
- ✅ Adds `is_flagged = 1` to all 46 inventory_movements on 2026-05-09
- ✅ Adds investigation note to `notes` field (preserving existing notes)
- ✅ Adds `is_flagged = 1` to both draft cash_transactions
- ✅ Creates audit record in business_events table
- ✅ All original data fully preserved

### What It Does NOT Do
- ❌ Does NOT delete anything
- ❌ Does NOT modify dates or core fields
- ❌ Does NOT change journal_entries
- ❌ Does NOT affect accounting balances
- ❌ Does NOT break any links or foreign keys

### Current Impact on Database
**Before Execution:**
- inventory_movements 2026-05-09: 46 rows, is_flagged=0, notes vary
- cash_transactions 2026-05-09: 2 rows, is_flagged=0, status=draft

**After Execution:**
- inventory_movements 2026-05-09: 46 rows, is_flagged=1, notes appended with "INVESTIGATION:..."
- cash_transactions 2026-05-09: 2 rows, is_flagged=1, notes appended with "INVESTIGATION:..."
- Rows remain fully queryable and linked
- Audit trail recorded: when flagged, by whom (system_audit), reason

### Execution
```powershell
# Run the entire script from start to finish
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command @sql/Investigation_Isolation_2026-05-09.sql
```

### Rollback (if needed)
```powershell
# Reset flags (script provided at end of main SQL)
# All rows revert to is_flagged=0
```

### Why Use This Option
- ✅ Immediate action without waiting for business confirmation
- ✅ Preserves all data for later audit/review
- ✅ Allows time to gather external documentation for 6 unresolved GRN
- ✅ Zero risk of data loss or inconsistency
- ✅ Fully reversible in case of false alarm

**Recommendation:** Execute this FIRST while gathering business evidence for dates.

---

## Option B: Controlled Date Correction (Requires Approval)

**File:** `sql/Controlled_Date_Correction_Template.sql`

### What It Does
1. ✅ Takes a **TARGET DATE** (you specify)
2. ✅ Updates all 46 inventory_movements date from 2026-05-09 → TARGET_DATE
3. ✅ Updates all 46 linked journal_entries date from 2026-05-09 → TARGET_DATE
4. ✅ Time component preserved (only date portion changed)
5. ✅ Maintains all accounting balances (debit=credit stays balanced)
6. ✅ Validates before, during, and after with 5-step integrity checks

### What It Does NOT Do
- ❌ Does NOT delete anything
- ❌ Does NOT create new journal entries
- ❌ Does NOT modify amounts or accounting logic
- ❌ Does NOT break inventory links
- ❌ Does NOT affect 2 draft cash_transactions (separate decision)

### Pre-Execution Requirements (USER MUST CONFIRM)

**Checklist:**
- [ ] Business has confirmed 2026-05-09 batch is REAL operational data
- [ ] Correct date is confirmed: _____________ (e.g., 2026-04-30, 2026-03-31)
- [ ] Reason for date correction documented: _________________________________
- [ ] External evidence/supporting documents attached: YES [ ] NO [ ]
- [ ] User acknowledges financial impact review: YES [ ]
- [ ] Authorized by: _________________ Title: _________________ Date: _________

### How to Use This Template

**Step 1: Prepare Target Date**
```
Replace all instances of '@TARGET_DATE' with confirmed date.
Example: '2026-04-30'
Regex find/replace: @TARGET_DATE → 2026-04-30
```

**Step 2: Validation Only (Run FIRST, no changes)**
```powershell
# Run only STEP 1 section to verify:
# - Source batch exists (46 rows)
# - Journal entries linked (46 JEs)
# - Current balance (should show 2,373,450 debit/credit)

npx wrangler d1 execute agri-nile-flow-data-lake --remote --command @sql/Controlled_Date_Correction_Template.sql
# (Only uncomment lines up to and including "-- BEGIN TRANSACTION" section)
```

**Step 3: Execute Correction (After validation passes)**
```powershell
# Once STEP 1 validation passes, uncomment:
# - "BEGIN TRANSACTION;" at start
# - "COMMIT;" at end
# Run full script

npx wrangler d1 execute agri-nile-flow-data-lake --remote --command @sql/Controlled_Date_Correction_Template.sql
```

**Step 4: Verify Results**
```powershell
# Query to confirm new date
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "SELECT 
    'Inventory Moved' as entity,
    COUNT(*) as rows,
    MIN(movement_date) as first_date,
    MAX(movement_date) as last_date,
    SUM(CASE WHEN movement_type='GRN' THEN qty_in ELSE 0 END) as total_qty_in
  FROM inventory_movements
  WHERE movement_date >= '2026-04-29' AND movement_date < '2026-05-01';"
```

### Validation Steps (Automated)

The script includes 5 automatic validation phases:

| Phase | Checks | Stops If | Notes |
|-------|--------|----------|-------|
| **1** | Source batch exists, JE linked | Count = 0 | Ensures batch found |
| **2** | Backup tables created | Write fails | Enables rollback |
| **3** | Date update applied | (none) | Actual correction |
| **4** | Balance verified, integrity checked | Debit ≠ Credit | Ensures consistency |
| **5** | 1:1 linking verified | Count mismatch | Ensures no orphaned rows |

### Rollback Capability

**If correction fails validation (Step 4):**
```powershell
# Rollback script provided at end of SQL file
# Fully restores original dates for all 46 rows
# Zero data loss guaranteed
```

**If correction passes but business rejects date:**
```powershell
# Run ROLLBACK section (provided in SQL file)
# Restore to 2026-05-09 with full audit trail
```

### Why Use This Option
- ✅ Only if business CONFIRMS 2026-05-09 is wrong date
- ✅ Only if correct date is known and documented
- ✅ If you have external evidence (PO, invoice, document)
- ✅ When you want to finalize and close investigation

**Recommendation:** Use ONLY after successful Option A isolation + business confirmation.

---

## Decision Matrix

Use this to choose the right option:

### Choose Option A (Isolation) if:
- ❓ You're unsure about 2026-05-09 validity
- ❓ You need time to gather business evidence
- ❓ You want to mark batch for later review
- ❓ 6 unresolved GRN need external documentation
- ❓ You want zero risk of data modification now

### Choose Option B (Date Correction) if:
- ✅ Business CONFIRMED 2026-05-09 is wrong
- ✅ Correct date is known and documented
- ✅ You have external evidence (invoice/PO)
- ✅ Ready to close investigation immediately
- ✅ Accept risk of date change (reversible)

---

## Current Status: 6 Unresolved GRN

Rows: 6859, 6860, 6861, 6862, 6863, 6864

**Current Decision:**
- [ ] **Option A.1**: Flag via Investigation_Isolation script; obtain supplier evidence from external source (PO, receipt, vendor documentation)
- [ ] **Option A.2**: Requires external source data to create deterministic match (same exact-match logic as 60 successful updates)
- [ ] **Option B**: Re-date all 6 along with batch if date correction approved

---

## 2 Draft Cash Transactions on Same Date

Rows: 564 (1000), 565 (500)

**Status:** Unposted, unlinked to journal_entries, draft status

**Separate Decision:**
- [ ] Keep (Option A isolation will flag them)
- [ ] Delete (safe to delete; no accounting impact; no JE links)
- [ ] Correct date separately after batch decision

---

## Summary of Files Created

1. **sql/Investigation_Isolation_2026-05-09.sql** (260 lines)
   - Flags all 46 inventory + 2 cash rows
   - Non-destructive, reversible
   - Ready to execute immediately

2. **sql/Controlled_Date_Correction_Template.sql** (280 lines)
   - Template for date correction
   - Requires target date substitution
   - Includes 5-step validation framework
   - Requires explicit user approval before execution

3. **sql/Remediation_Decision_Framework.md** (this file)
   - Decision matrix
   - Execution instructions
   - Rollback procedures

---

## Next Steps

### IMMEDIATE (Today)
1. ✅ Review both SQL scripts
2. ✅ Decide: Isolation first, or both simultaneously?
3. ✅ If isolation: Execute Option A now
4. ✅ If date correction: Specify target date + business reason

### FOLLOW-UP (If Option A chosen)
1. ⏳ Gather business evidence for 2026-05-09 validity
2. ⏳ Locate external source documentation (invoice/PO/receipt)
3. ⏳ Determine correct date if wrong
4. ⏳ Return with explicit approval + target date
5. ⏳ Execute Option B with confidence

### PARALLEL
1. 🔄 Investigate 6 unresolved GRN (IDs: 6859-6864)
   - Obtain source documentation
   - Extract supplier_code
   - Prepare separate UPDATE if found
   - Or keep flagged for manual resolution

---

## Safety Guardrails

✅ **Option A (Isolation) Safety:**
- No deletions
- No modifications to core fields
- No accounting changes
- No broken links
- Fully reversible
- Execution risk: **MINIMAL**

✅ **Option B (Date Correction) Safety:**
- Pre-execution validation (5 checks)
- Backup tables created before modification
- Post-execution verification (5 checks)
- Rollback script generated
- Transaction control (BEGIN/COMMIT)
- Balance verification (debit=credit)
- Linking verification (1:1 inventory↔JE)
- Execution risk: **LOW** (with controls)

---

## Questions to Answer Before Proceeding

1. **Do you want to flag for investigation immediately (Option A)?**
   - YES → Execute Investigation_Isolation_2026-05-09.sql now
   - NO → Skip to #2

2. **Do you have business confirmation that 2026-05-09 is the WRONG date?**
   - YES → Go to #3
   - NO → Recommend Option A first

3. **If wrong date, what is the CORRECT date?**
   - Provide in format: YYYY-MM-DD
   - Example: 2026-04-30

4. **Do you have external evidence (invoice/PO/receipt)?**
   - YES → Proceed with Option B
   - NO → Recommend Option A (gather evidence first)

---

**Awaiting your decision on:**
- [ ] Execute Option A (Investigation Isolation) now?
- [ ] OR provide target date for Option B (Date Correction)?
- [ ] OR execute both together?

---

**Prepared by:** System Audit Framework  
**Date:** 2026-05-10  
**Status:** Ready for User Decision  
**Risk Level:** Minimal (Option A) | Low (Option B)
