-- 0087_supplier_transactions_payment_and_equipment_mode.sql
-- Distinguish supplier payment treasury account and equipment acquisition mode.

ALTER TABLE supplier_transactions ADD COLUMN financial_account_id INTEGER;
ALTER TABLE supplier_transactions ADD COLUMN equipment_type_id INTEGER;
ALTER TABLE supplier_transactions ADD COLUMN equipment_usage_mode TEXT
  CHECK(equipment_usage_mode IN ('owned', 'rental'));

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_financial_account_id
  ON supplier_transactions(company_id, financial_account_id)
  WHERE financial_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_equipment_type_id
  ON supplier_transactions(company_id, equipment_type_id)
  WHERE equipment_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_equipment_usage_mode
  ON supplier_transactions(company_id, equipment_usage_mode)
  WHERE equipment_usage_mode IS NOT NULL;