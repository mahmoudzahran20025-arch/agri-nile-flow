-- ============================================================
-- Migration 008 — Harvest Records + R2 file key on Documents
-- Date: 2026-04-21
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. HARVEST RECORDS (سجلات الحصاد)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS harvest_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  field_id        INTEGER NOT NULL REFERENCES fields(id),
  season_id       INTEGER REFERENCES seasons(id),

  harvest_date    TEXT    NOT NULL,           -- YYYY-MM-DD
  crop_name       TEXT    NOT NULL,           -- القطن / الذرة / الأرز ...
  variety         TEXT,                       -- الصنف / التقاوي

  -- الكميات
  qty_tons        REAL    NOT NULL DEFAULT 0, -- الناتج بالطن
  qty_feddan      REAL,                       -- الناتج بالفدان (محسوبة = qty_tons / area_feddan)

  -- الجودة
  quality_grade   TEXT    DEFAULT 'standard', -- premium / standard / below_standard
  moisture_pct    REAL,                       -- نسبة الرطوبة %
  impurity_pct    REAL,                       -- نسبة الشوائب %

  -- التكاليف والإيرادات
  actual_cost     REAL    DEFAULT 0,          -- إجمالي تكلفة الموسم
  sell_price_ton  REAL,                       -- سعر البيع / طن
  revenue         REAL,                       -- الإيراد = qty_tons * sell_price_ton
  profit          REAL,                       -- الربح = revenue - actual_cost
  cost_per_feddan REAL,                       -- التكلفة / فدان = actual_cost / area_feddan

  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_harvest_company   ON harvest_records(company_id);
CREATE INDEX IF NOT EXISTS idx_harvest_field     ON harvest_records(field_id);
CREATE INDEX IF NOT EXISTS idx_harvest_season    ON harvest_records(season_id);
CREATE INDEX IF NOT EXISTS idx_harvest_date      ON harvest_records(company_id, harvest_date);

-- ────────────────────────────────────────────────────────────
-- 2. R2 file key on documents table
-- ────────────────────────────────────────────────────────────
ALTER TABLE documents ADD COLUMN file_r2_key    TEXT;
ALTER TABLE documents ADD COLUMN file_size_kb   INTEGER;
ALTER TABLE documents ADD COLUMN file_mime_type TEXT;
