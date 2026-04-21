-- ============================================================================
--  Nawa AgroLedger  —  Cleaned-staging + Unified Double-Entry GL
--  Generated 2026-04-21 from source Excel files (نواة المستقبل 2025-2026).
--  Target: SQLite / D1  (PostgreSQL variants noted inline)
-- ============================================================================
--  PHILOSOPHY
--  ----------
--  * Ingest raw Excel rows into stg_*  tables with zero transformation.
--  * Filter ghost rows (where transaction_date IS NULL) when promoting
--    stg_*  →  fact tables.
--  * Drop running-balance & YEAR()/MONTH() columns — compute them on read
--    via views/windows.
--  * Collapse the 3 transaction streams into ONE general-ledger table
--    (gl_entries) using double-entry debit/credit pairing per voucher.
-- ============================================================================


-- ─── 1. STAGING  (raw Excel → DB, no transformation) ────────────────────────
CREATE TABLE IF NOT EXISTS stg_cash_txn (
  source_row          INTEGER,
  raw_date            TEXT,
  status_flag         TEXT,          -- د / م
  document_number     TEXT,
  recipient_name      TEXT,
  narration           TEXT,
  notes               TEXT,
  supplier_code       TEXT,
  center_code         TEXT,
  expense_code        TEXT,
  sub_code            TEXT,
  unit                TEXT,
  quantity            TEXT,
  unit_price          TEXT,
  amount              TEXT,
  debit               TEXT,
  credit              TEXT
);

CREATE TABLE IF NOT EXISTS stg_supplier_txn (
  source_row          INTEGER,
  raw_date            TEXT,
  entry_type          TEXT,
  supplier_code       TEXT,
  narration           TEXT,
  document_type       TEXT,
  document_number     TEXT,
  expense_category    TEXT,
  equipment           TEXT,
  service             TEXT,
  account_code        TEXT,
  center_code         TEXT,
  sub_code            TEXT,
  unit                TEXT,
  quantity            TEXT,
  unit_price          TEXT,
  amount              TEXT,
  credit              TEXT,
  debit               TEXT,
  check_amount        TEXT,
  due_date            TEXT,
  check_clearance_date TEXT,
  notes               TEXT
);

CREATE TABLE IF NOT EXISTS stg_inventory_mv (
  source_row          INTEGER,
  raw_date            TEXT,
  warehouse           TEXT,
  movement_type       TEXT,
  document_number     TEXT,
  supplier_code       TEXT,
  item_code           TEXT,
  unit                TEXT,
  package_type        TEXT,
  pack_capacity       TEXT,
  pack_count          TEXT,
  account_code        TEXT,
  center_code         TEXT,
  sub_code            TEXT,
  quantity            TEXT,
  unit_price          TEXT,
  qty_in              TEXT,
  qty_out             TEXT,
  value_in            TEXT,
  value_out           TEXT
);


-- ─── 2. MASTER / DIMENSION TABLES  (already exist in schema.sql) ────────────
-- Re-stated here only if you're deploying to a blank DB:
-- CREATE TABLE suppliers     (code BIGINT PK, name TEXT, activity TEXT, notes TEXT);
-- CREATE TABLE cost_centers  (code BIGINT PK, name TEXT);
-- CREATE TABLE accounts      (code BIGINT PK, name TEXT);
-- CREATE TABLE expense_types (code BIGINT PK, name TEXT);
-- CREATE TABLE sub_locations (code BIGINT PK, name TEXT);
-- CREATE TABLE items         (code BIGINT PK, name TEXT, unit TEXT, warehouse TEXT);


