-- 0159: Sales returns (مرتجعات المبيعات)
-- Each return reverses one or more items from a completed sale.
-- GL: DR sales_returns_account / CR cash_default (cash refund) or receivable_default (credit adjustment)
-- Inventory: RETURN_CUSTOMER movement (stock IN) per line

CREATE TABLE IF NOT EXISTS sales_returns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  original_order_id INTEGER NOT NULL REFERENCES sales_orders(id),
  warehouse_id     INTEGER NOT NULL,
  customer_id      INTEGER REFERENCES customers(id),
  return_date      TEXT    NOT NULL,
  subtotal         REAL    NOT NULL DEFAULT 0,
  tax_amount       REAL    NOT NULL DEFAULT 0,
  total            REAL    NOT NULL DEFAULT 0,
  refund_method    TEXT    NOT NULL DEFAULT 'cash'
                           CHECK(refund_method IN ('cash', 'card', 'store_credit', 'credit_adjustment')),
  reason           TEXT,
  notes            TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_by       INTEGER,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_return_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id    INTEGER NOT NULL REFERENCES sales_returns(id),
  company_id   INTEGER NOT NULL,
  item_code    INTEGER NOT NULL,
  quantity     REAL    NOT NULL CHECK(quantity > 0),
  unit_price   REAL    NOT NULL,
  line_total   REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_returns_company_date
  ON sales_returns(company_id, return_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_returns_order
  ON sales_returns(company_id, original_order_id);

CREATE INDEX IF NOT EXISTS idx_sales_return_items_return
  ON sales_return_items(return_id);
