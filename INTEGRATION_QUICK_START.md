# 🚀 IMMEDIATE ACTION: Integration in 4 Steps (30 minutes)

**Status:** May 10, 2026, 3:00 PM UTC  
**Goal:** Deploy Traceability Phases 2 & 3 to production  
**Time:** ~30 minutes

---

## ✅ STEP 1: Register Backend Routes (5 min)

**File:** `src/index.ts` (or wherever your routes are registered)

**Add these 3 lines:**
```typescript
import journalEntryEngine from './api/gl/journal_entry_regeneration';
import enhancedLedger from './api/gl/enhanced_ledger';

// ... existing code ...

// Add after other route registrations:
app.route('/api/gl', journalEntryEngine);
app.route('/api/gl', enhancedLedger);
```

✓ **Why:** Registers new endpoints:
  - POST /rebuild
  - GET /progress
  - GET /reconciliation-report
  - GET /ledger/:code (enhanced)
  - GET /ledger/:code/trace-info
  - GET /ledger/:code/export

---

## ✅ STEP 2: Update API Client (5 min)

**File:** `web/src/api/gl.ts`

**Find this function:**
```typescript
export const ledger = (code: string, start?: string, end?: string, page: number = 1, size: number = 100) => {
```

**Replace with:**
```typescript
export const ledger = (
  code: string,
  start?: string,
  end?: string,
  page: number = 1,
  size: number = 100,
  search?: string,
  refType?: string
) => {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
    ...(start && { start }),
    ...(end && { end }),
    ...(search && { search }),
    ...(refType && { refType }),
  });
  return client.get(`/gl/ledger/${code}?${params}`);
};
```

✓ **Why:** Passes search and refType to backend so filtering happens server-side.

---

## ✅ STEP 3: Fix Account Ledger Page (10 min)

**File:** `web/src/pages/gl/AccountLedgerPage.tsx`

### Change 1 (Line ~76):
```typescript
// OLD
const { data, isLoading } = useQuery({
  queryKey: ['gl-ledger', code, start, end, page, pageSize],
  
// NEW
const { data, isLoading } = useQuery({
  queryKey: ['gl-ledger', code, start, end, page, pageSize, search, refType],
```

### Change 2 (Line ~77):
```typescript
// OLD
queryFn: () => glApi.ledger(code!, start, end, page, pageSize),

// NEW
queryFn: () => glApi.ledger(code!, start, end, page, pageSize, search || undefined, refType || undefined),
```

### Change 3 (Lines ~102-120):
```typescript
// DELETE THIS ENTIRE BLOCK (local filtering):
const filteredLines = lines.filter((l) => {
  const q = search.trim().toLowerCase();
  const byText = !q
    || (l.narration ?? '').toLowerCase().includes(q)
    || (l.entry_desc ?? '').toLowerCase().includes(q)
    || String(l.entry_id).includes(q);
  const byRef = !refType || l.ref_type === refType;
  return byText && byRef;
});

const totalDebit  = filteredLines.reduce((s, l) => s + (l.debit  ?? 0), 0);
const totalCredit = filteredLines.reduce((s, l) => s + (l.credit ?? 0), 0);
```

### Change 4 (Replace with):
```typescript
// All filtering is now on server-side, use lines directly
const totalDebit  = lines.reduce((s, l) => s + (l.debit  ?? 0), 0);
const totalCredit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
```

### Change 5 (In table body, ~line 200):
```typescript
// OLD
{filteredLines.map((line) => (

// NEW
{lines.map((line) => (
```

✓ **Why:** Removes client-side filtering so search/filter are applied by backend.

---

## ✅ STEP 4: Build & Deploy (10 min)

**Terminal:**
```bash
cd "C:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow"

# Build backend & frontend
npm run build:backend
npm run build:web

# Deploy to Cloudflare
wrangler deploy

# Deploy frontend
wrangler pages deploy web/dist --project-name=agri-nile-flow --commit-dirty=true
```

✓ **What happens:**
- Backend code is deployed to Cloudflare Workers
- Frontend is deployed to Cloudflare Pages
- New endpoints are live at: `https://your-workers-domain/api/gl/...`

