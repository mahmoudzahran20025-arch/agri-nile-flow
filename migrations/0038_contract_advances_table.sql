-- Migration 0038: Sales Contract Multi-Advance Support
-- Creates a dedicated table to track multiple advance payment receipts for sales contracts.

CREATE TABLE IF NOT EXISTS contract_advances (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  contract_id  INTEGER NOT NULL REFERENCES sales_contracts(id),
  amount       REAL NOT NULL,
  receipt_date TEXT NOT NULL,
  notes        TEXT,
  gl_entry_id  INTEGER REFERENCES journal_entries(id),
  created_by   INTEGER NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_contract_advances_lookup ON contract_advances(company_id, contract_id);
