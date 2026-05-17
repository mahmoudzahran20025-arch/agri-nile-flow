-- =============================================================================
-- Migration 0119 — Operational Data Wipe (Pre-Clean-Import)
-- Date: 2026-05-15
--
-- Purpose:
--   Wipe all operational / transactional data while preserving 100% of master
--   data. This is a controlled, intentional reset before re-importing clean
--   source data.
--
-- MASTER DATA PRESERVED (NOT touched by this migration):
--   suppliers, items, chart_of_accounts, posting_rules, service_types,
--   supplier_service_map, business_posting_groups, product_posting_groups,
--   unit_types, form_templates, form_fields, fields, seasons, cost_centers,
--   companies, users, roles, permissions, employees, warehouses,
--   financial_accounts, partners
--
-- OPERATIONAL DATA WIPED (re-importable from source):
--   GL: journal_entry_lines, journal_entries, business_events, account_balances
--   Operational: supplier_transactions, cash_transactions, inventory_movements,
--     work_order_equipment, work_tasks, work_orders, harvest_records,
--     contract_advances, fixed_assets, depreciation_schedules, wip_balances,
--     payroll_runs
--   Derived: inventory_balances, inventory_posting_outbox,
--     batch_post_jobs, batch_post_job_items, _archived_blocked_movements
--
-- TRIGGER HANDLING:
--   Two GL integrity triggers block deletion of posted entries:
--     - trg_gl_prevent_posted_delete      (on journal_entries)
--     - trg_gl_prevent_posted_line_delete (on journal_entry_lines)
--   These are dropped before the wipe and recreated identically after.
--   All other triggers (account balance maintenance, audit log, etc.) are
--   left in place — they fire on DELETE and update derived tables which are
--   also being wiped, so they cause no harm and no inconsistency.
--
-- Rollback: None. Intentional and irreversible.
-- =============================================================================

-- ── Safety check: verify master data before wiping ───────────────────────────
SELECT
  (SELECT COUNT(*) FROM suppliers)        AS suppliers_count,
  (SELECT COUNT(*) FROM items)            AS items_count,
  (SELECT COUNT(*) FROM chart_of_accounts) AS coa_count,
  (SELECT COUNT(*) FROM posting_rules)    AS posting_rules_count,
  (SELECT COUNT(*) FROM service_types)    AS service_types_count,
  (SELECT COUNT(*) FROM fields)           AS fields_count,
  (SELECT COUNT(*) FROM seasons)          AS seasons_count,
  (SELECT COUNT(*) FROM cost_centers)     AS cost_centers_count,
  (SELECT COUNT(*) FROM bank_accounts)   AS bank_accounts_count;


-- ── Step 1: Drop GL protection triggers temporarily ──────────────────────────
DROP TRIGGER IF EXISTS trg_gl_prevent_posted_delete;
DROP TRIGGER IF EXISTS trg_gl_prevent_posted_line_delete;


-- ── Step 2: Wipe all tables referencing journal_entries (FK constraint) ──────
-- These tables have journal_entry_id / gl_entry_id FKs pointing at
-- journal_entries. They must be cleared before journal_entries can be deleted.

DELETE FROM depreciation_schedules;   -- depreciation_schedules.journal_entry_id → journal_entries
DELETE FROM work_order_equipment;     -- work_order_equipment.journal_entry_id → journal_entries
DELETE FROM work_tasks;               -- work_tasks (child of work_orders)
DELETE FROM work_orders;              -- work_orders
DELETE FROM wip_balances;             -- wip_balances.journal_entry_id → journal_entries
DELETE FROM payroll_runs;             -- payroll_runs.journal_entry_id, payment_gl_entry_id → journal_entries
DELETE FROM contract_advances;        -- contract_advances.gl_entry_id → journal_entries
DELETE FROM cash_transactions;        -- cash_transactions.journal_entry_id → journal_entries
DELETE FROM supplier_transactions;    -- supplier_transactions.journal_entry_id → journal_entries
DELETE FROM inventory_movements;      -- inventory_movements.journal_entry_id → journal_entries
DELETE FROM harvest_records;          -- harvest_records (no GL FK but operational)
DELETE FROM fixed_assets;             -- fixed_assets.supplier_transaction_id (already cleared above)


