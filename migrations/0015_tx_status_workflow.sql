-- Migration: Add status field to transaction tables (draft → posted workflow)
-- This enables review-before-posting for cash and supplier transactions

-- Add status column to cash_transactions
ALTER TABLE cash_transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'posted';

-- Add status column to supplier_transactions 
ALTER TABLE supplier_transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'posted';

-- Add document_type column to cash_transactions (for dropdown standardization)
ALTER TABLE cash_transactions ADD COLUMN document_type TEXT;

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_cash_tx_status ON cash_transactions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_tx_status ON supplier_transactions(company_id, status);
