# 🔍 Frontend Issues Analysis Report
**Date**: April 30, 2026  
**Scope**: GL/Finance Module Frontend

---

## ⚠️ CRITICAL ISSUES (Must Fix)

### 1. **Hardcoded Old COGS Account References**
**File**: `PostingSetupPage.tsx` (Line 23-25, 83, 211)

```typescript
// Line 23-25: Validation checks for COGS
function hasGeneralCoreGaps(row: GeneralSetupRow) {
  return !row.sales_account || !row.purchases_account || !row.cogs_account
}

// Line 83: Validation message
if (!toNullable(form.cogs_account)) issues.push('COGS account is required');

// Line 211: Account picker
{acctField('Cost of Goods Sold (COGS)', 'cogs_account', 'expense', true)}
```

**Issue**: The page validates and requires `cogs_account` but the new PPGs (SEED, CHEM, HARVEST) have **different** COGS accounts (55010001-55010005). The current UI suggests a single COGS per BPG×PPG row, but the new structure has **crop-specific COGS**.

**Impact**: Users will be confused about which COGS to use. The UI implies one COGS per setup row, but the backend rules use specific COGS per PPG.

**Fix Required**: 
- Remove COGS from General Setup UI (it's now rule-driven)
- OR show read-only COGS based on selected PPG
- OR add PPG-specific COGS mapping display

---

### 2. **PostingGroupSelector Missing New PPGs**
**File**: `PostingSetupPage.tsx`, `PostingSimulatorPage.tsx`

**Issue**: The `PostingGroupSelector` component loads PPGs from API (`glApi.postingGroups('product')`), but:
- No verification that new PPGs (SEED, CHEM, HARVEST, EQUIP_CAP, EQUIP_CONS) appear
- No handling if PPG is missing from dropdown but exists in items

**Impact**: If API doesn't return new PPGs, users can't select them.

**Verification Needed**:
```bash
# Test this API endpoint
curl /gl/posting-groups/product
# Should return: SEED, CHEM, HARVEST, EQUIP_CAP, EQUIP_CONS
```

---

### 3. **Missing WIP Account in Inventory Setup UI**
**File**: `PostingSetupPage.tsx` - `InventorySetupTab`

**Issue**: The Inventory Setup only shows `inventory_account` field (Line 397):
```typescript
<AccountPicker value={acct || null} onChange={value => setAcct(value ?? '')} accountType="asset" label="Inventory Account" required />
```

But WIP requires **two** accounts:
- WIP Account (13500001) for WIP IPG
- Finished Goods Account (14070401) for FG IPG

**Impact**: Users can't configure WIP → Finished Goods flow properly.

**Fix Required**: Add WIP account picker when IPG = 'WIP'.

---

## 🔶 HIGH PRIORITY ISSUES

### 4. **No Visibility into Posting Rules Status**
**File**: `PostingSetupPage.tsx`

**Issue**: The UI shows General/Inventory Setup but has **no indicator** for:
- Which posting rules are active/inactive
- Conflicts between rules and setup
- COGS accounts defined in rules vs setup

**Current State**: 8 old rules disabled (is_active=0), 9 new rules active (is_active=1)

**Impact**: Users see setup rows but don't know which rules apply or if they conflict.

**Fix Required**: Add "Rules Status" section showing:
- Active rules per PPG
- Disabled (legacy) rules count
- Warnings for mismatches

---

### 5. **Posting Simulator Doesn't Validate COGS Resolution**
**File**: `PostingSimulatorPage.tsx`

**Issue**: The simulator validates posting but doesn't specifically verify:
- COGS account resolution per PPG
- VAT account selection (14040711 vs 21060001)
- WIP account usage in Harvest scenario

**Test Gap**: Line 18 only has these transaction types:
```typescript
type TxType = 'inventory_in' | 'inventory_out' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
```

Missing: **'harvest'** (WIP → Finished) - critical for agriculture!

**Fix Required**: Add 'harvest' TxType to simulator.

---

### 6. **AccountPicker Filter Too Restrictive**
**File**: `PostingSetupPage.tsx` (Line 156, 209-214)

```typescript
const acctField = (label: string, field: keyof GeneralFormState, accountType: 'asset' | 'revenue' | 'expense' = 'asset', required = false) => (
  <AccountPicker value={form[field] || null} onChange={value => setForm(prev => ({ ...prev, [field]: value ?? '' }))} accountType={accountType} label={label} required />
)
```

**Issue**: COGS picker uses `accountType='expense'` (Line 211), but new COGS accounts (55010001-55010005) must be correctly typed as 'expense' in chart_of_accounts.

**Verification Needed**: Check that 55010001-55010005 have `account_type = 'expense'`.

---

## 🔸 MEDIUM PRIORITY ISSUES

### 7. **No Item-PPG Linkage Visibility**
**File**: Missing - No page shows Item → PPG assignments

**Issue**: After remapping 29 items to new PPGs, there's **no UI** to:
- View which items use which PPG
- Bulk edit item PPG assignments
- Validate all items have PPGs

**Current Orphans**: 34 items still in FUEL/MISC/SERV or without PPG.

**Fix Required**: Create "Item Posting Groups" page or add to existing Items page.

---

### 8. **Missing VAT Account in AccountPicker Filters**
**File**: `PostingSimulatorPage.tsx` (Lines 295-301)

```typescript
{(accounts ?? []).filter(a => a.account_type === 'liability' || a.account_type === 'payable').map(a => (
  <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
))}
```

**Issue**: VAT Output (21060001) is liability, but VAT Input (14040711) is asset. The AP picker only shows liability/payable, so users can't select VAT Input for purchase invoices.

**Impact**: Users can't properly simulate purchase with VAT.

**Fix Required**: Add 'asset' to AP account filter for VAT Input, or create separate VAT account selector.

---

### 9. **Inconsistent Error Handling**
**File**: `PostingSetupPage.tsx` (Lines 150, 225, 372)

```typescript
onError: async (e: unknown) => setErr((e as { message?: string })?.message ?? 'حدث خطأ'),
```

**Issue**: Arabic fallback message 'حدث خطأ' without context. Error doesn't specify if it's:
- Validation error
- Database constraint
- Missing account
- Duplicate key

**Fix Required**: Better error parsing and user-friendly messages.

---

## 📊 SUMMARY MATRIX

| Issue | Severity | File(s) | Effort | Risk if Not Fixed |
|-------|----------|---------|--------|-------------------|
| Hardcoded COGS references | 🔴 Critical | PostingSetupPage.tsx | 2 hrs | Wrong COGS postings |
| Missing new PPGs in dropdown | 🔴 Critical | PostingSimulatorPage.tsx, PostingSetupPage.tsx | 1 hr | Can't use new PPGs |
| Missing WIP account UI | 🔴 Critical | PostingSetupPage.tsx | 2 hrs | Broken WIP flow |
| No rules visibility | 🟠 High | PostingSetupPage.tsx | 3 hrs | Confusion, errors |
| Missing 'harvest' TxType | 🟠 High | PostingSimulatorPage.tsx | 1 hr | Can't test harvest |
| AccountPicker filters | 🟠 High | PostingSetupPage.tsx, PostingSimulatorPage.tsx | 1 hr | Wrong account selection |
| No Item-PPG visibility | 🟡 Medium | New page needed | 4 hrs | Orphan items |
| VAT account filtering | 🟡 Medium | PostingSimulatorPage.tsx | 1 hr | VAT errors |
| Error handling | 🟡 Medium | Multiple | 2 hrs | Poor UX |

---

## 🎯 RECOMMENDED FIX ORDER

### Phase 1 (Immediate - Today):
1. ✅ Verify new PPGs appear in API `/gl/posting-groups/product`
2. ✅ Fix COGS account validation (remove or make read-only)
3. ✅ Add WIP account field to Inventory Setup

### Phase 2 (This Week):
4. Add 'harvest' transaction type to simulator
5. Fix VAT account filtering
6. Add posting rules visibility section

### Phase 3 (Next Sprint):
7. Create Item-PPG linkage page
8. Improve error handling

---

## 🧪 VERIFICATION CHECKLIST

- [ ] API returns new PPGs: SEED, CHEM, HARVEST, EQUIP_CAP, EQUIP_CONS
- [ ] Account 55010001-55010005 have `account_type = 'expense'`
- [ ] Account 14040711 has `account_type = 'asset'`
- [ ] Account 21060001 has `account_type = 'liability'`
- [ ] Posting Simulator dropdown shows new PPGs
- [ ] COGS field is disabled/read-only in General Setup
- [ ] WIP Account field appears when IPG = 'WIP'

---

**Report Generated**: April 30, 2026  
**Next Review**: After Phase 1 fixes
