-- =============================================================================
-- Migration 0041: Microsoft Dynamics–Style Posting Groups
-- Created: 2025-01-01
-- Safe: Only CREATE TABLE and ALTER TABLE ADD COLUMN statements.
--       No DROP, RENAME, UPDATE, or DELETE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BUSINESS POSTING GROUPS  (one per supplier / customer category)
--    Examples: DOM_SUPPLIER, EXPORT_CUSTOMER, GOVT_AGENCY
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_posting_groups (
    code         TEXT NOT NULL,
    company_id   INTEGER NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (code, company_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 2. PRODUCT POSTING GROUPS  (one per item / product category)
--    Examples: SEED, FERTILIZER, EQUIPMENT, HARVEST_CROP
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_posting_groups (
    code         TEXT NOT NULL,
    company_id   INTEGER NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (code, company_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 3. INVENTORY POSTING GROUPS  (one per warehouse / storage type)
--    Examples: MAIN_WH, COLD_STORE, FIELD_STORE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_posting_groups (
    code         TEXT NOT NULL,
    company_id   INTEGER NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (code, company_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 4. GENERAL POSTING SETUP  (BPG × PPG matrix → revenue, COGS, expense accounts)
--    NULL code means "default / catch-all for this company"
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS general_posting_setup (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id              INTEGER NOT NULL,
    bus_posting_group_code  TEXT,       -- NULL = wildcard (any BPG)
    prod_posting_group_code TEXT,       -- NULL = wildcard (any PPG)
    -- Core account fields
    sales_account           TEXT NOT NULL,
    purchases_account       TEXT NOT NULL,
    cogs_account            TEXT NOT NULL,
    -- Optional overrides
    sales_returns_account   TEXT,
    purch_returns_account   TEXT,
    expense_account         TEXT,
    -- Audit
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (company_id, bus_posting_group_code, prod_posting_group_code),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 5. INVENTORY POSTING SETUP  (IPG × PPG matrix → inventory balance sheet account)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_posting_setup (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id              INTEGER NOT NULL,
    inv_posting_group_code  TEXT,       -- NULL = wildcard (any IPG)
    prod_posting_group_code TEXT,       -- NULL = wildcard (any PPG)
    -- Core account field
    inventory_account       TEXT NOT NULL,
    -- Audit
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (company_id, inv_posting_group_code, prod_posting_group_code),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

-- =============================================================================
-- ALTER TABLE: Add FK columns to existing tables (additive only)
-- =============================================================================

ALTER TABLE suppliers       ADD COLUMN bus_posting_group_code TEXT;
ALTER TABLE items           ADD COLUMN prod_posting_group_code TEXT;
ALTER TABLE item_categories ADD COLUMN prod_posting_group_code TEXT;
ALTER TABLE warehouses      ADD COLUMN inv_posting_group_code  TEXT;
