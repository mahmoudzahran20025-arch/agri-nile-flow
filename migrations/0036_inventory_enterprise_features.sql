-- Migration 0036: Inventory Enterprise Features (Categories, Adjustments)

-- 1. Item Categories (Product Families)
CREATE TABLE IF NOT EXISTS item_categories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  name           TEXT NOT NULL,
  parent_id      INTEGER,
  expense_account_code TEXT,
  inventory_account_code TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, name),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(parent_id) REFERENCES item_categories(id)
);

-- Seed default categories to avoid empty state
INSERT OR IGNORE INTO item_categories (company_id, name)
SELECT id, 'أسمدة ومغذيات' FROM companies;

INSERT OR IGNORE INTO item_categories (company_id, name)
SELECT id, 'مبيدات' FROM companies;

INSERT OR IGNORE INTO item_categories (company_id, name)
SELECT id, 'بذور وتقاوي' FROM companies;

INSERT OR IGNORE INTO item_categories (company_id, name)
SELECT id, 'قطع غيار' FROM companies;

INSERT OR IGNORE INTO item_categories (company_id, name)
SELECT id, 'مواد تعبئة وتغليف' FROM companies;


-- 2. Alter Items to support Categories and Tracking
-- SQLite doesn't support ADD COLUMN with FOREIGN KEY constraint directly easily without table rebuild, 
-- but we can just add the column and rely on app logic or basic INTEGER type.
ALTER TABLE items ADD COLUMN category_id INTEGER REFERENCES item_categories(id);
ALTER TABLE items ADD COLUMN track_lots INTEGER NOT NULL DEFAULT 0;

-- Auto-map existing items to the first category just to keep data clean, or leave as NULL.


-- 3. Inventory Adjustments (التسويات الجردية)
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  warehouse_id   INTEGER NOT NULL,
  adjustment_date TEXT NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'posted', 'cancelled')),
  created_by     INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE IF NOT EXISTS inventory_adjustment_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_id  INTEGER NOT NULL,
  item_code      INTEGER NOT NULL,
  theoretical_qty REAL NOT NULL,
  counted_qty    REAL NOT NULL,
  difference     REAL NOT NULL,
  notes          TEXT,
  FOREIGN KEY(adjustment_id) REFERENCES inventory_adjustments(id) ON DELETE CASCADE
);

-- Note: When an adjustment is posted, we will generate an inventory_movement for the `difference`.
