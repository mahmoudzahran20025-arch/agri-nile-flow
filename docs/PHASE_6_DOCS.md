# PHASE_6_DOCS.md — GL Financial Module Technical Reference
**Agri-Nile Flow ERP** · April 2026

---

## System Overview

Agri-Nile Flow uses a **Microsoft Dynamics-style posting-groups** accounting engine deployed on **Cloudflare Workers + D1** (SQLite). Every financial transaction (supplier invoice, inventory movement, payroll, expense) is resolved through the Posting Engine to produce a `ValidationBlueprint` which is then committed as a double-entry journal entry.

```
Transaction Request
       │
       ▼
 FinanceCore.resolve*()         ← src/lib/finance_core.ts
       │
       ▼
 PostingEngine.resolve*()       ← src/lib/posting_engine.ts
       │  (reads general_posting_setup / inventory_posting_setup with 5-min cache)
       ▼
 ValidationBlueprint            ← { lines: [{account_code, debit, credit}], warnings, isBlocked }
       │
       ▼
 GL.postAutoEntry()             ← src/lib/gl.ts
       │
       ▼
 journal_entries + journal_entry_lines  (D1)
```

---

## API Reference

### Authentication
All GL routes require JWT Bearer token. Role must be one of: `super_admin`, `company_admin`, `accountant`.

```
Authorization: Bearer <jwt>
```

---

### Chart of Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gl/accounts` | List accounts. `?type=asset\|liability\|equity\|revenue\|expense` filter. `?leaf=1` excludes header accounts. |
| `POST` | `/api/gl/accounts` | Create account. Body: `{code, name, account_type, parent_code?, normal_balance?, is_header?, notes?}` |
| `PATCH` | `/api/gl/accounts/:code` | Update account fields. |
| `DELETE` | `/api/gl/accounts/:code` | Soft-delete (sets `is_active=0`). |

**Response shape:**
```json
{ "success": true, "data": [ { "code": "1101", "name": "Cash", "account_type": "asset", ... } ] }
```

---

### Posting Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gl/posting-groups?type=business\|product\|inventory` | List groups of given type. |
| `POST` | `/api/gl/posting-groups` | Create group. Body: `{type, code, name, description?}` |
| `PATCH` | `/api/gl/posting-groups/:id` | Update name/description/active flag. |

**Group types:**
- `business` (BPG) — assigned to suppliers/customers (e.g. LOCAL, EXPORT)
- `product` (PPG) — assigned to items/categories (e.g. FERT, SEED)
- `inventory` (IPG) — assigned to warehouses (e.g. FIELD, STORE)

---

### General Posting Setup (BPG × PPG matrix)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gl/posting-setup/general` | List all matrix rows for company. |
| `POST` | `/api/gl/posting-setup/general` | Create row. `bus_posting_group_code=null` means wildcard (catch-all). |
| `PATCH` | `/api/gl/posting-setup/general/:id` | Update account assignments. Cache cleared automatically. |

**Body for POST:**
```json
{
  "bus_posting_group_code": "LOCAL",
  "prod_posting_group_code": "FERT",
  "sales_account": "4101",
  "purchases_account": "5101",
  "cogs_account": "5201",
  "expense_account": "6101"
}
```

**NULL × NULL** (both codes null) is the **catch-all default** row. Always required.

---

### Inventory Posting Setup (IPG × PPG matrix)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gl/posting-setup/inventory` | List all inventory setup rows. |
| `POST` | `/api/gl/posting-setup/inventory` | Create row. |
| `PATCH` | `/api/gl/posting-setup/inventory/:id` | Update inventory_account. Cache cleared automatically. |

---

### Posting Validation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/gl/posting-setup/validate` | Dry-run a posting scenario. Returns `ValidationBlueprint`. |

**Body:**
```json
{
  "type": "supplier_invoice",
  "bpg_code": "LOCAL",
  "ppg_code": "FERT",
  "ap_code": "2110",
  "amount": 50000
}
```

**Supported types:** `inventory_in`, `inventory_out`, `supplier_invoice`, `supplier_payment`, `expense`, `revenue`

**Response:**
```json
{
  "success": true,
  "data": {
    "lines": [
      { "account_code": "5101", "account_name": "Purchases", "debit": 50000, "credit": 0 },
      { "account_code": "2110", "account_name": "Accounts Payable", "debit": 0, "credit": 50000 }
    ],
    "totalDebit": 50000,
    "totalCredit": 50000,
    "isBlocked": false,
    "warnings": []
  }
}
```

---

### Setup Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gl/posting-setup/health` | Returns count of covered BPG×PPG combinations, missing catch-all warning, etc. |

---

### Journal Entries

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gl/entries` | List entries. `?start=&end=&posted=0\|1` |
| `POST` | `/api/gl/entries` | Manual journal entry. |
| `POST` | `/api/gl/entries/:id/post` | Post (lock) a draft entry. |

---

### Financial Statements

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gl/reports/trial-balance` | Trial balance. `?start=&end=` |
| `GET` | `/api/gl/reports/income-statement` | Income statement. `?start=&end=` |
| `GET` | `/api/gl/reports/balance-sheet` | Balance sheet snapshot. `?asOf=` |

---

### Deprecated Endpoints

The following endpoints are kept for backward-compat but will be removed after **August 1, 2026**.
Responses include `Deprecation` and `Sunset` headers.

| Method | Endpoint | Replacement |
|--------|----------|-------------|
| `GET` | `/api/gl/mappings` | `/api/gl/posting-setup/general` |
| `PUT` | `/api/gl/mappings` | `PATCH /api/gl/posting-setup/general/:id` |

---

## Database Schema

### Key GL Tables

