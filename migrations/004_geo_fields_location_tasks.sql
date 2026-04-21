-- ============================================================
-- Migration 004 — Geo Features + Field Dimensions + Location Tasks
-- Date: 2026-04-21
-- ============================================================
-- Covers:
--   1. Enhance fields table: GPS center + geofence + dimensions (optional)
--   2. Enhance attendance_records: location_status + accuracy + field_id
--   3. New table: location_tasks (مهام زيارة موضع)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. FIELDS — Add geo columns
-- ────────────────────────────────────────────────────────────
-- [PRIMARY] GeoJSON Polygon boundary — drawn via geojson.io
-- area_feddan + center_lat/lng are auto-computed from this polygon on save
ALTER TABLE fields ADD COLUMN boundary_geojson   TEXT;
-- GeoJSON FeatureCollection string (Polygon or MultiPolygon)

-- Center point (auto-computed from polygon centroid, or manual fallback)
ALTER TABLE fields ADD COLUMN center_lat         REAL;
ALTER TABLE fields ADD COLUMN center_lng         REAL;

-- Geofence tolerance for field visits (default 150m)
-- Used when employee must arrive "near" the field
ALTER TABLE fields ADD COLUMN geofence_radius_m  INTEGER DEFAULT 150;

-- Optional manual dimensions (fallback if no polygon drawn)
-- Both area_feddan AND dimensions are allowed — user chooses
ALTER TABLE fields ADD COLUMN length_m           REAL;
ALTER TABLE fields ADD COLUMN width_m            REAL;

-- ────────────────────────────────────────────────────────────
-- 2. ATTENDANCE_RECORDS — Add geo columns
-- ────────────────────────────────────────────────────────────
-- check_in_lat / check_in_lng already exist
-- Adding: classification + accuracy + optional field link
ALTER TABLE attendance_records ADD COLUMN location_status  TEXT DEFAULT 'unverified';
-- onsite   = داخل نطاق الفرع (geofence_radius_m)
-- field    = خارج الفرع — تم ربطه بحقل أو موقع محدد
-- unverified = لم يتم التحقق من الموقع (GPS ضعيف أو لم يُسجَّل)

ALTER TABLE attendance_records ADD COLUMN gps_accuracy_m  REAL;
-- الدقة من navigator.geolocation — إذا > 100m يظهر تحذير

ALTER TABLE attendance_records ADD COLUMN field_id         INTEGER REFERENCES fields(id);
-- ربط اختياري بحقل زراعي إذا كان الموظف في الحقل

-- Index for fast field-based queries
CREATE INDEX IF NOT EXISTS idx_att_field ON attendance_records(field_id) WHERE field_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. LOCATION_TASKS (مهام زيارة موضع)
-- ────────────────────────────────────────────────────────────
-- المدير يُسند مهمة للموظف لزيارة موضع ما (حقل زراعي أو موقع مخصص)
-- الموظف يصل ويضغط "تسجيل وصول" — GPS يتحقق من المسافة
-- النتيجة تُحفظ: وصل ✅ أو خارج النطاق ⚠️
CREATE TABLE IF NOT EXISTS location_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  employee_id     INTEGER NOT NULL REFERENCES employees(id),
  assigned_by     INTEGER NOT NULL REFERENCES users(id),

  -- الموضع: إما حقل موجود أو موقع مخصص (الاثنان اختياريان — واحد منهم مطلوب)
  field_id        INTEGER REFERENCES fields(id),   -- ربط بحقل زراعي
  custom_lat      REAL,                             -- موقع مخصص (lat)
  custom_lng      REAL,                             -- موقع مخصص (lng)
  custom_name     TEXT,                             -- اسم الموقع المخصص

  -- إعدادات المهمة
  tolerance_m     INTEGER NOT NULL DEFAULT 150,     -- نطاق القبول (متر) — يُحدده المدير
  task_date       TEXT    NOT NULL,                 -- تاريخ المهمة
  task_notes      TEXT,                             -- ملاحظات المدير

  -- النتيجة بعد وصول الموظف
  status          TEXT    NOT NULL DEFAULT 'pending',
  -- pending = لم يصل بعد
  -- arrived = وصل داخل النطاق ✅
  -- outside  = وصل لكن خارج النطاق ⚠️ (تم التسجيل مع إشارة)
  -- missed   = لم يصل (انتهى اليوم)

  arrived_at      TEXT,     -- وقت الوصول
  arrived_lat     REAL,     -- GPS عند الوصول
  arrived_lng     REAL,
  distance_m      REAL,     -- المسافة الفعلية عند التسجيل
  gps_accuracy_m  REAL,     -- دقة GPS عند الوصول

  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lt_employee ON location_tasks(employee_id, task_date);
CREATE INDEX IF NOT EXISTS idx_lt_company  ON location_tasks(company_id, task_date);
CREATE INDEX IF NOT EXISTS idx_lt_status   ON location_tasks(company_id, status);
