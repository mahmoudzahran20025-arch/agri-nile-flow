# GL Module — Architecture Decision Log
**Version:** 1.0  
**Last Updated:** 2026-04-27  
**Format:** ADR (Architecture Decision Record)

---

## ADR-001: Posting Groups over Static Account Mappings

**Status:** Accepted (Phase 4 implementation complete)  
**Date:** 2026 (Phase 4 planning)

### Context
Phase 3 used a flat `gl_account_mappings` table with string keys like `"inventory"`, `"cogs"`, `"accounts_payable"`. Every transaction resolved to the same account code regardless of who the supplier was, what product was being purchased, or which warehouse was being used.

This worked for early operations but creates problems at scale:
- A domestically-sourced fertilizer and an imported pesticide must hit different P&L lines
- A cold-storage warehouse has different inventory valuation than an open field store
- Different customer types (government vs. private) should debit different revenue streams

### Decision
Implement a **Microsoft Dynamics–style Posting Groups system** with three dimensions:
- **Business Posting Group (BPG):** Classifies the counterparty (supplier/customer)
- **Product Posting Group (PPG):** Classifies the item/product
- **Inventory Posting Group (IPG):** Classifies the warehouse

The intersection of these groups in a setup matrix determines which accounts to debit/credit.

### Alternatives Considered
1. **Add more mapping keys to `gl_account_mappings`** — Rejected. Would create an unmanageable flat list with no systematic structure.
2. **Tag accounts directly on suppliers/items** — Rejected. Duplicates CoA management onto every entity form; not scalable.
3. **Posting groups** — Selected. Industry standard (Dynamics 365, NAV). Provides a structured, maintainable matrix.

### Consequences
- (+) Flexible routing without code changes
- (+) Aligns with industry-standard ERP patterns — team knowledge is portable
- (+) A single NULL×NULL catch-all row is sufficient to start — no "big bang" data entry
- (-) More complex to understand for new developers
- (-) Requires setup before posting_engine can be enabled

---

## ADR-002: Dual-Path Architecture (Feature Flag, not Big Bang)

**Status:** Accepted (both paths active)  
**Date:** 2026 (Phase 4 planning)

### Context
The system has 955 existing journal entries and an active financial year. Switching the GL engine abruptly could break ongoing transactions if setup data is incomplete.

### Decision
Implement both paths simultaneously, controlled by `gl_integration_settings.is_enabled` for `module_key = 'posting_engine'`:

```
isIntegrationEnabled(db, company_id, 'posting_engine')
  false → old path (gl_account_mappings)
  true  → new path (posting_engine.ts)
```

The old path remains fully functional and is the current production path. The new path is built, tested, and ready to activate.

### Alternatives Considered
1. **Remove old path, force migration** — Rejected. Too risky mid-year. If setup data is wrong, every transaction breaks.
2. **A/B routing by transaction type** — Rejected. Creates inconsistent ledger where some entries use old accounts and some use new ones in the same period.
3. **Feature flag** — Selected. Safe, incremental, reversible.

### Consequences
- (+) Zero downtime migration path
- (+) Can revert instantly by flipping the flag
- (+) Old transactions remain valid under old account codes
- (-) Two code paths to maintain until migration is complete
- (-) Developers must understand both paths

---

## ADR-003: Feature Flag in Database vs. Environment Variable

**Status:** Both used (belt-and-suspenders)  
**Date:** 2026 (Phase 4 implementation)

### Context
The posting engine needs a kill switch that can be toggled without redeployment. Two mechanisms were available: `wrangler.toml` environment variables and the `gl_integration_settings` database table.

### Decision
Use **both**:
- `wrangler.toml`: `ENABLE_POSTING_ENGINE = "false"` — compile-time guard, requires redeploy to change
- `gl_integration_settings` row: `is_enabled` — runtime guard, changeable via SQL without redeploy

The database flag takes precedence at runtime. The `wrangler.toml` env var serves as a documentation signal and secondary safety.

### Alternatives Considered
1. **Only env var** — Rejected. Requires full redeploy to toggle. Slow to roll back in production.
2. **Only database flag** — Rejected. No visibility at deployment time; someone could accidentally enable it via a stray migration.
3. **Both** — Selected. Defense in depth.

### Consequences
- (+) Can toggle engine without redeployment via D1 SQL
- (+) `wrangler.toml` provides visible documentation of intent
- (-) Two places to check/update when enabling — must update both `wrangler.toml` AND the DB row

---

## ADR-004: NULL/NULL Catch-All Pattern

**Status:** Accepted  
**Date:** 2026 (Phase 4 design)

### Context
The posting_engine needs to resolve accounts for every transaction. If a supplier has no BPG assigned and an item has no PPG assigned, the engine must still work — it cannot block the entire operation due to missing master data.

### Decision
Implement a **4-step cascade** for account resolution:

```
Step 1: Look for exact BPG × PPG match
Step 2: Look for BPG × NULL (BPG wildcard, any PPG)
Step 3: Look for NULL × PPG (any BPG, PPG wildcard)
Step 4: Look for NULL × NULL (company-wide catch-all)
```

