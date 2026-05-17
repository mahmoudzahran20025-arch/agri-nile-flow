-- Migration 0124: Wipe synthetic smoke-certification data
-- Removes all data written by the smoke certification runs (5 runs total).
-- Preserves schema, sequences, master data (suppliers, items, warehouses, COA).
-- Safe to run against company_id=1 only — there is no other company in this DB.
--
-- Strategy:
--   1. Null out all FKs referencing journal_entries (to allow deletion)
--   2. Unpost journal_entries (to satisfy GL integrity triggers)
--   3. Delete GL data leaf-to-root
--   4. Delete operational transaction data

-- Step 1: Null journal_entry_id FKs in all referencing tables
UPDATE supplier_transactions    SET journal_entry_id = NULL WHERE company_id = 1;
UPDATE cash_transactions        SET journal_entry_id = NULL WHERE company_id = 1;
UPDATE inventory_movements      SET journal_entry_id = NULL WHERE company_id = 1;

-- Step 2: Unpost journal_entries so GL triggers allow line deletion
UPDATE journal_entries SET is_posted = 0 WHERE company_id = 1;

-- Step 3: GL data (leaf-to-root)
DELETE FROM source_document_links   WHERE company_id = 1;
DELETE FROM journal_entry_lines     WHERE company_id = 1;
DELETE FROM journal_entries         WHERE company_id = 1;
DELETE FROM business_events         WHERE company_id = 1;

-- Step 4: Inventory
DELETE FROM inventory_posting_outbox WHERE company_id = 1;
DELETE FROM inventory_movements      WHERE company_id = 1;
DELETE FROM inventory_balances       WHERE company_id = 1;

-- Step 5: Purchase orders (items before headers)
DELETE FROM purchase_order_items WHERE company_id = 1;
DELETE FROM purchase_orders      WHERE company_id = 1;

-- Step 6: Financial transactions
DELETE FROM cash_transactions       WHERE company_id = 1;
DELETE FROM supplier_transactions   WHERE company_id = 1;

-- Verification: all operational tables should be empty for company_id=1
SELECT
  (SELECT COUNT(*) FROM supplier_transactions     WHERE company_id = 1) AS supplier_transactions,
  (SELECT COUNT(*) FROM cash_transactions         WHERE company_id = 1) AS cash_transactions,
  (SELECT COUNT(*) FROM purchase_orders           WHERE company_id = 1) AS purchase_orders,
  (SELECT COUNT(*) FROM journal_entries           WHERE company_id = 1) AS journal_entries,
  (SELECT COUNT(*) FROM journal_entry_lines       WHERE company_id = 1) AS journal_entry_lines,
  (SELECT COUNT(*) FROM business_events           WHERE company_id = 1) AS business_events,
  (SELECT COUNT(*) FROM inventory_movements       WHERE company_id = 1) AS inventory_movements,
  (SELECT COUNT(*) FROM inventory_balances        WHERE company_id = 1) AS inventory_balances,
  (SELECT COUNT(*) FROM source_document_links     WHERE company_id = 1) AS source_document_links,
  (SELECT COUNT(*) FROM inventory_posting_outbox  WHERE company_id = 1) AS inventory_posting_outbox;