---

## 🧪 VERIFICATION (5 min)

### Test 1: Backend Health
```bash
curl "https://your-api.workers.dev/api/gl/progress?company_id=1"
# Expected response: JSON with regeneration_progress metrics
```

### Test 2: Ledger Search (Server-Side)
```bash
# Test that search parameter is passed to backend
curl "https://your-api.workers.dev/api/gl/ledger/511403?start=2025-01-01&search=fuel"
# Expected: Results filtered by "fuel", all matching entries across all pages
```

### Test 3: Frontend Works
```bash
# Open in browser
http://localhost:5173/gl/ledger/511403

# Type search: "fuel"
# Check Network tab: Request to /api/gl/ledger/511403?search=fuel
# ✅ Search is sent to backend
```

---

## 🎯 EXPECTED BEHAVIOR

### Before Integration:
```
Search for "fuel" on Account Ledger Page
↓
Only searches current page (100 lines)
↓
If "fuel" is on page 3, user doesn't see it
↓
User thinks there are no fuel transactions ❌
```

### After Integration:
```
Search for "fuel" on Account Ledger Page
↓
Backend queries ALL journal_entry_lines for "fuel"
↓
Returns paginated results: "Showing 1-100 of 287 matches"
↓
User can see: "Found 287 fuel transactions, showing page 1" ✅
```

---

## 🛑 IF SOMETHING BREAKS

### Issue: "Cannot find journal_entry_regeneration module"
**Fix:** Check the file exists at `src/api/gl/journal_entry_regeneration.ts`
```bash
ls -la src/api/gl/journal_entry_regeneration.ts
```

### Issue: "API route not responding"
**Fix:** Verify routes are registered in `src/index.ts`
```bash
grep -n "journalEntryEngine\|enhancedLedger" src/index.ts
```

### Issue: "Search still doesn't work"
**Fix:** Check queryKey includes search/refType (with dependencies on them)
```typescript
// Should include search and refType:
queryKey: ['gl-ledger', code, start, end, page, pageSize, search, refType]
//                                                               ^^^^^^ ^^^^^^
```

### Issue: "Build fails"
**Fix:** Run TypeScript check
```bash
npx tsc --noEmit
```

---

## 📋 CHECKLIST

- [ ] Step 1: Routes registered in `src/index.ts`
- [ ] Step 2: API client updated (`web/src/api/gl.ts`)
- [ ] Step 3a: queryKey includes search/refType
- [ ] Step 3b: queryFn passes search/refType to glApi.ledger()
- [ ] Step 3c: Deleted local filtering block
- [ ] Step 3d: Changed `filteredLines` to `lines` in table
- [ ] Step 4: Build completed without errors
- [ ] Step 4: Deploy to Cloudflare completed
- [ ] Test 1: Backend /progress endpoint works
- [ ] Test 2: Search parameter is sent to backend
- [ ] Test 3: Frontend search works end-to-end

---

## ✅ SUCCESS CRITERIA

After deployment:
1. Account Ledger page loads without errors ✅
2. Search box sends query to backend (check Network tab) ✅
3. Results show total count across all pages ✅
4. Pagination works correctly ✅
5. Filtering by refType (Cash/Supplier/Inventory) works ✅
6. No 500 errors in console ✅

---

## 📞 NEXT STEPS (If Successful)

Once deployed, run:
```bash
# Start regeneration (dry run first)
curl -X POST "https://api.example.com/api/gl/rebuild?company_id=1&scope=full&dry_run=true"

# Then run for real
curl -X POST "https://api.example.com/api/gl/rebuild?company_id=1&scope=full"

# Monitor progress
curl "https://api.example.com/api/gl/progress?company_id=1"
```

---

**⏱️ Total Time:** ~30 minutes  
**Risk Level:** 🟢 Low (backward-compatible, no data deletion)  
**Rollback Time:** 2 minutes (redeploy previous version)  
**Support:** Check TRACEABILITY_IMPLEMENTATION_SUMMARY.md for detailed docs
