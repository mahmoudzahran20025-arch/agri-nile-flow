-- Add missing cost center 1006011
INSERT INTO cost_centers (company_id, code, name_ar, cost_center_type, is_active, created_at) 
VALUES (1, '1006011', 'مركز 11 - إشراف وتنسيق', 'DIRECT', 1, datetime('now'));
