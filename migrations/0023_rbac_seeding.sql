-- ============================================================
-- Migration 0023: RBAC Seeding
-- Purpose: Link roles to their respective permissions.
-- ============================================================

-- A. Super Admin: All Permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM roles r, permissions p 
WHERE r.name = 'super_admin';

-- B. Company Admin: Almost All (except system-wide admin)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM roles r, permissions p 
WHERE r.name = 'company_admin' AND p.module != 'admin';

-- C. Accountant: Finance + Suppliers + Read others
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM roles r, permissions p 
WHERE r.name = 'accountant' 
  AND (p.module IN ('treasury', 'suppliers', 'reports') OR p.action = 'read');

-- D. Warehouse Manager: Inventory + Read Suppliers
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM roles r, permissions p 
WHERE r.name = 'warehouse_mgr' 
  AND (p.module = 'inventory' OR (p.module = 'suppliers' AND p.action = 'read'));

-- E. Viewer: Read Only
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM roles r, permissions p 
WHERE r.name = 'viewer' AND p.action = 'read';