| Table | Purpose |
|-------|---------|
| `chart_of_accounts` | Master account list. Columns: `code, name, account_type, normal_balance, parent_code, is_header, is_active` |
| `journal_entries` | Entry headers. Columns: `entry_date, entry_type, ref_type, ref_id, is_posted, period_id` |
| `journal_entry_lines` | Double-entry lines. Columns: `entry_id, account_code, debit, credit, description` |
| `financial_periods` | Accounting periods. `is_closed=1` prevents new entries. |
| `business_posting_groups` | BPG master list per company. |
| `product_posting_groups` | PPG master list per company. |
| `inventory_posting_groups` | IPG master list per company. |
| `general_posting_setup` | BPG×PPG matrix → account codes. |
| `inventory_posting_setup` | IPG×PPG matrix → inventory account. |
| `gl_account_mappings` | **Deprecated.** Legacy key→account map. `deprecated_at` column marks migrated rows. |

### Active Indexes (as of migrations 0043–0044)

| Index | Table | Columns |
|-------|-------|---------|
| `idx_je_company_posted` | `journal_entries` | `company_id, is_posted, entry_date` |
| `idx_je_company_ref` | `journal_entries` | `company_id, ref_type, ref_id` |
| `idx_jel_entry_id` | `journal_entry_lines` | `entry_id` |
| `idx_jel_account` | `journal_entry_lines` | `account_code, company_id` |
| `idx_coa_company_type` | `chart_of_accounts` | `company_id, account_type, is_active` |
| `idx_gps_company_active` | `general_posting_setup` | `company_id, is_active, bpg, ppg` |
| `idx_ips_company_active` | `inventory_posting_setup` | `company_id, is_active, ipg, ppg` |
| `idx_suppliers_bpg` | `suppliers` | `company_id, bus_posting_group_code` |
| `idx_items_ppg` | `items` | `company_id, prod_posting_group_code` |
| `idx_warehouses_ipg` | `warehouses` | `company_id, inv_posting_group_code` |

---

## Integration Points

### How Supplier Invoices Are Posted

```
POST /api/purchasing/invoices/:id/post
  → FinanceCore.resolveSupplierInvoice(db, company_id, supplier.bus_posting_group_code, item.prod_posting_group_code, ap_account, amount)
    → peResolveSupplierInvoice() → general_posting_setup lookup (with 5-min cache)
    → ValidationBlueprint: DR purchases_account / CR ap_account
  → postAutoEntry() → journal_entries + journal_entry_lines
```

### How Inventory Movements Are Posted

```
Inventory IN  → DR inventory_account / CR purchases_account
Inventory OUT → DR cogs_account / CR inventory_account
(resolved via inventory_posting_setup IPG×PPG matrix)
```

### Cache Invalidation

The posting engine caches `general_posting_setup` and `inventory_posting_setup` rows for **5 minutes** (in-memory, per Worker instance). Cache is cleared immediately whenever a `POST` or `PATCH` to `/api/gl/posting-setup/general` or `/api/gl/posting-setup/inventory` succeeds.

```typescript
// Called automatically by all setup-mutating routes:
clearPostingEngineCaches()   // src/lib/posting_engine.ts
```

The frontend `AccountPicker` component uses a **10-minute localStorage cache** for chart-of-accounts data (key: `gl-coa-cache:{type}`). Call `invalidateCoaCache()` from `AccountPicker.tsx` after account changes.

---

## Deployment

### Apply Migrations

```powershell
# Apply a specific migration
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=migrations/0044_entity_posting_group_indexes.sql

# Apply all pending migrations in order
Get-ChildItem migrations/*.sql | Sort-Object Name | ForEach-Object {
  npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=$_.FullName
}
```

### Deploy Worker

```powershell
wrangler deploy
```

### Deploy Frontend

```powershell
cd web; npm run build
npx wrangler pages deploy dist --project-name=agri-nile-flow-lake
```

### Environment Variables (wrangler.toml)

| Variable | Value | Purpose |
|----------|-------|---------|
| `ENABLE_POSTING_ENGINE` | `"true"` | Activates posting-group resolution (must always be true) |
| `JWT_SECRET` | secret | JWT signing key |
| `APP_VERSION` | semver | Shown in debug page |

### Rollback Procedure

1. Indexes are additive (`CREATE INDEX IF NOT EXISTS`) — safe to leave in place.
2. Schema `ALTER TABLE ADD COLUMN` changes are additive — no rollback needed.
3. To revert a Worker deployment: `wrangler rollback`
4. To revert frontend: redeploy previous `dist/` via Pages dashboard.

---

## Performance Benchmarks (April 2026)

| Operation | Target | Notes |
|-----------|--------|-------|
| Posting setup lookup | < 10ms | Cached after first call per Worker instance |
| Transaction validation (`/validate`) | < 100ms | Cold cache D1 query |
| Journal entry creation | < 200ms | D1 batch write |
| Trial balance (500 accounts) | < 1s | Indexed scan on `journal_entry_lines` |
| Financial report generation | < 2s | Aggregated via SQL GROUP BY |
| Frontend initial load | ~320KB gzip | Chunked: vendor-charts is largest at 412KB |

---

## Error Codes

| HTTP | `success` | `error` message | Cause |
|------|-----------|-----------------|-------|
| 400 | false | الكود والاسم والنوع مطلوبة | Missing required fields |
| 400 | false | الحساب الأب ... غير موجود | Invalid parent_code |
| 400 | false | تحديث الشجرة يسبب دورة | Circular parent reference |
| 409 | false | A setup row ... already exists | Duplicate BPG×PPG combination |
| 404 | false | Not found | Row not found or wrong company |
| 422 | false | ap_code required for supplier_invoice | Missing required posting code |
| 423 | false | Period is closed | Financial period locked |
| 500 | false | Internal error | Unexpected DB/Worker error |
