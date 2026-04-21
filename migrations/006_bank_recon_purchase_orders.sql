-- ============================================================
-- Migration 006: Bank Reconciliation + Purchase Orders
-- Applied: 2026-04-21
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. BANK ACCOUNTS — الحسابات البنكية
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  bank_name       TEXT    NOT NULL,             -- اسم البنك
  account_name    TEXT    NOT NULL,             -- اسم الحساب
  account_number  TEXT    NOT NULL,             -- رقم الحساب
  iban            TEXT,                         -- IBAN (اختياري)
  currency        TEXT    NOT NULL DEFAULT 'EGP',
  gl_account_code TEXT,                         -- ربط بشجرة الحسابات
  opening_balance REAL    NOT NULL DEFAULT 0,   -- الرصيد الافتتاحي
  is_active       INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 2. BANK STATEMENTS — كشوف حساب البنك (مستوردة أو مدخلة يدوياً)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_statements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  statement_date  TEXT    NOT NULL,             -- تاريخ الحركة في البنك
  value_date      TEXT,                         -- تاريخ القيمة
  description     TEXT    NOT NULL,             -- البيان كما يظهر في البنك
  ref_number      TEXT,                         -- رقم المرجع من البنك
  amount_in       REAL    NOT NULL DEFAULT 0,   -- إيداع
  amount_out      REAL    NOT NULL DEFAULT 0,   -- سحب
  bank_balance    REAL,                         -- الرصيد بعد الحركة
  is_matched      INTEGER NOT NULL DEFAULT 0,   -- هل تمت المطابقة؟
  matched_tx_id   INTEGER,                      -- معرّف حركة الخزينة المقابلة
  matched_at      TEXT,
  matched_by      INTEGER REFERENCES users(id),
  import_batch_id TEXT,                         -- للاستيراد الجماعي
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bank_stmts_account   ON bank_statements(bank_account_id, statement_date);
CREATE INDEX IF NOT EXISTS idx_bank_stmts_unmatched ON bank_statements(company_id, is_matched) WHERE is_matched = 0;

-- ────────────────────────────────────────────────────────────
-- 3. BANK RECONCILIATIONS — جلسات المطابقة
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies(id),
  bank_account_id     INTEGER NOT NULL REFERENCES bank_accounts(id),
  period_start        TEXT    NOT NULL,
  period_end          TEXT    NOT NULL,
  bank_closing_bal    REAL    NOT NULL DEFAULT 0,   -- رصيد البنك في نهاية الفترة
  book_closing_bal    REAL    NOT NULL DEFAULT 0,   -- رصيد الدفاتر
  outstanding_checks  REAL    NOT NULL DEFAULT 0,   -- شيكات صادرة لم تُصرف
  deposits_in_transit REAL    NOT NULL DEFAULT 0,   -- إيداعات قيد التحصيل
  bank_errors         REAL    NOT NULL DEFAULT 0,   -- فروق بنكية
  book_errors         REAL    NOT NULL DEFAULT 0,   -- فروق دفترية
  adjusted_bank_bal   REAL    GENERATED ALWAYS AS (bank_closing_bal - outstanding_checks + deposits_in_transit + bank_errors) STORED,
  adjusted_book_bal   REAL    GENERATED ALWAYS AS (book_closing_bal + book_errors) STORED,
  difference          REAL    GENERATED ALWAYS AS (bank_closing_bal - outstanding_checks + deposits_in_transit + bank_errors - book_closing_bal - book_errors) STORED,
  status              TEXT    NOT NULL DEFAULT 'draft'  CHECK(status IN ('draft','reconciled','closed')),
  notes               TEXT,
  created_by          INTEGER REFERENCES users(id),
  closed_by           INTEGER REFERENCES users(id),
  closed_at           TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_account ON bank_reconciliations(bank_account_id, period_end);

-- ────────────────────────────────────────────────────────────
-- 4. PURCHASE ORDERS — طلبات الشراء
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  po_number       TEXT    NOT NULL,                     -- رقم أمر الشراء
  supplier_code   INTEGER REFERENCES suppliers(id),
  supplier_name   TEXT,                                  -- اسم المورد (cached)
  order_date      TEXT    NOT NULL,
  expected_date   TEXT,                                  -- تاريخ التسليم المتوقع
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','sent','partial','received','cancelled','closed')),
  total_amount    REAL    NOT NULL DEFAULT 0,
  notes           TEXT,
  requested_by    INTEGER REFERENCES users(id),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TEXT,
  received_by     INTEGER REFERENCES users(id),
  received_at     TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_po_company_status ON purchase_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_po_supplier       ON purchase_orders(supplier_code, order_date);

-- ────────────────────────────────────────────────────────────
-- 5. PURCHASE ORDER ITEMS — بنود طلب الشراء
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id           INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  item_code       TEXT,                       -- كود الصنف (اختياري — قد يكون بدون كود)
  item_name       TEXT    NOT NULL,
  unit            TEXT,
  qty_ordered     REAL    NOT NULL DEFAULT 1,
  qty_received    REAL    NOT NULL DEFAULT 0,
  unit_price      REAL    NOT NULL DEFAULT 0,
  total_price     REAL    GENERATED ALWAYS AS (qty_ordered * unit_price) STORED,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);
