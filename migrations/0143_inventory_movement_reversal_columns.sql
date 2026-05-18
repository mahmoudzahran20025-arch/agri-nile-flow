-- Add reversal tracking columns to inventory_movements
ALTER TABLE inventory_movements ADD COLUMN is_reversed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN reversal_of_id INTEGER NULL REFERENCES inventory_movements(id);

-- Partial index: only index rows that are reversals (keeps index small)
CREATE INDEX idx_inv_movements_reversal ON inventory_movements(company_id, reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;
