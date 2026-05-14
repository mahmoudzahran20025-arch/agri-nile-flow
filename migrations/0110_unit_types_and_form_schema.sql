-- =============================================================================
-- Migration 0110 — Unit Types Master + Form Schema Engine (Layer 3)
-- Date: 2026-05-14
-- Phase: A (Additive schema — zero risk, fully reversible)
--
-- What this does:
--   1. Creates unit_types table — canonical UoM master for all operational entries.
--   2. Creates form_templates table — one row per service_type_code, defines the
--      form contract the frontend renders.
--   3. Creates form_fields table — individual field definitions per template,
--      including type, label, formula, and validation rules.
--   4. Seeds unit_types with the 7 units confirmed from domain audit.
--   5. Seeds form_templates for all 6 active service types.
--   6. Seeds form_fields with minimum viable fields per template.
--
-- Rollback:
--   DROP TABLE IF EXISTS form_fields;
--   DROP TABLE IF EXISTS form_templates;
--   DROP TABLE IF EXISTS unit_types;
-- =============================================================================

-- ── BLOCK 1: unit_types ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unit_types (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  code            TEXT    NOT NULL,
  name_ar         TEXT    NOT NULL,
  name_en         TEXT,
  unit_class      TEXT    NOT NULL DEFAULT 'quantity',
  -- 'quantity' = physical count (كجم, لتر, عدد)
  -- 'time'     = time-based (ساعة, يوم)
  -- 'labor'    = labor-based (عامل, عامل-يوم)
  -- 'monetary' = monetary (مبلغ) — not a physical UoM
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_unit_types_company
  ON unit_types(company_id, unit_class) WHERE is_active = 1;

-- Seed canonical units for company_id = 1
INSERT OR IGNORE INTO unit_types (company_id, code, name_ar, name_en, unit_class) VALUES
  (1, 'HOUR',       'ساعة',        'Hour',         'time'),
  (1, 'DAY',        'يوم',         'Day',           'time'),
  (1, 'WORKER',     'عامل',        'Worker',        'labor'),
  (1, 'WORKER_DAY', 'عامل-يوم',   'Worker-Day',    'labor'),
  (1, 'KG',         'كجم',         'Kilogram',      'quantity'),
  (1, 'LITER',      'لتر',         'Liter',         'quantity'),
  (1, 'UNIT',       'عدد',         'Unit/Piece',    'quantity'),
  (1, 'FEDDAN',     'فدان',        'Feddan',        'quantity'),
  (1, 'TON',        'طن',          'Ton',           'quantity'),
  (1, 'AMOUNT',     'مبلغ',        'Amount (EGP)',  'monetary');

-- ── BLOCK 2: form_templates ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS form_templates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies(id),
  service_type_code   TEXT    NOT NULL,   -- FK to service_types.code
  template_code       TEXT    NOT NULL,   -- e.g., 'TMPL_MECH_INVOICE'
  title_ar            TEXT    NOT NULL,
  title_en            TEXT,
  description_ar      TEXT,
  target_endpoint     TEXT,               -- e.g., '/api/suppliers/:code/transactions'
  amount_formula      TEXT,               -- e.g., 'qty * unit_price'
  default_unit_code   TEXT, -- logical FK to unit_types.code
  requires_supplier   INTEGER NOT NULL DEFAULT 1,
  requires_document   INTEGER NOT NULL DEFAULT 1,
  requires_quantity   INTEGER NOT NULL DEFAULT 0,
  requires_field      INTEGER NOT NULL DEFAULT 0,
  requires_season     INTEGER NOT NULL DEFAULT 1,
  requires_center     INTEGER NOT NULL DEFAULT 1,
  is_active           INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 100,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, service_type_code)
);

CREATE INDEX IF NOT EXISTS idx_form_templates_company
  ON form_templates(company_id, service_type_code) WHERE is_active = 1;

-- Seed one template per service_type for company_id = 1
INSERT OR IGNORE INTO form_templates
  (company_id, service_type_code, template_code, title_ar, title_en,
   target_endpoint, amount_formula, default_unit_code,
   requires_supplier, requires_document, requires_quantity, requires_field, requires_season, requires_center, sort_order)
