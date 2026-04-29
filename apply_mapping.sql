-- Apply Mapping to chart_of_accounts (using posting_group_id)
-- Mapping extracted from Excel: شجرة نواة المستقبل (1).xlsx

-- الأصول الثابتة
UPDATE chart_of_accounts SET posting_group_id = 1 WHERE code IN ('11010001','11020001','11030001','11040001','11050001','11060001','11070001','11080001','11090001','11100001','13010001','13020001','13050001') AND company_id = 1;

-- النقدية ومافي حكمها
UPDATE chart_of_accounts SET posting_group_id = 2 WHERE code IN ('14010101','14010150','14010180','14010201','14010301','14010302','14010303','14010304','14010401','14010501') AND company_id = 1;

-- المخزون
UPDATE chart_of_accounts SET posting_group_id = 3 WHERE code LIKE '1402%' AND company_id = 1;

-- المدينون
UPDATE chart_of_accounts SET posting_group_id = 4 WHERE code LIKE '21%' AND company_id = 1;

-- الموردين
UPDATE chart_of_accounts SET posting_group_id = 5 WHERE code LIKE '22%' AND company_id = 1;

-- العملاء
UPDATE chart_of_accounts SET posting_group_id = 6 WHERE code LIKE '1105%' AND company_id = 1;

-- الالتزامات المتداولة
UPDATE chart_of_accounts SET posting_group_id = 7 WHERE code LIKE '23%' AND company_id = 1;

-- حقوق الملكية
UPDATE chart_of_accounts SET posting_group_id = 8 WHERE code LIKE '25%' AND company_id = 1;

-- اطراف ذوي علاقة مدين
UPDATE chart_of_accounts SET posting_group_id = 9 WHERE code LIKE '1104%' AND company_id = 1;

-- جاري المساهمين
UPDATE chart_of_accounts SET posting_group_id = 10 WHERE code LIKE '1201%' AND company_id = 1;

-- اوراق القبض
UPDATE chart_of_accounts SET posting_group_id = 11 WHERE code LIKE '1103%' AND company_id = 1;

-- حسابات المصاريف (51xxxxx)
UPDATE chart_of_accounts SET posting_group_id = 12 WHERE code LIKE '51%' AND company_id = 1;

-- حسابات الإيرادات (42xxxxx)
UPDATE chart_of_accounts SET posting_group_id = 13 WHERE code LIKE '42%' AND company_id = 1;

-- التكاليف (61xxxxx)
UPDATE chart_of_accounts SET posting_group_id = 14 WHERE code LIKE '61%' AND company_id = 1;

-- Select to verify
SELECT 
  posting_group_id,
  COUNT(*) as account_count
FROM chart_of_accounts 
WHERE company_id = 1 AND posting_group_id IS NOT NULL
GROUP BY posting_group_id
ORDER BY posting_group_id;
