-- Migration: Add UNIQUE constraints to local_id to prevent duplication
-- And add related_movement_id to inventory_movements for better linkage

-- 1. Inventory Movements
-- Note: SQLite doesn't support ADD CONSTRAINT UNIQUE on existing columns easily. 
-- We'll use a unique index instead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_local_id ON inventory_movements(local_id) WHERE local_id IS NOT NULL;

-- 2. Cash Transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_local_id ON cash_transactions(local_id) WHERE local_id IS NOT NULL;

-- 3. Supplier Transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_local_id ON supplier_transactions(local_id) WHERE local_id IS NOT NULL;

-- 4. Add linkage column to inventory_movements if not exists
-- (Already exists in some form as dest_warehouse_id, but let's add a generic ref_id for pairing)
ALTER TABLE inventory_movements ADD COLUMN related_movement_id INTEGER REFERENCES inventory_movements(id);
