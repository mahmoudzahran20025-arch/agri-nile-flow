-- Direct INSERT for SRV_ADMIN — service_group must be one of the allowed enum values
-- ADMINISTRATION is not allowed; using OTHER which is the correct catch-all
INSERT INTO service_types
  (company_id, code, name_ar, name_en, service_group,
   default_expense_account_code, default_ap_account_code,
   requires_supplier, requires_document, requires_center, is_active,
   bus_posting_group_code)
VALUES
  (1, 'SRV_ADMIN', 'خدمات إدارية وتشغيلية', 'Administrative / Operational Services',
   'OTHER', '51200034', '212000013', 1, 0, 0, 1, 'BPG_ADMIN');

SELECT code, name_ar, service_group, default_expense_account_code, default_ap_account_code, bus_posting_group_code
FROM service_types WHERE company_id=1 ORDER BY code;