A single `general_posting_setup` row with `bus_posting_group_code = NULL` and `prod_posting_group_code = NULL` acts as the company-wide default. This is the minimum viable setup — one row unlocks all transactions.

### Alternatives Considered
1. **Require exact match, fail otherwise** — Rejected. Creates too many blocking errors during initial setup.
2. **Hardcode fallback accounts in code** — Rejected. Violates "no hardcoded account codes" constraint.
3. **NULL/NULL catch-all with cascade** — Selected. Mirrors Dynamics NAV / Business Central behavior.

### Consequences
- (+) System works with just one setup row during initial rollout
- (+) Specific posting groups improve accuracy without breaking existing entries
- (+) Zero-data-safe: engine never throws on missing groups — returns warnings instead
- (-) If catch-all is wrong, all unconfigured transactions will use wrong accounts

---

## ADR-005: Warnings vs. Errors in JournalBlueprint

**Status:** Accepted  
**Date:** 2026 (Phase 4 posting_engine.ts design)

### Context
When resolving posting groups, some situations are advisory (entity has no BPG assigned — using default) and some are blocking (no setup row exists at all). Both need to be communicated to the caller differently.

### Decision
`JournalBlueprint` carries two separate arrays:
- `warnings: string[]` — advisory, non-blocking. Transaction proceeds. Displayed to user as amber notices.
- `validationErrors: string[]` — blocking. Transaction must not proceed. Displayed as red errors.
- `isBlocked: boolean` — derived flag for quick caller check.

### Alternatives Considered
1. **Single `errors[]` array with severity codes** — Rejected. Harder to consume in calling code.
2. **Throw exceptions for errors** — Rejected. Makes the engine harder to use in dry-run mode.
3. **Separate arrays** — Selected. Clean caller API: `if (blueprint.isBlocked) return error`.

### Consequences
- (+) Callers have a simple boolean check (`isBlocked`)
- (+) Advisory warnings can be shown in UI without blocking transaction
- (+) Engine never throws — always returns a structured result
- (-) Callers must handle both arrays for complete UX

---

## ADR-006: Atomic Batch for Cash Transactions

**Status:** Accepted  
**Date:** 2026 (finance_core.ts design)

### Context
A cash transaction must atomically insert: the `cash_transactions` row, update running balances for subsequent rows, insert `journal_entries`, insert two `journal_entry_lines`, and optionally insert `supplier_transactions`. If any step fails, all must roll back.

### Decision
`FinanceCore.prepareCashMovement()` builds a `D1PreparedStatement[]` array and executes it via `db.batch()`. The journal entry INSERT uses a `local_id` string to allow the entry_lines to reference it via subquery within the same batch.

### Alternatives Considered
1. **Sequential INSERTs** — Rejected. Not atomic; partial failures leave orphan records.
2. **Call `postAutoEntry()`** — Rejected. `postAutoEntry` does its own `db.batch()` and cannot be composed into a larger batch.
3. **`db.batch()` with `local_id` subquery** — Selected. Fully atomic. D1 supports subqueries within the same batch.

### Consequences
- (+) All-or-nothing atomicity: no partial inserts
- (+) Single round trip to D1
- (-) More complex code than sequential INSERTs
- (-) `local_id` pattern is non-obvious — must document for future developers

---

## ADR-007: Zero-Data-Safe Engine Design

**Status:** Accepted  
**Date:** 2026 (posting_engine.ts architecture)

### Context
The posting engine is deployed to a live system with zero rows in the new posting group tables. It must not throw errors during deployment or while setup is being done via the UI.

### Decision
Every `resolve*` function in `posting_engine.ts` follows this contract:
1. Never throw an exception
2. Always return a `JournalBlueprint`
3. If data is missing: return `isBlocked: true` with descriptive `validationErrors`
4. If data is present but advisory: return `isBlocked: false` with `warnings`

The `checkPostingGroupExists` helper returns a `string | null` warning (never throws). The `blocked()` helper is the only way to return a blocked blueprint.

### Consequences
- (+) Safe to deploy before setup data exists
- (+) Callers never need try/catch around the engine
- (+) Error messages are user-actionable (include navigation hints)
- (-) Callers must check `isBlocked` — they cannot rely on exceptions as the error signal

---

## ADR-008: Migrations are Additive Only

**Status:** Accepted (standing constraint)  
**Date:** Project inception, reconfirmed Phase 4

### Context
Live financial data in D1 must never be lost. Any migration that drops, renames, or restructures tables risks data loss and breaks financial reports.

### Decision
All migrations must be:
- `CREATE TABLE IF NOT EXISTS` — safe to re-run
- `ALTER TABLE ... ADD COLUMN` — additive only
- `INSERT OR IGNORE` — idempotent seeds
- No `DROP TABLE`, `DROP COLUMN`, `RENAME TABLE`, `UPDATE` of existing rows, or `DELETE` of existing rows

Exception: FIX migrations (like `FIX_ghost_mappings.sql`) may UPDATE `gl_account_mappings` account codes when the existing codes are confirmed ghost codes. These require explicit approval.

### Consequences
- (+) Complete financial history is preserved at all times
- (+) Migrations are idempotent and safe to re-run
- (-) Schema cannot be cleaned up easily — old columns accumulate
- (-) Requires careful planning before initial schema creation
