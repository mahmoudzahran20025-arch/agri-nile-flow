-- Migration 0053: GL Source Ledger Tracking Schema
--
-- Purpose: Add source ledger tracking to journal_entry_lines
-- This allows linking GL entries back to their operational source (cash, supplier, inventory)
--
-- Architecture: Ledger-based GL (not event-sourced)
-- - cash_transactions → journal_entry_lines (source_ledger='cash', source_record_id=ct.id)
-- - supplier_transactions → journal_entry_lines (source_ledger='supplier', source_record_id=st.id)
-- - inventory_movements → journal_entry_lines (source_ledger='inventory', source_record_id=im.id)
-- - manual entries (source_ledger='manual', source_record_id=NULL)
--
-- Status: SAFE — additive schema only, no data deletion
-- Reversibility: 100% — can DROP columns if needed

-- Step 1: Add source tracking columns
ALTER TABLE journal_entry_lines
ADD COLUMN source_ledger TEXT DEFAULT 'manual'
CHECK (source_ledger IN ('cash', 'supplier', 'inventory', 'manual', 'adjustment', 'harvest'));

ALTER TABLE journal_entry_lines
ADD COLUMN source_record_id INTEGER DEFAULT NULL;

-- Step 2: Create index for fast lookups
CREATE INDEX idx_journal_entry_lines_source
ON journal_entry_lines(source_ledger, source_record_id);

-- Step 3: Document the new schema
-- journal_entry_lines now tracks:
-- - source_ledger: origin of the GL entry
-- - source_record_id: foreign key to source table (e.g., cash_transactions.id)
--
-- This allows audit trail:
-- journal_entry_lines.source_ledger='cash' + source_record_id=69
--   → SELECT * FROM cash_transactions WHERE id = 69
--   → See the original cash transaction that created this GL entry