VALUES
  (1, 'SRV_MECH',       'TMPL_MECH_INVOICE', 'فاتورة ميكنة / إيجار آلات', 'Equipment Rental Invoice', '/api/suppliers/:code/transactions', 'qty * unit_price', 'HOUR', 1, 1, 1, 1, 1, 1, 10),
  (1, 'SRV_LABOR',      'TMPL_LABOR_INVOICE', 'فاتورة عمالة', 'Labor Supply Invoice', '/api/suppliers/:code/transactions', 'qty * unit_price', 'WORKER', 1, 1, 1, 1, 1, 1, 20),
  (1, 'SRV_SUPPLY',     'TMPL_SUPPLY_INVOICE', 'فاتورة توريد / شراء مستلزمات', 'Supply / Materials Purchase', '/api/suppliers/:code/transactions', 'qty * unit_price', 'KG', 1, 1, 1, 0, 1, 0, 30),
  (1, 'SRV_SUPERVISION','TMPL_SUPERVISION_INVOICE', 'فاتورة إشراف زراعي', 'Agricultural Supervision Invoice', '/api/suppliers/:code/transactions', 'amount', 'AMOUNT', 1, 1, 0, 0, 1, 1, 40),
  (1, 'SRV_SPARE_PARTS','TMPL_SPARE_INVOICE', 'فاتورة قطع غيار', 'Spare Parts Invoice', '/api/suppliers/:code/transactions', 'qty * unit_price', 'UNIT', 1, 1, 1, 1, 1, 1, 50),
  (1, 'SRV_LOGISTICS',  'TMPL_LOGISTICS_INVOICE', 'فاتورة نقل وشحن', 'Logistics / Transport Invoice', '/api/suppliers/:code/transactions', 'amount', 'AMOUNT', 1, 1, 0, 0, 1, 0, 60);

-- ── BLOCK 3: form_fields ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS form_fields (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies(id),
  template_id         INTEGER NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  field_key           TEXT    NOT NULL,   -- matches API param key exactly
  label_ar            TEXT    NOT NULL,
  label_en            TEXT,
  field_type          TEXT    NOT NULL DEFAULT 'text',
  is_required         INTEGER NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 100,
  default_value       TEXT,
  placeholder_ar      TEXT,
  source_table        TEXT,              -- for select: table to query
  source_value_col    TEXT,              -- for select: value column
  source_label_col    TEXT,              -- for select: display column
  filter_by_company   INTEGER NOT NULL DEFAULT 1,  -- add WHERE company_id = ? to source query
  validation_json     TEXT,             -- JSON: { "min": 0, "max": 999999, "pattern": null }
  help_text_ar        TEXT,
  is_readonly         INTEGER NOT NULL DEFAULT 0,
  is_visible          INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, template_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_form_fields_template
  ON form_fields(template_id, sort_order);

-- Seed fields for SRV_MECH template
INSERT OR IGNORE INTO form_fields
  (company_id, template_id, field_key, label_ar, label_en, field_type, is_required, sort_order, source_table, source_value_col, source_label_col, validation_json)
VALUES
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'transaction_date', 'تاريخ العملية', 'Date', 'date', 1, 10, NULL, NULL, NULL, '{"max_future":false}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'document_number', 'رقم المستخلص', 'Document No', 'text', 1, 20, NULL, NULL, NULL, '{"min_length":1}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'document_type', 'نوع المستند', 'Doc Type', 'select', 1, 30, NULL, NULL, NULL, NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'supplier_code', 'المورد', 'Supplier', 'select', 1, 40, 'suppliers', 'code', 'name', '{"service_type":"SRV_MECH"}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'field_id', 'البيفوت / الحقل', 'Field/Pivot', 'select', 1, 50, 'fields', 'id', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'season_id', 'الموسم', 'Season', 'select', 1, 60, 'seasons', 'id', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'center_code', 'مركز التكلفة', 'Cost Center', 'select', 1, 70, 'cost_centers', 'code', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'quantity', 'عدد الساعات', 'Hours', 'number', 1, 80, NULL, NULL, NULL, '{"min":0.1,"max":24}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'unit_price', 'سعر الساعة (جنيه)', 'Rate/Hour', 'number', 1, 90, NULL, NULL, NULL, '{"min":0}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'amount', 'الإجمالي (محسوب)', 'Total', 'readonly', 0, 100, NULL, NULL, NULL, NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'due_date', 'تاريخ الاستحقاق', 'Due Date', 'date', 1, 110, NULL, NULL, NULL, '{"max_future":true}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_MECH'), 'statement_text', 'البيان', 'Narration', 'text', 1, 120, NULL, NULL, NULL, '{"min_length":3}');

-- Seed fields for SRV_LABOR template
INSERT OR IGNORE INTO form_fields
  (company_id, template_id, field_key, label_ar, label_en, field_type, is_required, sort_order, source_table, source_value_col, source_label_col, validation_json)
VALUES
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'transaction_date', 'تاريخ العملية', 'Date', 'date', 1, 10, NULL, NULL, NULL, '{"max_future":false}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'document_number', 'رقم المستخلص', 'Document No', 'text', 1, 20, NULL, NULL, NULL, '{"min_length":1}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'supplier_code', 'مورد العمالة', 'Labor Supplier', 'select', 1, 30, 'suppliers', 'code', 'name', '{"service_type":"SRV_LABOR"}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'field_id', 'البيفوت / الحقل', 'Field/Pivot', 'select', 1, 40, 'fields', 'id', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'season_id', 'الموسم', 'Season', 'select', 1, 50, 'seasons', 'id', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'center_code', 'مركز التكلفة', 'Cost Center', 'select', 1, 60, 'cost_centers', 'code', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'quantity', 'عدد العمال', 'Workers', 'number', 1, 70, NULL, NULL, NULL, '{"min":1,"max":500}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'unit_price', 'أجر العامل (جنيه)', 'Rate/Worker', 'number', 1, 80, NULL, NULL, NULL, '{"min":0}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'amount', 'الإجمالي (محسوب)', 'Total', 'readonly', 0, 90, NULL, NULL, NULL, NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'due_date', 'تاريخ الاستحقاق', 'Due Date', 'date', 1, 100, NULL, NULL, NULL, '{"max_future":true}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_LABOR'), 'statement_text', 'البيان', 'Narration', 'text', 1, 110, NULL, NULL, NULL, '{"min_length":3}');

-- Seed fields for SRV_SUPERVISION template
INSERT OR IGNORE INTO form_fields
  (company_id, template_id, field_key, label_ar, label_en, field_type, is_required, sort_order, source_table, source_value_col, source_label_col, validation_json)
VALUES
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPERVISION'), 'transaction_date', 'تاريخ الفاتورة', 'Invoice Date', 'date', 1, 10, NULL, NULL, NULL, '{"max_future":false}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPERVISION'), 'document_number', 'رقم الفاتورة', 'Invoice No', 'text', 1, 20, NULL, NULL, NULL, '{"min_length":1}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPERVISION'), 'supplier_code', 'مورد الإشراف', 'Supplier', 'select', 1, 30, 'suppliers', 'code', 'name', '{"service_type":"SRV_SUPERVISION"}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPERVISION'), 'season_id', 'الموسم', 'Season', 'select', 1, 40, 'seasons', 'id', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPERVISION'), 'center_code', 'مركز التكلفة', 'Cost Center', 'select', 1, 50, 'cost_centers', 'code', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPERVISION'), 'amount', 'قيمة فاتورة الإشراف (جنيه)', 'Supervision Fee', 'number', 1, 60, NULL, NULL, NULL, '{"min":1}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPERVISION'), 'due_date', 'تاريخ الاستحقاق', 'Due Date', 'date', 1, 70, NULL, NULL, NULL, '{"max_future":true}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPERVISION'), 'statement_text', 'البيان', 'Narration', 'text', 1, 80, NULL, NULL, NULL, '{"min_length":3}');

