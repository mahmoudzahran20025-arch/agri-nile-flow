# Phase 4: Code Updates Status

## Updated Functions

### ✅ resolveCashLedger (Line 893)
**Status**: UPDATED  
**Change**: Added source_ledger='cash' + source_record_id=opts.ref_id to blueprint.lines  
**Effect**: All new cash transaction postings will now have source tracking

```typescript
// BEFORE:
lines: blueprint.lines,

// AFTER:
lines: blueprint.lines.map(l => ({
  ...l,
  source_ledger: 'cash',
  source_record_id: opts.ref_id,
})),
```

---

## Remaining Functions to Update

Need to add similar source tracking to these functions (pattern is the same):

1. **Line 396** - postFromBusinessEvent call (inventory/supplier/etc)
2. **Line 444** - postFromBusinessEvent call
3. **Line 637** - postFromBusinessEvent call (harvest revenue)
4. **Line 666** - postFromBusinessEvent call (harvest cost)
5. **Line 749** - postFromBusinessEvent call (supplier invoice)
6. **Line 809** - postFromBusinessEvent call (supplier payment)
7. **Line 925** - postManualEntry (should use 'manual')
8. **Line 954** - postFromBusinessEvent call
9. **Line 1006** - postFromBusinessEvent call
10. **Line 1060** - postFromBusinessEvent call
11. **Line 1113** - postFromBusinessEvent call
12. **Line 1184** - postFromBusinessEvent call
13. **Line 1231** - postFromBusinessEvent call
14. **Line 1288** - postFromBusinessEvent call
15. **Line 1330** - postFromBusinessEvent call
16. **Line 1380** - postFromBusinessEvent call
17. **Line 1427** - postFromBusinessEvent call

---

## Pattern for Updates

For each postFromBusinessEvent call:

1. **Identify the source type** (inventory, supplier, cash, payroll, etc.)
2. **Find the ref_id parameter** (usually opts.ref_id or similar)
3. **Map lines to add source tracking**:

```typescript
// Pattern
lines: blueprint.lines.map(l => ({
  ...l,
  source_ledger: '<type>', // 'cash', 'supplier', 'inventory', 'payroll', etc.
  source_record_id: <ref_id_value>,
})),
```

---

## Current Changes Summary

- ✅ Interface updated (EventBackedPostOpts.lines now includes source_ledger + source_record_id)
- ✅ GL insertion updated (gl.ts now inserts source_ledger + source_record_id)
- ✅ resolveCashLedger updated (adds source_ledger='cash')
- ⏳ All other posting functions (16 more locations)

---

## Approach for Remaining Updates

The simplest approach is to run a batch find-and-replace across the remaining postFromBusinessEvent calls.

Each should follow this pattern:

**Before**:
```typescript
return await postFromBusinessEvent(db, {
  // ... options ...
  lines: blueprint.lines,
})
```

**After**:
```typescript
return await postFromBusinessEvent(db, {
  // ... options ...
  lines: blueprint.lines.map(l => ({
    ...l,
    source_ledger: '<SOURCE_TYPE>',
    source_record_id: <source_id>,
  })),
})
```

Where:
- `<SOURCE_TYPE>` is determined by context (cash, supplier_invoice, supplier_payment, inventory, payroll, etc.)
- `<source_id>` is the ref_id being passed to the posting function

---

## Next Steps

1. Update remaining 16 posting functions with source_ledger mapping
2. TypeScript compile check: `npm run type-check`
3. Test in dev: Post new transaction, verify source_ledger is set
4. Commit changes
5. Deploy to production

---

## Time Estimate

- Manual updates of 16 functions: ~30 minutes
- Type checking: ~5 minutes
- Dev testing: ~15 minutes
- **Total Phase 4**: ~50 minutes

---

## Approval to Proceed?

After completing cash posting update, ready to:
1. Update remaining 16 functions
2. Run type-check
3. Test new postings
4. Deploy

**Shall we continue with batch updates?** YES / NO

