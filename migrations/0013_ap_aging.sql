-- Phase E-2: AP Aging — add payment tracking to supplier invoices
ALTER TABLE supplier_invoices ADD COLUMN due_date_days INTEGER DEFAULT 30;
ALTER TABLE supplier_invoices ADD COLUMN paid_amount   REAL    DEFAULT 0;
ALTER TABLE supplier_invoices ADD COLUMN payment_date  TEXT;
ALTER TABLE supplier_invoices ADD COLUMN payment_ref   TEXT;

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_unpaid
  ON supplier_invoices(company_id, paid_amount, invoice_date);
