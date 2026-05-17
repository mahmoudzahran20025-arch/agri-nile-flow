-- Migration: 0064_fix_role_permissions_gaps
-- Date: 2026-04-30
-- Purpose: Fix RBAC gaps so company_admin and super_admin have complete permissions
--
-- Gaps identified:
--   super_admin   missing: finance.read(24), finance.write(25), hr.read(26), hr.write(27)
--   company_admin missing: admin.users(14), admin.audit(15)
--
-- Effect on frontend:
--   company_admin can now see /users (إدارة المستخدمين) and /audit (مركز التدقيق) in Sidebar
--   super_admin role_permissions table is now fully consistent with dynamic permission loading

-- ── super_admin: add finance.* and hr.* ──────────────────────────────────────
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
  AND p.module || '.' || p.action IN (
    'finance.read', 'finance.write', 'hr.read', 'hr.write'
  );

-- ── company_admin: add admin.users and admin.audit ───────────────────────────
-- Company owners must be able to manage their company's users and view audit logs
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'company_admin'
  AND p.module || '.' || p.action IN (
    'admin.users', 'admin.audit'
  );
