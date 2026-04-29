-- Fix cost centers SQL (without center_account_mapping)
-- Use posting_rules for GL linkage instead

-- 1. Insert/update cost centers
INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006001, 1, 'مركز 1 - أرض جنوب', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006002, 1, 'مركز 2 - أرض شمال', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006003, 1, 'مركز 3 - أرض شرق', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006004, 1, 'مركز 4 - أرض غرب', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006005, 1, 'مركز 5 - أرض مركزية', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006006, 1, 'مركز 6 - أرض شمال شرق', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006007, 1, 'مركز 7 - أرض شمال غرب', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006008, 1, 'مركز 8 - أرض جنوب شرق', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006009, 1, 'مركز 9 - أرض جنوب غرب', 1, datetime('now'));

INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) 
VALUES (1006010, 1, 'مركز 10 - أرض رئيسية', 1, datetime('now'));

-- Use posting_rules for center-to-GL mapping (flexible approach)
INSERT OR REPLACE INTO posting_rules (company_id, rule_type, mapping_key, account_code, description, is_active) 
VALUES (1, 'control', 'center_1006001', '51101001', 'تكلفة زراعية - مركز 1', 1);

INSERT OR REPLACE INTO posting_rules (company_id, rule_type, mapping_key, account_code, description, is_active) 
VALUES (1, 'control', 'center_1006002', '51101002', 'تكلفة زراعية - مركز 2', 1);

INSERT OR REPLACE INTO posting_rules (company_id, rule_type, mapping_key, account_code, description, is_active) 
VALUES (1, 'control', 'center_1006003', '51101003', 'تكلفة زراعية - مركز 3', 1);
