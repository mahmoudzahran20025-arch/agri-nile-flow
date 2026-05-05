-- ─────────────────────────────────────────────────────────────
-- Migration: Enrich suppliers table with ERP-standard fields
-- Safe to run multiple times (uses IF NOT EXISTS where possible)
-- ─────────────────────────────────────────────────────────────

-- Contact info
ALTER TABLE suppliers ADD COLUMN phone         TEXT;
ALTER TABLE suppliers ADD COLUMN email         TEXT;
ALTER TABLE suppliers ADD COLUMN address       TEXT;

-- Financial terms
ALTER TABLE suppliers ADD COLUMN tax_number    TEXT;
ALTER TABLE suppliers ADD COLUMN credit_limit  REAL;
ALTER TABLE suppliers ADD COLUMN payment_terms INTEGER NOT NULL DEFAULT 30;

-- Categorization
ALTER TABLE suppliers ADD COLUMN supplier_type TEXT NOT NULL DEFAULT 'supplier';
-- supplier_type: 'supplier' | 'customer' | 'both'

ALTER TABLE suppliers ADD COLUMN bus_posting_group_code TEXT;
ALTER TABLE suppliers ADD COLUMN gl_account_code        INTEGER;