-- ─── 3. CLEANED FACT TABLES  (populate from staging) ────────────────────────
CREATE TABLE IF NOT EXISTS cash_transactions_clean (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_date   DATE    NOT NULL,
  direction          TEXT    NOT NULL CHECK (direction IN ('د','م')),  -- د=receipt, م=payment
  document_number    BIGINT,
  recipient_name     TEXT,
  narration          TEXT,
  notes              TEXT,
  supplier_code      BIGINT REFERENCES suppliers(code),
  center_code        BIGINT REFERENCES cost_centers(code),
  expense_code       BIGINT REFERENCES expense_types(code),
  sub_code           BIGINT REFERENCES sub_locations(code),
  unit               TEXT,
  quantity           DECIMAL(18,4),
  unit_price         DECIMAL(18,4),
  amount             DECIMAL(18,4) NOT NULL,
  debit              DECIMAL(18,4) NOT NULL DEFAULT 0,
  credit             DECIMAL(18,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cct_date ON cash_transactions_clean(transaction_date);
CREATE INDEX IF NOT EXISTS idx_cct_supplier ON cash_transactions_clean(supplier_code);

CREATE TABLE IF NOT EXISTS supplier_transactions_clean (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_date      DATE    NOT NULL,
  entry_type            TEXT    CHECK (entry_type IN ('د','م')),
  supplier_code         BIGINT REFERENCES suppliers(code),
  document_type         TEXT,
  document_number       BIGINT,
  narration             TEXT,
  expense_category      TEXT,
  equipment             TEXT,
  service               TEXT,
  account_code          BIGINT REFERENCES accounts(code),
  center_code           BIGINT REFERENCES cost_centers(code),
  sub_code              BIGINT REFERENCES sub_locations(code),
  unit                  TEXT,
  quantity              DECIMAL(18,4),
  unit_price            DECIMAL(18,4),
  amount                DECIMAL(18,4) NOT NULL,
  credit                DECIMAL(18,4) NOT NULL DEFAULT 0,
  debit                 DECIMAL(18,4) NOT NULL DEFAULT 0,
  check_amount          DECIMAL(18,4) NOT NULL DEFAULT 0,
  due_date              DATE,
  check_clearance_date  DATE,
  notes                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_stc_date ON supplier_transactions_clean(transaction_date);
CREATE INDEX IF NOT EXISTS idx_stc_supplier ON supplier_transactions_clean(supplier_code);

CREATE TABLE IF NOT EXISTS inventory_movements_clean (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_date      DATE    NOT NULL,
  warehouse          TEXT    NOT NULL,
  movement_type      TEXT    NOT NULL CHECK (movement_type IN ('اضافة','صرف')),
  document_number    BIGINT,
  supplier_code      BIGINT REFERENCES suppliers(code),
  item_code          BIGINT REFERENCES items(code),
  unit               TEXT,
  package_type       TEXT,
  pack_capacity      DECIMAL(18,4),
  pack_count         DECIMAL(18,4),
  account_code       BIGINT REFERENCES accounts(code),
  center_code        BIGINT REFERENCES cost_centers(code),
  sub_code           BIGINT REFERENCES sub_locations(code),
  quantity           DECIMAL(18,4) NOT NULL DEFAULT 0,
  unit_price         DECIMAL(18,4),
  qty_in             DECIMAL(18,4) NOT NULL DEFAULT 0,
  qty_out            DECIMAL(18,4) NOT NULL DEFAULT 0,
  value_in           DECIMAL(18,4) NOT NULL DEFAULT 0,
  value_out          DECIMAL(18,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_imc_date ON inventory_movements_clean(movement_date);
CREATE INDEX IF NOT EXISTS idx_imc_item ON inventory_movements_clean(item_code);


-- ─── 4. PROMOTE  stg_*  →  *_clean  (filtering ghost rows) ──────────────────
INSERT INTO cash_transactions_clean
  (transaction_date, direction, document_number, recipient_name, narration, notes,
   supplier_code, center_code, expense_code, sub_code,
   unit, quantity, unit_price, amount, debit, credit)
SELECT
  DATE(raw_date), status_flag,
  CAST(document_number AS INTEGER), recipient_name, narration, notes,
  CAST(supplier_code AS INTEGER), CAST(center_code AS INTEGER),
  CAST(expense_code AS INTEGER), CAST(sub_code AS INTEGER),
  TRIM(unit), CAST(quantity AS REAL), CAST(unit_price AS REAL),
  CAST(amount AS REAL), CAST(debit AS REAL), CAST(credit AS REAL)
FROM stg_cash_txn
WHERE raw_date IS NOT NULL
  AND raw_date NOT LIKE '#N/A%'
  AND DATE(raw_date) <= DATE('now');     -- discard future-dated ghosts

INSERT INTO supplier_transactions_clean (
  transaction_date, entry_type, supplier_code, document_type, document_number, narration,
  expense_category, equipment, service, account_code, center_code, sub_code,
  unit, quantity, unit_price, amount, credit, debit, check_amount,
  due_date, check_clearance_date, notes)
SELECT
  DATE(raw_date), entry_type, CAST(supplier_code AS INTEGER), document_type,
  CAST(document_number AS INTEGER), narration, expense_category, equipment, service,
  CAST(account_code AS INTEGER), CAST(center_code AS INTEGER), CAST(sub_code AS INTEGER),
  TRIM(unit), CAST(quantity AS REAL), CAST(unit_price AS REAL),
  CAST(amount AS REAL), CAST(credit AS REAL), CAST(debit AS REAL),
  CAST(check_amount AS REAL), DATE(due_date), DATE(check_clearance_date), notes
FROM stg_supplier_txn
WHERE raw_date IS NOT NULL
  AND raw_date NOT LIKE '#N/A%'
  AND DATE(raw_date) <= DATE('now');

INSERT INTO inventory_movements_clean (
  movement_date, warehouse, movement_type, document_number, supplier_code, item_code,
  unit, package_type, pack_capacity, pack_count, account_code, center_code, sub_code,
  quantity, unit_price, qty_in, qty_out, value_in, value_out)
SELECT
  DATE(raw_date), TRIM(warehouse), movement_type, CAST(document_number AS INTEGER),
  CAST(supplier_code AS INTEGER), CAST(item_code AS INTEGER),
  TRIM(unit), TRIM(package_type),
  CAST(pack_capacity AS REAL), CAST(pack_count AS REAL),
  CAST(account_code AS INTEGER), CAST(center_code AS INTEGER), CAST(sub_code AS INTEGER),
  CAST(quantity AS REAL), CAST(unit_price AS REAL),
  CAST(qty_in AS REAL), CAST(qty_out AS REAL),
  CAST(value_in AS REAL), CAST(value_out AS REAL)
FROM stg_inventory_mv
WHERE raw_date IS NOT NULL
  AND raw_date NOT LIKE '#N/A%'
  AND DATE(raw_date) <= DATE('now');


-- ─── 5. UNIFIED DOUBLE-ENTRY GENERAL LEDGER ─────────────────────────────────
--  Every row in the 3 streams is decomposed into 1..N gl_entries:
--    • treasury payment (م)     →  DR expense/supplier account   CR cash/bank
--    • treasury receipt (د)     →  DR cash/bank                  CR capital/revenue
--    • supplier invoice (د)     →  DR expense                    CR supplier
--    • supplier payment (م)     →  DR supplier                   CR cash
--    • inventory receipt (اضافة) →  DR inventory-value            CR supplier
--    • inventory issue  (صرف)   →  DR cost-center-expense        CR inventory-value
--
--  We keep ONE row per leg so debit+credit per voucher always balances.

CREATE TABLE IF NOT EXISTS gl_vouchers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no         TEXT NOT NULL,
  voucher_date       DATE NOT NULL,
  source_module      TEXT NOT NULL CHECK (source_module IN ('CASH','AP','INV')),
  source_ref_id      INTEGER NOT NULL,          -- FK to *_clean tables
  narration          TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gl_entries (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id         INTEGER NOT NULL REFERENCES gl_vouchers(id) ON DELETE CASCADE,
  entry_date         DATE NOT NULL,
  account_code       BIGINT NOT NULL REFERENCES accounts(code),
  supplier_code      BIGINT REFERENCES suppliers(code),
  center_code        BIGINT REFERENCES cost_centers(code),
  item_code          BIGINT REFERENCES items(code),
  debit              DECIMAL(18,4) NOT NULL DEFAULT 0,
  credit             DECIMAL(18,4) NOT NULL DEFAULT 0,
  narration          TEXT,
  CHECK ((debit = 0 AND credit > 0) OR (debit > 0 AND credit = 0))
);
CREATE INDEX IF NOT EXISTS idx_gle_date     ON gl_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_gle_account  ON gl_entries(account_code);
CREATE INDEX IF NOT EXISTS idx_gle_supplier ON gl_entries(supplier_code);


-- ─── 6. CALCULATED VIEWS  (replace Excel running-balance columns) ───────────
-- Supplier running balance (AP)
CREATE VIEW IF NOT EXISTS v_supplier_balance AS
SELECT
  s.code                                               AS supplier_code,
  s.name                                               AS supplier_name,
  SUM(e.credit) - SUM(e.debit)                         AS outstanding_balance,
  MAX(e.entry_date)                                    AS last_movement
FROM suppliers s
LEFT JOIN gl_entries e ON e.supplier_code = s.code
GROUP BY s.code, s.name;

-- Item stock balance  (quantity + value)
CREATE VIEW IF NOT EXISTS v_item_stock AS
SELECT
  i.code                                               AS item_code,
  i.name                                               AS item_name,
  SUM(COALESCE(qty_in,0) - COALESCE(qty_out,0))        AS qty_on_hand,
  SUM(COALESCE(value_in,0) - COALESCE(value_out,0))    AS stock_value
FROM items i
LEFT JOIN inventory_movements_clean m ON m.item_code = i.code
GROUP BY i.code, i.name;

-- Cash position (running treasury balance)
CREATE VIEW IF NOT EXISTS v_cash_position AS
SELECT
  transaction_date,
  SUM(SUM(debit)  - SUM(credit)) OVER (ORDER BY transaction_date) AS running_balance
FROM cash_transactions_clean
GROUP BY transaction_date;

-- Trial balance
CREATE VIEW IF NOT EXISTS v_trial_balance AS
SELECT
  a.code, a.name,
  SUM(e.debit)  AS total_debit,
  SUM(e.credit) AS total_credit,
  SUM(e.debit) - SUM(e.credit) AS net
FROM accounts a
LEFT JOIN gl_entries e ON e.account_code = a.code
GROUP BY a.code, a.name;


-- ─── 7. DATA-QUALITY ASSERTIONS  (run after load) ───────────────────────────
-- 7a. every voucher must balance
-- SELECT voucher_id, SUM(debit) - SUM(credit) AS delta
-- FROM gl_entries GROUP BY voucher_id HAVING delta <> 0;

-- 7b. orphan supplier codes
-- SELECT DISTINCT supplier_code FROM supplier_transactions_clean
-- WHERE supplier_code NOT IN (SELECT code FROM suppliers);

-- 7c. negative stock
-- SELECT * FROM v_item_stock WHERE qty_on_hand < 0;
