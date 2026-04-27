# GL Module — Governance README
**Version:** 1.0  
**Last Updated:** 2026-04-27  
**Owner:** ERP Backend Team  

---

## Overview

The General Ledger (GL) module is the financial backbone of Agri-Nile Flow ERP. It records every monetary event as double-entry journal entries and generates all standard financial reports (trial balance, income statement, balance sheet).

The module operates in **two phases**:

| Phase | Path | Status |
|-------|------|--------|
| Phase 3 (Legacy) | Static `gl_account_mappings` key-value store | **ACTIVE** |
| Phase 4 (Posting Groups) | MS Dynamics–style BPG × PPG × IPG matrix via `posting_engine.ts` | **Built, not yet enabled** |

---

## Module Structure

```
src/
├── lib/
│   ├── gl.ts              — Core primitives: postAutoEntry, glInventoryMovement, etc.
│   ├── finance_core.ts    — Orchestration: FinanceCore.recordCashMovement, processPOReceipt
│   └── posting_engine.ts  — Phase 4 engine: zero-data-safe account resolution
├── api/
│   └── gl.ts              — 21 REST endpoints under /api/gl/

web/src/
├── api/gl.ts              — Frontend client wrapper + typed interfaces
├── pages/gl/
│   ├── PostingGroupsPage.tsx       — BPG/PPG/IPG management
│   ├── PostingSetupPage.tsx        — Setup matrix management
│   └── PostingSetupHealthPage.tsx  — Health dashboard
└── components/
    ├── forms/AddSupplierModal.tsx  — BPG assignment
    ├── forms/AddItemModal.tsx      — PPG assignment
    └── ui/PostingValidation.tsx    — Dry-run journal preview widget
```

---

## Key Database Tables

| Table | Purpose | Rows (2026-04-27) |
|-------|---------|------------------|
| `journal_entries` | Journal entry headers | 955 |
| `journal_entry_lines` | DR/CR lines (always 2 per entry) | 1,910 |
| `chart_of_accounts` | Account master | 349 |
| `gl_account_mappings` | Phase 3 static mappings | 19 |
| `financial_periods` | Fiscal periods (open/close control) | 4 |
| `gl_integration_settings` | Feature flags per module | 5 rows |
| `business_posting_groups` | BPG master (Phase 4) | 0 (empty slate) |
| `product_posting_groups` | PPG master (Phase 4) | 0 |
| `inventory_posting_groups` | IPG master (Phase 4) | 0 |
| `general_posting_setup` | BPG × PPG → account matrix | 0 |
| `inventory_posting_setup` | IPG × PPG → inventory account | 0 |

---

## Governance Rules

### NEVER do this
- ❌ Manually `INSERT` or `UPDATE` rows in `journal_entries` or `journal_entry_lines`
- ❌ Delete posted journal entries (use the `/api/gl/entries/:id/reverse` endpoint)
- ❌ Close a financial period while transactions are in progress
- ❌ Add a GL mapping (`gl_account_mappings`) that points to a non-existent CoA account
- ❌ Enable `posting_engine` before catch-all setup rows exist
- ❌ DROP or RENAME any GL table
- ❌ Set `is_active = 0` on a posting group that has entities assigned to it

### Always do this
- ✅ All D1 operations via `--remote` flag
- ✅ Check health dashboard (`/gl/posting-setup/health`) before enabling engine
- ✅ Run `CLEANUP_GL_MODULE.sql` (Section 1 checks only) monthly to verify integrity
- ✅ Use the dry-run validate endpoint before saving new setup rows
- ✅ Create reversing entries instead of deleting mistakes
- ✅ Assign a financial period before any transaction date

---

## Adding a New Transaction Type

1. **Identify DR/CR accounts** — determine which accounts debit and which credit.
2. **Add a new `resolve*` function** in `src/lib/posting_engine.ts` following the existing pattern (see `resolveSupplierInvoice` as template).
3. **Add a bridge function** in `src/lib/gl.ts` for the legacy path.
4. **Add the feature-flag branch** in `src/lib/finance_core.ts` (check `isIntegrationEnabled`).
5. **Add a validation endpoint** case in `POST /api/gl/posting-setup/validate`.
6. **Test with dry-run** before enabling in production.

---

## Enabling the Posting Engine

Follow these steps in order:

```bash
# Step 1: Create BPG, PPG, IPG groups via UI
# Navigate to: /gl/posting-groups

# Step 2: Create setup matrix rows via UI
# Navigate to: /gl/posting-setup
# Create at minimum one NULL×NULL catch-all row for each table

# Step 3: Verify health check passes
curl https://agri-nile-flow.workers.dev/api/gl/posting-setup/health
# Must return: { "is_ready": true }

# Step 4: Edit wrangler.toml
# Change: ENABLE_POSTING_ENGINE = "false"
# To:     ENABLE_POSTING_ENGINE = "true"

# Step 5: Redeploy
npm run deploy

# Step 6: Enable in DB (final unlock)
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command \
  "UPDATE gl_integration_settings SET is_enabled = 1 WHERE company_id = 1 AND module_key = 'posting_engine';"
```

---

## Error Codes Reference

| Code | Meaning | Resolution |
|------|---------|-----------|
| `GL_UNBALANCED` | DR ≠ CR in entry being posted | Bug in caller — fix line amounts |
| `GL_CLOSED_PERIOD` | No open period for the transaction date | Open a period in `/gl/periods` |
| `GL_MAPPING_MISSING` | Required `gl_account_mappings` key not set | Add mapping in GL Settings |
| `PG-GPS-001` | No `general_posting_setup` row matched | Create catch-all row in Posting Setup |
| `PG-GPS-002` | A required account column is NULL in setup | Edit the setup row, fill the account |
| `PG-INV-001` | No `inventory_posting_setup` row matched | Create catch-all row in Inventory Setup |
| `PG-INV-002` | `inventory_account` is NULL in setup row | Edit the setup row |
| `PG-ACCT-001` | Resolved account doesn't exist in CoA | Create the account in Chart of Accounts |
| `PG-ACCT-002` | Resolved account is inactive | Activate the account in CoA |
| `PG-WARN-001` | Posting group code not found (advisory) | Assign valid posting group to entity |

---

## Weekly Maintenance Checklist

- [ ] Visit `/gl/posting-setup/health` — confirm no blocking issues
- [ ] Check `system_error_logs` for `endpoint = 'GL_ENGINE'` entries
- [ ] Verify all new suppliers have `bus_posting_group_code` assigned
- [ ] Verify all new items have `prod_posting_group_code` assigned
- [ ] Verify all new warehouses have `inv_posting_group_code` assigned
- [ ] Run Section 1 of `CLEANUP_GL_MODULE.sql` (integrity checks only)

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [AUDIT_GL_MODULE.md](../AUDIT_GL_MODULE.md) | Full audit report (2026-04-27) |
| [CLEANUP_GL_MODULE.sql](../CLEANUP_GL_MODULE.sql) | Safe cleanup & seed script |
| [GL_MODULE_DECISIONS.md](../GL_MODULE_DECISIONS.md) | Architecture decision log |
| [GL_MODULE_GOVERNANCE_REPORT.md](../GL_MODULE_GOVERNANCE_REPORT.md) | Executive governance report |
| [SESSION_NOTES.md](../SESSION_NOTES.md) | Phase 4 implementation summary |
| [migrations/AUDIT_ghost_mappings.md](../migrations/AUDIT_ghost_mappings.md) | Ghost mapping resolution history |
