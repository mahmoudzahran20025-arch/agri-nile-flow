-- Migration 0103: Add service_type_code to supplier_transactions
-- Applied: 2026-05-11
ALTER TABLE supplier_transactions ADD COLUMN service_type_code TEXT;
CREATE INDEX IF NOT EXISTS idx_supplier_txn_service_type ON supplier_transactions(service_type_code);
