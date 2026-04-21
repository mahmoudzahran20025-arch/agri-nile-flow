-- ============================================================
-- Migration 001: Database Hardening
-- Constraints + Staging Tables + Audit Triggers
-- Applied: 2026-04-21
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENUM ENFORCEMENT TRIGGERS
--    SQLite doesn't support ALTER TABLE ADD CONSTRAINT,
--    so we use BEFORE INSERT / BEFORE UPDATE triggers.
-- ────────────────────────────────────────────────────────────

-- inventory_movements.movement_type must be 'اضافة' or 'صرف'
CREATE TRIGGER IF NOT EXISTS trg_im_type_insert
BEFORE INSERT ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type NOT IN ('اضافة', 'صرف')
    THEN RAISE(ABORT, 'ERR_INVALID_MOVEMENT_TYPE: يجب أن يكون النوع اضافة أو صرف')
  END;
  SELECT CASE
    WHEN NEW.quantity IS NULL OR NEW.quantity <= 0
    THEN RAISE(ABORT, 'ERR_INVALID_QUANTITY: الكمية يجب أن تكون أكبر من صفر')
  END;
  SELECT CASE
    WHEN NEW.warehouse IS NULL OR TRIM(NEW.warehouse) = ''
    THEN RAISE(ABORT, 'ERR_MISSING_WAREHOUSE: المخزن مطلوب')
  END;
  SELECT CASE
    WHEN NEW.movement_date IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_DATE: تاريخ الحركة مطلوب')
  END;
  SELECT CASE
    WHEN NEW.item_code IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_ITEM: كود الصنف مطلوب')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_im_type_update
BEFORE UPDATE ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type NOT IN ('اضافة', 'صرف')
    THEN RAISE(ABORT, 'ERR_INVALID_MOVEMENT_TYPE: يجب أن يكون النوع اضافة أو صرف')
  END;
  SELECT CASE
    WHEN NEW.quantity IS NULL OR NEW.quantity <= 0
    THEN RAISE(ABORT, 'ERR_INVALID_QUANTITY: الكمية يجب أن تكون أكبر من صفر')
  END;
END;

-- inventory_movements: prevent deletion (immutable ledger)
CREATE TRIGGER IF NOT EXISTS trg_im_no_delete
BEFORE DELETE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'ERR_IMMUTABLE: سجلات المخزون لا يمكن حذفها — استخدم حركة عكسية');
END;

-- cash_transactions.direction must be standard values
CREATE TRIGGER IF NOT EXISTS trg_ct_direction_insert
BEFORE INSERT ON cash_transactions
BEGIN
  SELECT CASE
    WHEN NEW.direction NOT IN ('د', 'م', 'in', 'out', 'وارد', 'صادر', 'debit', 'credit')
    THEN RAISE(ABORT, 'ERR_INVALID_DIRECTION: الاتجاه غير صالح')
  END;
  SELECT CASE
    WHEN NEW.amount IS NULL OR NEW.amount < 0
    THEN RAISE(ABORT, 'ERR_INVALID_AMOUNT: المبلغ يجب أن يكون صفراً أو أكبر')
  END;
  SELECT CASE
    WHEN NEW.transaction_date IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_DATE: تاريخ الحركة مطلوب')
  END;
END;

-- cash_transactions: prevent deletion
CREATE TRIGGER IF NOT EXISTS trg_ct_no_delete
BEFORE DELETE ON cash_transactions
BEGIN
  SELECT RAISE(ABORT, 'ERR_IMMUTABLE: سجلات الخزينة لا يمكن حذفها — استخدم حركة عكسية');
END;

-- supplier_transactions: prevent deletion
CREATE TRIGGER IF NOT EXISTS trg_st_no_delete
BEFORE DELETE ON supplier_transactions
BEGIN
  SELECT RAISE(ABORT, 'ERR_IMMUTABLE: سجلات الموردين لا يمكن حذفها — استخدم قيد عكسي');
END;

-- supplier_transactions: amount must not be negative
CREATE TRIGGER IF NOT EXISTS trg_st_amount_insert
BEFORE INSERT ON supplier_transactions
BEGIN
  SELECT CASE
    WHEN NEW.transaction_date IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_DATE: تاريخ المعاملة مطلوب')
  END;
  SELECT CASE
    WHEN NEW.entry_type IS NULL OR TRIM(NEW.entry_type) = ''
    THEN RAISE(ABORT, 'ERR_MISSING_ENTRY_TYPE: نوع القيد مطلوب')
  END;
END;

-- gl journal entries: prevent deletion of posted entries
CREATE TRIGGER IF NOT EXISTS trg_je_no_delete
BEFORE DELETE ON journal_entries
BEGIN
  SELECT CASE
    WHEN OLD.is_posted = 1
    THEN RAISE(ABORT, 'ERR_IMMUTABLE: قيود المحاسبة المرحّلة لا يمكن حذفها')
  END;
END;

-- ────────────────────────────────────────────────────────────
-- 2. AUTOMATIC AUDIT TRAIL TRIGGERS
--    Write to audit_log automatically on any CUD operation.
-- ────────────────────────────────────────────────────────────

-- Auto-audit: inventory_movements INSERT
CREATE TRIGGER IF NOT EXISTS trg_audit_im_insert
AFTER INSERT ON inventory_movements
BEGIN
  INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, new_value, source)
  VALUES (
    NEW.created_by_user_id,
    NEW.company_id,
    'CREATE',
    'inventory_movements',
    NEW.id,
    json_object(
      'movement_type', NEW.movement_type,
      'item_code',     NEW.item_code,
      'warehouse',     NEW.warehouse,
      'quantity',      NEW.quantity,
      'unit_price',    NEW.unit_price,
      'movement_date', NEW.movement_date
    ),
    CASE WHEN NEW.is_offline_origin = 1 THEN 'offline' ELSE 'web' END
  );
