-- ============================================================
-- Migration 0019: 3-Way Match — Link Invoice → Goods Receipt
-- Purpose:
--   1. Link supplier_invoice_items to the actual inventory_movement
--      that represents goods receipt (GR), enabling full 3-way match:
--      Purchase Order → Goods Receipt → Supplier Invoice
--   2. Add 'cogs' mapping_key support to gl_account_mappings
--      for work-order-linked inventory withdrawals.
-- Date: 2026-04-24
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Link Invoice Lines → Inventory Movement (Goods Receipt)
-- ────────────────────────────────────────────────────────────
ALTER TABLE supplier_invoice_items
  ADD COLUMN inventory_movement_id INTEGER REFERENCES inventory_movements(id);

-- Index for reverse lookup (which invoice covers this goods receipt?)
CREATE INDEX IF NOT EXISTS idx_sii_movement
  ON supplier_invoice_items(inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. Add status + journal_entry_id to supplier_invoices
--    (needed for Revert-to-Draft pattern, same as cash/supplier tx)
-- ────────────────────────────────────────────────────────────
ALTER TABLE supplier_invoices ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE supplier_invoices ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);

CREATE INDEX IF NOT EXISTS idx_sinv_status ON supplier_invoices(company_id, status);

-- ────────────────────────────────────────────────────────────
-- 3. COGS GL mapping — default mapping key for work-order withdrawals
--    Must be inserted per-company by admin via Config page.
--    This comment documents the expected mapping_key name only.
-- ────────────────────────────────────────────────────────────
-- mapping_key = 'cogs'
-- Example: GL Account 5001 — تكلفة البضاعة المباعة / تكلفة الإنتاج
-- INSERT INTO gl_account_mappings (company_id, mapping_key, account_code)
-- VALUES (?, 'cogs', '5001');
-- (Actual insertion done via the Config API / admin UI)
