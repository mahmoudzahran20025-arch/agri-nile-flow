# 🔍 IMPACT ANALYSIS REPORT - Pre-Migration Assessment

**Date:** April 30, 2026  
**Purpose:** Analyze current Production state before applying CORRECTED_POSTING_SETUP.sql  
**Status:** ⚠️ CRITICAL ISSUES IDENTIFIED

---

## 📊 EXECUTIVE SUMMARY

| Component | Current State | Issue Severity |
|-----------|---------------|----------------|
| COGS Accounts in Setup | 18 accounts referenced | 🚨 **ALL DO NOT EXIST in CoA** |
| Missing Required Accounts | 14 accounts | 🔴 **Blocking** |
| Unused PPGs in Rules | SEED, CHEM, HARVEST | 🟡 **Gap** |
| Current General Setup | 18 rows | 🟡 **Will be replaced** |
| Inventory Setup | 4 rows | ✅ **Matches proposed** |

---

## 1️⃣ CRITICAL FINDING: COGS Accounts Don't Exist

### Current COGS Accounts in general_posting_setup:
```
610101, 610201, 610301, 610401, 610501, 610601, 610901
611101, 611201, 611301, 611401, 611501, 611601, 611901
620101, 620901, 630101, 630201
```

### Verification Query Result:
```sql
SELECT code, name, account_type FROM chart_of_accounts 
WHERE code IN ('610101', '611101', '611401', '611501')
```
**Result:** 0 rows returned ❌

### 🔴 Impact:
- **Posting engine WILL FAIL** when trying to validate these accounts
- Any transaction using these BPG×PPG combinations will error
- The entire posting setup is effectively **non-functional**

---

## 2️⃣ MISSING ACCOUNTS ANALYSIS

### Accounts Required by Proposed Script But Missing:

| Account Code | Purpose | Status |
|--------------|---------|--------|
| **13500001** | WIP محاصيل | ❌ Missing |
| **14040711** | VAT مدخلات | ❌ Missing |
| **21060001** | VAT مخرجات | ❌ Missing |
| **14030001** | AR Trade | ❌ Missing |
| **21100001** | AP Trade | ❌ Missing |
| **14070401** | Finished Crops | ❌ Missing |
| **55010001-55010005** | COGS Accounts | ❌ Missing |
| **62010001-62010003** | Operating Expenses | ❌ Missing |
| **15900001** | Accum. Depreciation | ❌ Missing |

### ✅ Already Exists:
| Account Code | Purpose |
|--------------|---------|
| **41010001** | Revenue (إيرادات زراعية) | ✅ Exists |
| **11030001** | Equipment Assets | ✅ Exists |
| **14070101-14070106** | Inventory Accounts | ✅ Exist |

---

## 3️⃣ BPG/PPG COVERAGE GAP ANALYSIS

### Current PPGs in product_posting_groups (10 total):
```
✅ BEET      - بنجر (in matrix)
✅ SEEDS     - تقاوي وبذور (in matrix)
✅ FERT      - أسمدة (in matrix)
✅ EQUIP     - معدات (in matrix)
✅ FUEL      - وقود (in matrix)
✅ SERV      - خدمات (in matrix)
✅ MISC      - متنوعات (in matrix)
❌ SEED      - بذور (NOT in matrix - need mapping)
❌ CHEM      - مبيدات (NOT in matrix - need mapping)
❌ HARVEST   - محاصيل (NOT in matrix - need mapping)
```

### BPGs in Posting Rules (Active Usage):
```
✅ AGRI-OP  - 7 PPGs covered
✅ CUSTOMER - HARVEST only
✅ GOVT     - HARVEST only
✅ IMPORT   - SEED, CHEM, EQUIP, FERT, HARVEST
✅ LABOR    - Multiple PPGs
✅ LOCAL    - Multiple PPGs
```

### 🟡 Gap Impact:
- **SEED, CHEM, HARVEST** PPGs have active rules but NO general_posting_setup rows
- These transactions will fail to resolve posting accounts

---

## 4️⃣ INVENTORY POSTING SETUP COMPARISON

### Current (Production):
| IPG | Inventory Account | COGS Account |
|-----|-------------------|--------------|
| RAW-MAT | 140201 | 610101 |
| FINISHED | 140204 | 610102 |
| SPARES | 140207 | 610103 |
| FUEL-INV | 14010101 | 610104 |

### Proposed (Script):
| IPG | Inventory Account | COGS Account | WIP Account |
|-----|-------------------|--------------|-------------|
| RAW-MAT | 14070101 | 55010001 | 13500001 |
| FINISHED | 14070401 | 55010001 | 13500001 |
| SPARES | 14070105 | 55010004 | NULL |
| FUEL-INV | 14070107 | 55010005 | NULL |

