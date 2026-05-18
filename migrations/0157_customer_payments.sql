-- 0157: Customer payment receipts (AR collection)
-- Records cash collected from credit customers. Each row DR Cash / CR AR.

CREATE TABLE IF NOT EXISTS customer_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  payment_date   TEXT    NOT NULL,
  amount         REAL    NOT NULL CHECK(amount > 0),
  payment_method TEXT    NOT NULL DEFAULT 'cash'
                         CHECK(payment_method IN ('cash', 'card', 'bank_transfer', 'cheque')),
  reference      TEXT,                          -- cheque number, transfer ref, etc.
  notes          TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_by     INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_company_customer
  ON customer_payments(company_id, customer_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_customer_payments_date
  ON customer_payments(company_id, payment_date DESC);
