-- Migration 0155 — VAT receipt architecture (P2-L2)
--
-- Egypt VAT (14%) and similar tax regimes require:
--   1. A per-company vat_pct setting (default 0 = no VAT)
--   2. A per-item vat_exempt flag (e.g. fresh agricultural produce is often VAT-exempt)
--   3. Tax amount stored on sales_orders (already exists as tax_amount column)
--
-- The sales POST endpoint reads company vat_pct and item.vat_exempt at checkout,
-- computes tax per line, and stores it in sales_orders.tax_amount.
-- POS receipt then shows tax breakdown separately.
--
-- vat_pct is stored as a percentage integer (e.g. 14 = 14%).

ALTER TABLE companies ADD COLUMN vat_pct       REAL    NOT NULL DEFAULT 0 CHECK(vat_pct >= 0 AND vat_pct < 100);
ALTER TABLE companies ADD COLUMN vat_number     TEXT;         -- taxpayer registration number for receipts
ALTER TABLE companies ADD COLUMN vat_registered INTEGER NOT NULL DEFAULT 0 CHECK(vat_registered IN (0,1));

ALTER TABLE items ADD COLUMN vat_exempt INTEGER NOT NULL DEFAULT 0 CHECK(vat_exempt IN (0,1));

-- Index for filtering non-exempt items (used in checkout tax calculation)
CREATE INDEX IF NOT EXISTS idx_items_vat_exempt
  ON items(company_id, vat_exempt)
  WHERE vat_exempt = 1;
