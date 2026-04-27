-- =============================================================================
-- 0044_entity_posting_group_indexes.sql
-- Phase 4 — Indexes on entity tables that carry posting-group codes.
-- These speed up the "inherit posting group from entity" lookup that the
-- posting engine performs on every transaction.
-- All statements use CREATE INDEX IF NOT EXISTS (safe, idempotent).
-- =============================================================================

-- ── Suppliers: look up BPG quickly for supplier-invoice / payment flows ───────
CREATE INDEX IF NOT EXISTS idx_suppliers_bpg
  ON suppliers (company_id, bus_posting_group_code);

-- ── Items: look up PPG quickly for inventory movement / invoice flows ─────────
CREATE INDEX IF NOT EXISTS idx_items_ppg
  ON items (company_id, prod_posting_group_code);

-- ── Item categories: default PPG inheritance for new items ────────────────────
CREATE INDEX IF NOT EXISTS idx_item_categories_ppg
  ON item_categories (company_id, prod_posting_group_code);

-- ── Warehouses: look up IPG quickly for inventory posting ─────────────────────
CREATE INDEX IF NOT EXISTS idx_warehouses_ipg
  ON warehouses (company_id, inv_posting_group_code);

-- ── Purchase orders: fast retrieval by supplier + status ──────────────────────
CREATE INDEX IF NOT EXISTS idx_po_company_supplier
  ON purchase_orders (company_id, supplier_code, status);

-- ── Supplier invoices: fast outstanding balance queries (by PO linkage) ────────
CREATE INDEX IF NOT EXISTS idx_si_company_po
  ON supplier_invoices (company_id, po_id, status);

-- ── financial_periods: period-lookup hot path ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fp_company_dates
  ON financial_periods (company_id, start_date, end_date, is_closed);
