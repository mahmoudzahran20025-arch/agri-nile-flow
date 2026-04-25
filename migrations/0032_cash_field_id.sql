-- Migration: Add field_id to cash_transactions for field-level cost attribution
-- Enables cash costs (rent, services, other) to appear in budget-vs-actual per field

ALTER TABLE cash_transactions ADD COLUMN field_id INTEGER REFERENCES fields(id);

CREATE INDEX IF NOT EXISTS idx_cash_tx_field_id ON cash_transactions(company_id, field_id, season_id);