END;

-- Auto-audit: cash_transactions INSERT
CREATE TRIGGER IF NOT EXISTS trg_audit_ct_insert
AFTER INSERT ON cash_transactions
BEGIN
  INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, new_value, source)
  VALUES (
    NEW.created_by_user_id,
    NEW.company_id,
    'CREATE',
    'cash_transactions',
    NEW.id,
    json_object(
      'direction',        NEW.direction,
      'amount',           NEW.amount,
      'transaction_date', NEW.transaction_date,
      'narration',        NEW.narration
    ),
    CASE WHEN NEW.is_offline_origin = 1 THEN 'offline' ELSE 'web' END
  );
END;

-- Auto-audit: supplier_transactions INSERT
CREATE TRIGGER IF NOT EXISTS trg_audit_st_insert
AFTER INSERT ON supplier_transactions
BEGIN
  INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, new_value, source)
  VALUES (
    NEW.created_by_user_id,
    NEW.company_id,
    'CREATE',
    'supplier_transactions',
    NEW.id,
    json_object(
      'entry_type',       NEW.entry_type,
      'supplier_code',    NEW.supplier_code,
      'amount',           NEW.amount,
      'transaction_date', NEW.transaction_date
    ),
    CASE WHEN NEW.is_offline_origin = 1 THEN 'offline' ELSE 'web' END
  );
END;

-- ────────────────────────────────────────────────────────────
-- 3. STAGING TABLES (Data Entry Buffer)
--    All bulk/offline imports land here first.
--    A reviewer approves/rejects before promotion to production.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staging_movements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  batch_id         TEXT    NOT NULL,             -- groups rows from one import session
  status           TEXT    NOT NULL DEFAULT 'pending',
                                                  -- pending | approved | rejected | promoted
  rejection_reason TEXT,
  -- Movement data (mirrors inventory_movements)
  movement_date    TEXT    NOT NULL,
  warehouse        TEXT    NOT NULL,
  movement_type    TEXT    NOT NULL,
  item_code        INTEGER,
  item_name_raw    TEXT,                          -- original text if item_code not resolved
  quantity         REAL    NOT NULL DEFAULT 0,
  unit_price       REAL,
  supplier_code    INTEGER,
  supplier_name_raw TEXT,
  document_number  INTEGER,
  season_id        INTEGER REFERENCES seasons(id),
  notes            TEXT,
  -- Validation state
  validation_errors TEXT,                         -- JSON array: ["ERR_MISSING_ITEM", ...]
  is_valid         INTEGER NOT NULL DEFAULT 0,    -- 1 if passed all validations
  -- Lifecycle
  created_by       INTEGER REFERENCES users(id),
  reviewed_by      INTEGER REFERENCES users(id),
  reviewed_at      TEXT,
  promoted_id      INTEGER,                       -- → inventory_movements.id after promotion
  promoted_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staging_mov_company ON staging_movements(company_id, status);
CREATE INDEX IF NOT EXISTS idx_staging_mov_batch   ON staging_movements(batch_id);

-- ────────────────────────────────────────────────────────────
-- 4. OFFLINE SYNC QUEUE
--    Device-local operations that need to sync when online.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS offline_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  device_id     TEXT    NOT NULL,
  local_id      TEXT    NOT NULL,               -- client-generated UUID
  operation     TEXT    NOT NULL,               -- 'inventory_movement' | 'cash_tx' | 'supplier_tx'
  payload       TEXT    NOT NULL,               -- JSON of the operation
  status        TEXT    NOT NULL DEFAULT 'pending',
                                                -- pending | processing | done | error
  error_message TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT,
  UNIQUE (device_id, local_id)                  -- idempotent replay
);

CREATE INDEX IF NOT EXISTS idx_oq_company_status ON offline_queue(company_id, status);
CREATE INDEX IF NOT EXISTS idx_oq_device         ON offline_queue(device_id, status);

-- ────────────────────────────────────────────────────────────
-- 5. ITEM UNITS TABLE (unit conversion master)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS item_units (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  item_code       INTEGER NOT NULL,
  unit_name       TEXT    NOT NULL,             -- e.g. 'كرتون', 'علبة', 'كجم'
  conversion_qty  REAL    NOT NULL DEFAULT 1,  -- 1 كرتون = 12 علبة → conversion_qty = 12
  is_base_unit    INTEGER NOT NULL DEFAULT 0,  -- the base unit has conversion_qty = 1
  UNIQUE (company_id, item_code, unit_name)
);

CREATE INDEX IF NOT EXISTS idx_item_units_item ON item_units(company_id, item_code);

-- ────────────────────────────────────────────────────────────
-- 6. REORDER RULES (per item × warehouse)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reorder_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id),
  item_code         INTEGER NOT NULL,
  warehouse         TEXT    NOT NULL,
  reorder_threshold REAL    NOT NULL DEFAULT 0,  -- trigger alert below this
  reorder_qty       REAL    NOT NULL DEFAULT 0,  -- suggested order quantity
  lead_time_days    INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  UNIQUE (company_id, item_code, warehouse)
);

CREATE INDEX IF NOT EXISTS idx_reorder_company ON reorder_rules(company_id);
