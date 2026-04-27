-- Migration 0040: Dynamic Ledger Classification Engine (DLCE) Schema

-- 1. Add GL Account linking to Expense Types
ALTER TABLE expense_types ADD COLUMN gl_account_code TEXT DEFAULT NULL;

-- 2. Create the mapping rules table for dynamic text extraction
CREATE TABLE transaction_mapping_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    
    -- The extracted keyword from the historical narration
    keyword TEXT NOT NULL,
    
    -- The classification type: 'expense', 'supplier', 'partner', 'bank', etc.
    category_type TEXT NOT NULL,
    
    -- The target ID in the respective table (e.g., expense_types.code, suppliers.code)
    target_id INTEGER,
    
    -- An optional direct GL account mapping if it bypasses standard entities
    direct_gl_account TEXT DEFAULT NULL,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by_user_id INTEGER,
    
    UNIQUE(company_id, keyword)
);

CREATE INDEX idx_mapping_rules_keyword ON transaction_mapping_rules(company_id, keyword);
