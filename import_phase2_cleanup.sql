-- Phase 2: Deactivate test/demo data (FK-safe)
UPDATE suppliers SET is_active = 0, name = '[TEST] Vfdghcx gfdx' WHERE code = 85;
UPDATE warehouses SET is_active = 0, name = '[TEST] المستودي اختبار' WHERE id = 9;
SELECT 'active_test_suppliers' as check_name, COUNT(*) as cnt FROM suppliers WHERE is_active=1 AND code = 85;
SELECT 'active_test_warehouses' as check_name, COUNT(*) as cnt FROM warehouses WHERE is_active=1 AND id = 9;