-- ── Step 3: Wipe GL ledger (all referencing tables now empty) ─────────────────
-- Lines before headers (journal_entry_lines.entry_id → journal_entries)
DELETE FROM journal_entry_lines;
DELETE FROM journal_entries;
DELETE FROM business_events;
-- Period-level account balance aggregates (derived from GL lines)
DELETE FROM account_balances;


-- ── Step 4: Wipe derived / infrastructure state ───────────────────────────────
DELETE FROM inventory_balances;
DELETE FROM inventory_posting_outbox;
DELETE FROM batch_post_job_items;
DELETE FROM batch_post_jobs;
DELETE FROM _archived_blocked_movements;


-- ── Step 5: Reset auto-increment sequences ────────────────────────────────────
DELETE FROM sqlite_sequence WHERE name IN (
  'journal_entries',
  'journal_entry_lines',
  'business_events',
  'account_balances',
  'supplier_transactions',
  'cash_transactions',
  'inventory_movements',
  'inventory_balances',
  'work_orders',
  'work_tasks',
  'work_order_equipment',
  'harvest_records',
  'fixed_assets',
  'depreciation_schedules',
  'wip_balances',
  'payroll_runs',
  'contract_advances',
  'inventory_posting_outbox',
  'batch_post_jobs',
  'batch_post_job_items',
  '_archived_blocked_movements'
);


-- ── Step 6: Recreate GL protection triggers (identical to originals) ──────────
CREATE TRIGGER trg_gl_prevent_posted_delete
BEFORE DELETE ON journal_entries
WHEN OLD.is_posted = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot delete a posted journal entry. Use reversal instead.');
END;

CREATE TRIGGER trg_gl_prevent_posted_line_delete
BEFORE DELETE ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot delete lines of a posted journal entry. Use reversal instead.');
END;


-- ── Post-wipe verification ────────────────────────────────────────────────────
SELECT
  'wipe_complete'                                          AS status,

  -- All operational tables must be 0
  (SELECT COUNT(*) FROM journal_entries)                   AS je_remaining,
  (SELECT COUNT(*) FROM journal_entry_lines)               AS jel_remaining,
  (SELECT COUNT(*) FROM account_balances)                  AS acct_bal_remaining,
  (SELECT COUNT(*) FROM supplier_transactions)             AS st_remaining,
  (SELECT COUNT(*) FROM cash_transactions)                 AS ct_remaining,
  (SELECT COUNT(*) FROM inventory_movements)               AS im_remaining,
  (SELECT COUNT(*) FROM work_orders)                       AS wo_remaining,
  (SELECT COUNT(*) FROM inventory_balances)                AS inv_bal_remaining,
  (SELECT COUNT(*) FROM fixed_assets)                      AS fa_remaining,
  (SELECT COUNT(*) FROM payroll_runs)                      AS pr_remaining,

  -- GL triggers must be back in place (count = 2)
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
    AND name IN (
      'trg_gl_prevent_posted_delete',
      'trg_gl_prevent_posted_line_delete'
    ))                                                     AS gl_triggers_restored,

  -- Master data must be intact (non-zero)
  (SELECT COUNT(*) FROM suppliers)                         AS suppliers_intact,
  (SELECT COUNT(*) FROM items)                             AS items_intact,
  (SELECT COUNT(*) FROM chart_of_accounts)                 AS coa_intact,
  (SELECT COUNT(*) FROM posting_rules)                     AS rules_intact,
  (SELECT COUNT(*) FROM service_types)                     AS service_types_intact,
  (SELECT COUNT(*) FROM fields)                            AS fields_intact,
  (SELECT COUNT(*) FROM seasons)                           AS seasons_intact,
  (SELECT COUNT(*) FROM cost_centers)                      AS centers_intact,
  (SELECT COUNT(*) FROM bank_accounts)                     AS bank_accounts_intact;
