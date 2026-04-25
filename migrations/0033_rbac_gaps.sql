-- Migration 0033: Fix RBAC Permission Gaps
-- Problem: sidebar uses 'finance.read' and 'hr.read' which don't exist in permissions table.
--          field_supervisor role has zero permissions (never seeded).
--          warehouse_mgr lacks operations.read so can't see fields/operations pages.

-- ── 1. Add missing permission modules ────────────────────────
INSERT OR IGNORE INTO permissions (module, action) VALUES
  ('finance', 'read'),
  ('finance', 'write'),
  ('hr',      'read'),
  ('hr',      'write');

-- ── 2. Grant finance.read to roles that should see GL ────────
-- company_admin + accountant + viewer (read-only)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('company_admin', 'accountant', 'viewer')
  AND p.module = 'finance' AND p.action = 'read';

-- company_admin gets finance.write too
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'company_admin'
  AND p.module = 'finance' AND p.action = 'write';

-- accountant gets finance.write
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'accountant'
  AND p.module = 'finance' AND p.action = 'write';

-- ── 3. Grant hr.read to roles that should see HR ────────────
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('company_admin', 'accountant', 'warehouse_mgr', 'field_supervisor', 'viewer')
  AND p.module = 'hr' AND p.action = 'read';

-- company_admin gets hr.write
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'company_admin'
  AND p.module = 'hr' AND p.action = 'write';

-- ── 4. Seed field_supervisor role (currently has zero permissions) ──
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'field_supervisor'
  AND (
    -- can see and manage operations, fields, work orders, contracts
    (p.module IN ('operations', 'fields', 'contracts') AND p.action IN ('read', 'write'))
    -- can view inventory
    OR (p.module = 'inventory' AND p.action = 'read')
    -- can view reports
    OR (p.module = 'reports'   AND p.action = 'read')
    -- can view HR
    OR (p.module = 'hr'        AND p.action = 'read')
    -- can view suppliers (read only)
    OR (p.module = 'suppliers'  AND p.action = 'read')
  );

-- ── 5. Fix warehouse_mgr — add operations.read so they can see fields/work orders ──
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'warehouse_mgr'
  AND p.module = 'operations' AND p.action = 'read';
