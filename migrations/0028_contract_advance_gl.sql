-- Migration 0028: Sales Contract Advance GL Tracking
-- Links a sales contract's advance payment to its journal entry for audit traceability.
-- This ensures that cash received from buyers is tracked in the General Ledger.

ALTER TABLE sales_contracts ADD COLUMN advance_gl_entry_id INTEGER REFERENCES journal_entries(id);

-- Optional: Create a placeholder index for faster lookup of advances
CREATE INDEX IF NOT EXISTS idx_sales_contracts_gl ON sales_contracts(advance_gl_entry_id) WHERE advance_gl_entry_id IS NOT NULL;