### ⚠️ Migration Impact:
- **140201, 140204, 140207, 14010101** → new 1407xxxx structure
- **610101-610104** → 5501xxxx (but 6101xx don't exist anyway)
- **NEW:** WIP tracking with 13500001

---

## 5️⃣ RECOMMENDED MIGRATION PLAN

### Phase 1: Account Creation (Safe)
```sql
-- Create all missing accounts FIRST
-- COGS (55xxxx)
-- WIP (135xxxx)
-- VAT (14040711, 21060001)
-- AR/AP (14030001, 21100001)
-- Operating Expenses (62xxxx)
-- Depreciation (15900001)
-- Finished Goods (14070401)
-- Fuel Inventory (14070107)
```
**Risk:** LOW - Adding accounts doesn't break existing data

### Phase 2: Add Missing PPGs
```sql
-- Add to general_posting_setup:
-- SEED, CHEM, HARVEST
-- For BPGs: AGRI-OP, DOMESTIC, EXPORT, INTERNAL, LOCAL, IMPORT, LABOR
```
**Risk:** MEDIUM - Need to verify all combinations

### Phase 3: Update Inventory Setup
```sql
-- Update inventory_posting_setup with new account codes
-- Or: Create new IPGs with correct accounts
```
**Risk:** MEDIUM - May affect existing inventory transactions

### Phase 4: Test Transactions
```sql
-- Test scenarios:
-- 1. Purchase with VAT
-- 2. Issue to WIP
-- 3. Harvest (WIP → Finished)
-- 4. Sale with VAT
-- 5. COGS recognition
```
**Risk:** HIGH - Must validate before production

### Phase 5: Data Reconciliation (Optional)
```sql
-- If changing historical account references:
-- Create reclass entries for old transactions
-- Or: Keep old accounts for historical, use new for new transactions
```

---

## 6️⃣ IMMEDIATE ACTIONS REQUIRED

### Before Running CORRECTED_POSTING_SETUP.sql:

| Priority | Action | Owner |
|----------|--------|-------|
| 🔴 P0 | Create 14 missing chart_of_accounts | Dev |
| 🔴 P0 | Backup current general_posting_setup | DevOps |
| 🟠 P1 | Add SEED, CHEM, HARVEST to matrix | Dev |
| 🟠 P1 | Test on staging environment | QA |
| 🟡 P2 | Verify all referenced accounts exist | Dev |
| 🟡 P2 | Document account mapping changes | BA |

### SQL Backup Command:
```bash
npx wrangler d1 export agri-nile-flow-data-lake --remote --output=backup_pre_migration.sql
```

---

## 7️⃣ CORRECTED SCRIPT MODIFICATIONS NEEDED

### Changes to `CORRECTED_POSTING_SETUP.sql`:

1. **Remove DELETE statements** - Use INSERT OR REPLACE instead
2. **Add account verification step** before inserts
3. **Add missing PPGs** (SEED, CHEM, HARVEST)
4. **Use existing accounts where possible**:
   - 14070101-14070106 exist ✅
   - 11030001 exists ✅
   - 41010001 exists ✅
5. **Create missing accounts first** in same transaction

### Modified Account Mapping:

| Proposed | Alternative (if missing) | Status |
|----------|--------------------------|--------|
| 14070107 (fuel) | Use 14070106 (مخزن متنوع) temporarily | ⚠️ |
| 14070401 (finished) | Use 140701 (المخزون-المحصول) temporarily | ⚠️ |
| 13500001 (WIP) | Must be created | 🔴 |
| 5501xxxx (COGS) | Must be created | 🔴 |

---

## 8️⃣ RISK ASSESSMENT

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Posting failures due to missing accounts | HIGH | CRITICAL | Create all accounts first |
| Transaction routing errors | MEDIUM | HIGH | Comprehensive testing |
| Historical data inconsistency | LOW | MEDIUM | Keep old accounts as archive |
| VAT compliance issues | HIGH | CRITICAL | Test VAT scenarios thoroughly |
| User confusion from account changes | MEDIUM | LOW | Training + documentation |

---

## ✅ CONCLUSION

**Status:** ⚠️ **NOT READY FOR PRODUCTION**

**Blockers:**
1. All 18 COGS accounts in current setup don't exist in CoA
2. 14 required accounts missing from chart_of_accounts
3. 3 PPGs (SEED, CHEM, HARVEST) not covered in general_posting_setup

**Recommendation:**
Execute **Phase 1 (Account Creation)** first, then verify, then proceed with posting setup changes.

**Estimated Timeline:**
- Account creation: 30 minutes
- Testing: 2-4 hours
- Production deployment: 1 hour (with backup)

---

## 📎 APPENDIX: Current vs Proposed Account Summary

### Current General Posting Setup (18 rows):
```
BPG: AGRI-OP, DOMESTIC, EXPORT, INTERNAL
PPG: BEET, EQUIP, FERT, FUEL, MISC, SEEDS, SERV
```

### Missing from Proposed Script:
```
PPG: SEED, CHEM, HARVEST (need to add)
BPG: CUSTOMER, GOVT, IMPORT, LABOR, LOCAL (may need coverage)
```

### Account Creation Priority:
```
🔴 Must Create: 13500001, 55010001-55010005, 62010001-62010003
🟡 Should Create: 14070107, 14070401, 14040711, 21060001, 14030001, 21100001, 15900001
🟢 Already Exist: 41010001, 11030001, 14070101-14070106
```
