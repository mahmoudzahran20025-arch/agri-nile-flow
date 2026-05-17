-- Test single item insert to get real error message
INSERT INTO items (code, company_id, name, unit, prod_posting_group_code, inv_posting_group_code, is_active, costing_method)
VALUES (1010002, 1, 'صنف 1010002', 'كجم', 'FERT', 'AG_FERT', 1, 'FIFO');

SELECT code, name, prod_posting_group_code FROM items WHERE company_id=1 LIMIT 5;
