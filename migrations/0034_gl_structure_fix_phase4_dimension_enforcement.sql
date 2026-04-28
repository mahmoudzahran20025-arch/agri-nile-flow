-- Create dimension_requirements table if it doesn't exist
CREATE TABLE IF NOT EXISTS dimension_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  table_name TEXT NOT NULL,
  dimension_code TEXT NOT NULL,
  is_required BOOLEAN DEFAULT 0,
  applicable_transaction_types TEXT,
  enforcement_level TEXT DEFAULT 'WARN',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert enforcement rules
INSERT OR IGNORE INTO dimension_requirements 
  (company_id, table_name, dimension_code, is_required, applicable_transaction_types, enforcement_level) 
VALUES 
  (1, 'treasury_entries', 'SEASON', 1, 'PAYMENT,RECEIPT', 'BLOCK'),
  (1, 'treasury_entries', 'COST_CENTER', 1, 'PAYMENT', 'WARN'),
  (1, 'supplier_transactions', 'COST_CENTER', 0, 'ALL', 'WARN'),
  (1, 'inventory_movements', 'SEASON', 0, 'IN,OUT,ADJ', 'WARN');

-- NOTE:
-- Skip any DML on cost_centers in this phase because remote schema has an existing
-- legacy FK mismatch (fields.center_code -> cost_centers.code) that blocks writes.
-- Cost center master updates should run in a separate schema-fix migration.