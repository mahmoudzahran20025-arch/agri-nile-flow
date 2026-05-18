# SAAS REFACTORING MASTER PLAN
## The "Operations-First & Schema-Driven" Enterprise Architecture

**Goal:** Transition the current MVP into a highly scalable, multi-tenant capable SaaS platform. This plan details the architectural shift toward dynamic forms, unified procurement hubs, and a clean data model, alongside a safe strategy for wiping and reseeding historical data to fit the new paradigm.

---

### 🏗️ 1. The Target Architecture (The 4 Layers)

#### Layer 1 — The Immutable Core (Financial Engine)
- **Components:** `GL`, `Posting Engine`, `journal_entries`, `chart_of_accounts`, `posting_rules`.
- **Rule:** This layer is strictly locked. No business logic or UI code touches the GL directly. It only listens to finalized Business Events.

#### Layer 2 — The Clean Data Model (Operational Truth)
- **`supplier_transactions`:** Upgraded from a simple financial ledger to a unified procurement log. 
  - *New Fields:* `quantity`, `unit_type`, `metadata_json` (for extensible context like tractor type, labor names).
- **`inventory_movements`:** Refined to support advanced warehousing.
  - *New Fields:* `pack_count`, `pack_type` (to differentiate between 50kg sacks and raw tonnage).
- **`work_orders`:** Upgraded to the primary orchestration engine.
  - *Rule:* Moving WO to `COSTED`/`EXECUTED` status automatically invokes the `supplier_transactions` API to register external liabilities.

#### Layer 3 — Schema-Driven Engine (Backend)
- **`unit_types` Table:** Standardized units (`ساعة`, `يوم`, `كجم`, `لتر`, `شيكارة`, `عامل`) with free-text fallback.
- **`form_templates` & `form_fields` Tables:** JSON-driven configuration dictating how each `service_type_code` should behave, what fields it requires, and how `amount` is calculated (e.g., `formula: qty * unit_price`).

#### Layer 4 — Dynamic UI (Frontend)
- **`FormRenderer` Component:** A React engine that reads Layer 3 schemas and dynamically renders forms. No more hardcoded modals for every new agricultural service.
- **TanStack Excel Grid:** For high-speed data entry (batch processing).
- **GL Previewer:** Showing the exact Debit/Credit impact *before* the user clicks save.

---

### 🧹 2. Legacy Cleanup Objectives
Before building, we must destroy the technical debt that causes confusion:
1. **Remove Duplicate Paths:** Delete the standalone WO Equipment/Tasks manual posting logic. Everything external MUST route through `createSupplierTransaction`.
2. **Remove Date Hacks:** Remove the `2026-12` -> `2025-12` mutation inside `movements.ts`. The new UI will enforce strict date validation via the schema.
3. **Remove Dead Code:** Delete `execute_posting_job_v2.js` and any other unused scripts muddying the workspace.

---

### 🔄 3. Data Wipe & Reseed Strategy (The Clean Slate)
Because we are profoundly changing the schema of `supplier_transactions` to include operational data (`quantity`, `unit_type`), migrating the messy legacy data is a risk. Since we have the raw source truth in JSON files, a controlled wipe and reseed is the optimal SaaS engineering choice.

**The Reseed Protocol:**
1. **The Wipe:** Truncate `supplier_transactions`, `inventory_movements`, `work_orders`, `cash_transactions`, `journal_entries`, and `journal_entry_lines`. (Chart of Accounts and setup remain untouched).
2. **The JSON Translators:** Write highly specific loader scripts that read `نواة_المستقبل_2025-2026.json` and `مخازن_نواة_المستقبل_2025-2026.json`.
3. **API-Driven Injection:** Do **NOT** insert directly into the database. The loader scripts will format the JSON data into the exact payload expected by the *NEW Schema-Driven APIs*. 
4. **Benefit:** By pushing the historical JSON data through the new APIs, we guarantee that all historical data perfectly respects the new architecture, generates the correct `business_events`, and perfectly balances the GL.

---

### 🚀 4. Execution Roadmap (Phases for AI Agents)

#### Phase 0: The Clean Slate (Wipe & Schema Updates)
- [ ] Write and execute the Database Migration script to add `quantity`, `unit_type`, `metadata_json`, `pack_count`.
- [ ] Create `form_templates`, `form_fields`, and `unit_types` tables.
- [ ] Write the `truncate_operational_data.sql` script (Do not execute until Phase 4).
- [ ] Purge all identified legacy code.

#### Phase 1: The Backend Engine (Layer 2 & 3)
- [ ] Refactor `api/suppliers.ts` to accept and validate the new dynamic fields (`quantity`, `unit_type`, `metadata_json`).
- [ ] Build the `/api/schema/forms/:service_type` endpoint to serve UI layouts.
- [ ] Refactor `api/operations.ts` so that completing a Work Order triggers the new supplier API for external resources.

#### Phase 2: The Dynamic Frontend (Layer 4)
- [ ] Build the `FormRenderer` React component capable of handling generic JSON layouts.
- [ ] Integrate TanStack Table for the `Unified Procurement Gateway`.
- [ ] Build the "GL Preview" hook that dry-runs the posting engine and returns the expected journal entry to the UI.
- [ ] Redirect all current `SRV_MECH`, `SRV_LABOR`, and `GRN` manual entry points to the new Unified Gateway.

#### Phase 3: The Data Reseed (Execution)
- [ ] Execute `truncate_operational_data.sql` to clear the legacy clutter.
- [ ] Develop `reseed_saas_data.js` to parse the original JSON files.
- [ ] Run the reseed script, feeding data through the newly built APIs.
- [ ] Run the `Final Health Check` to verify GL balance = 0.

#### Phase 4: SaaS Analytics & Dashboards
- [ ] Build the Cost Summary per Pivot/Season dashboard relying on the clean `metadata_json` and `unit_types`.
- [ ] AP Aging Dashboard for Suppliers.
- [ ] Inventory valuation dashboards based on exact pack counts.

---

*This document serves as the canonical directive for all AI agents working on the Agri-Nile SaaS transformation.*
