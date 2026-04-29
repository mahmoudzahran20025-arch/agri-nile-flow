-- Fixed cost centers for actual schema
-- cost_centers: code TEXT, name_ar TEXT, cost_center_type TEXT

INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006001', 'مركز 1 - أرض جنوب', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006002', 'مركز 2 - أرض شمال', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006003', 'مركز 3 - أرض شرق', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006004', 'مركز 4 - أرض غرب', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006005', 'مركز 5 - أرض مركزية', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006006', 'مركز 6 - أرض شمال شرق', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006007', 'مركز 7 - أرض شمال غرب', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006008', 'مركز 8 - أرض جنوب شرق', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006009', 'مركز 9 - أرض جنوب غرب', 'DIRECT', 1, datetime('now'));
INSERT OR REPLACE INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) VALUES (1, '1006010', 'مركز 10 - أرض رئيسية', 'DIRECT', 1, datetime('now'));
