-- Migration 0030: GL Integration Settings
-- Allows users to toggle automated GL posting per module (Phased Rollout Support)

CREATE TABLE IF NOT EXISTS gl_integration_settings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  module_key   TEXT NOT NULL, -- 'harvest', 'hr_payroll', 'inventory', 'purchasing', 'operations'
  is_enabled   INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, module_key)
);

-- Seed defaults (enabled by default)
INSERT OR IGNORE INTO gl_integration_settings (company_id, module_key, is_enabled)
SELECT id, 'harvest', 1 FROM companies;

INSERT OR IGNORE INTO gl_integration_settings (company_id, module_key, is_enabled)
SELECT id, 'hr_payroll', 1 FROM companies;

INSERT OR IGNORE INTO gl_integration_settings (company_id, module_key, is_enabled)
SELECT id, 'inventory', 1 FROM companies;

INSERT OR IGNORE INTO gl_integration_settings (company_id, module_key, is_enabled)
SELECT id, 'operations', 1 FROM companies;