-- Seed fields for SRV_SUPPLY template
INSERT OR IGNORE INTO form_fields
  (company_id, template_id, field_key, label_ar, label_en, field_type, is_required, sort_order, source_table, source_value_col, source_label_col, validation_json)
VALUES
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'transaction_date', 'تاريخ الفاتورة', 'Invoice Date', 'date', 1, 10, NULL, NULL, NULL, '{"max_future":false}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'document_number', 'رقم الفاتورة', 'Invoice No', 'text', 1, 20, NULL, NULL, NULL, '{"min_length":1}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'supplier_code', 'المورد', 'Supplier', 'select', 1, 30, 'suppliers', 'code', 'name', '{"service_type":"SRV_SUPPLY"}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'season_id', 'الموسم', 'Season', 'select', 1, 40, 'seasons', 'id', 'name', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'quantity', 'الكمية', 'Quantity', 'number', 1, 50, NULL, NULL, NULL, '{"min":0}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'unit_type', 'وحدة القياس', 'Unit', 'select', 1, 60, 'unit_types', 'code', 'name_ar', NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'unit_price', 'السعر للوحدة (جنيه)', 'Unit Price', 'number', 1, 70, NULL, NULL, NULL, '{"min":0}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'amount', 'الإجمالي (محسوب)', 'Total', 'readonly', 0, 80, NULL, NULL, NULL, NULL),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'due_date', 'تاريخ الاستحقاق', 'Due Date', 'date', 1, 90, NULL, NULL, NULL, '{"max_future":true}'),
  (1, (SELECT id FROM form_templates WHERE company_id=1 AND service_type_code='SRV_SUPPLY'), 'statement_text', 'البيان', 'Narration', 'text', 1, 100, NULL, NULL, NULL, '{"min_length":3}');

-- ── BLOCK 4: Verification ─────────────────────────────────────────────────────
SELECT
  'migration_0110_complete'                                       AS status,
  (SELECT COUNT(*) FROM unit_types WHERE company_id=1)           AS unit_types_seeded,
  (SELECT COUNT(*) FROM form_templates WHERE company_id=1)       AS templates_seeded,
  (SELECT COUNT(*) FROM form_fields WHERE company_id=1)          AS fields_seeded;
