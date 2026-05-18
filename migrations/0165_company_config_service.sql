-- Migration 0165 — CompanyConfig service foundation
-- ====================================================
-- Consolidates all per-company behavioral configuration into a single
-- typed JSON column read exclusively through getCompanyConfig().
--
-- Replaces the pattern of: SELECT vat_pct, vat_number FROM companies
-- With: getCompanyConfig(db, companyId).vat_pct
--
-- Existing columns (vat_pct, vat_registered, vat_number, costing_method,
-- base_currency_code) are preserved for backward compatibility and are
-- the authoritative source — getCompanyConfig() reads them directly.
-- No data migration needed: the service reads the live columns.
--
-- New columns added here extend the config surface without touching
-- existing columns or requiring data backfill.

-- fiscal_year_start_month: 1–12. Default 1 (January).
-- Egyptian tax year is usually July–June (7). Saudi is January–December (1).
ALTER TABLE companies ADD COLUMN fiscal_year_start_month INTEGER NOT NULL DEFAULT 1
  CHECK(fiscal_year_start_month BETWEEN 1 AND 12);

-- ar_locale: BCP-47 locale code for Arabic number/date formatting.
-- 'ar-EG' = Egyptian Arabic, 'ar-SA' = Saudi, 'ar-AE' = Emirati, etc.
ALTER TABLE companies ADD COLUMN ar_locale TEXT NOT NULL DEFAULT 'ar-EG';

-- enabled_modules: JSON array of module keys. NULL = all enabled (default).
-- Used to hide/show nav sections and gate API access for vertical-specific deployments.
-- Example: '["inventory","suppliers","gl","hr"]' — no POS, no sales for a pure agri client.
ALTER TABLE companies ADD COLUMN enabled_modules TEXT DEFAULT NULL;

-- approval_threshold_egp: invoice/payment value above which manager approval is required.
-- NULL = no approval workflow. 0 = every transaction requires approval.
ALTER TABLE companies ADD COLUMN approval_threshold_egp REAL DEFAULT NULL;

-- Default fiscal year for new company onboarding — backfill company_id=1 to current year.
-- New companies get their fiscal_year seeded at creation time in admin.ts.
ALTER TABLE companies ADD COLUMN fiscal_year_current INTEGER DEFAULT NULL;

PRAGMA integrity_check;
