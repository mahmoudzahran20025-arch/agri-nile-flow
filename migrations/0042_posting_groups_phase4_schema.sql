-- =============================================================================
-- 0042_posting_groups_phase4_schema.sql
-- Phase 4 additive schema support for posting groups UI/validation.
-- Safe operations only: ALTER TABLE ADD COLUMN
-- =============================================================================

-- Group labels for bilingual UI
ALTER TABLE business_posting_groups  ADD COLUMN name_ar TEXT;
ALTER TABLE business_posting_groups  ADD COLUMN name_en TEXT;

ALTER TABLE product_posting_groups   ADD COLUMN name_ar TEXT;
ALTER TABLE product_posting_groups   ADD COLUMN name_en TEXT;

ALTER TABLE inventory_posting_groups ADD COLUMN name_ar TEXT;
ALTER TABLE inventory_posting_groups ADD COLUMN name_en TEXT;

-- Expanded general posting setup account matrix (Dynamics-style)
ALTER TABLE general_posting_setup ADD COLUMN sales_discount_account TEXT;
ALTER TABLE general_posting_setup ADD COLUMN sales_return_account   TEXT;
ALTER TABLE general_posting_setup ADD COLUMN purch_account          TEXT;
ALTER TABLE general_posting_setup ADD COLUMN purch_discount_account TEXT;
ALTER TABLE general_posting_setup ADD COLUMN purch_return_account   TEXT;
ALTER TABLE general_posting_setup ADD COLUMN payable_account        TEXT;
