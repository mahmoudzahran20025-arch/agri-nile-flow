-- Update existing mapping columns from Excel data
-- شجرة نواة المستقبل (1).xlsx columns: mapping[0], mapping_detailed[1], code[2], name[3]

-- Clear existing
UPDATE chart_of_accounts SET mapping = NULL, mapping_detailed = NULL WHERE company_id = 1;

-- الأصول الثابتة
UPDATE chart_of_accounts SET mapping = 'الأصول الثابتة', mapping_detailed = 'الأصول الثابتة' 
WHERE code IN ('11010001','11020001','11030001','11040001','11050001','11060001','11070001','11080001','11090001','11100001','13010001','13020001','13050001','22010001','22020001') AND company_id = 1;

-- النقدية ومافي حكمها
UPDATE chart_of_accounts SET mapping = 'النقدية ومافي حكمها', mapping_detailed = 'النقدية ومافي حكمها'
WHERE code LIKE '1401%' OR code LIKE '140102%' OR code LIKE '140103%' OR code LIKE '140104%' OR code LIKE '140105%' OR code LIKE '140106%' AND company_id = 1;

-- المخزون
UPDATE chart_of_accounts SET mapping = 'المخزون', mapping_detailed = 'المخزون'
WHERE code LIKE '1402%' AND company_id = 1;

-- المدينون والارصدة المدينة الاخري
UPDATE chart_of_accounts SET mapping = 'المدينون والارصدة المدينة الاخري', mapping_detailed = 'المدينون والارصدة المدينة الاخري'
WHERE code LIKE '21%' AND company_id = 1;

-- الموردين
UPDATE chart_of_accounts SET mapping = 'الموردين', mapping_detailed = 'الموردين'
WHERE code LIKE '22%' AND company_id = 1;

-- العملاء
UPDATE chart_of_accounts SET mapping = 'عملاء', mapping_detailed = 'عملاء'
WHERE code LIKE '1105%' AND company_id = 1;

-- الالتزامات المتداولة
UPDATE chart_of_accounts SET mapping = 'الالتزامات المتداولة', mapping_detailed = 'الالتزامات المتداولة'
WHERE code LIKE '23%' AND company_id = 1;

-- حقوق الملكية
UPDATE chart_of_accounts SET mapping = 'حقوق الملكية', mapping_detailed = 'حقوق الملكية'
WHERE code LIKE '25%' AND company_id = 1;

-- اطراف ذوي علاقة مدين
UPDATE chart_of_accounts SET mapping = 'اطراف ذوي علاقة مدين', mapping_detailed = 'اطراف ذوي علاقة مدين'
WHERE code LIKE '1104%' AND company_id = 1;

-- جاري المساهمين
UPDATE chart_of_accounts SET mapping = 'جاري المساهمين', mapping_detailed = 'جاري المساهمين'
WHERE code LIKE '1201%' AND company_id = 1;

-- اوراق القبض
UPDATE chart_of_accounts SET mapping = 'اوراق القبض', mapping_detailed = 'اوراق القبض'
WHERE code LIKE '1103%' AND company_id = 1;

-- حسابات المصاريف (51xxxxx)
UPDATE chart_of_accounts SET mapping = 'مصاريف', mapping_detailed = 'مصاريف تشغيلية'
WHERE code LIKE '51%' AND company_id = 1;

-- حسابات الإيرادات (42xxxxx)
UPDATE chart_of_accounts SET mapping = 'إيرادات', mapping_detailed = 'إيرادات تشغيلية'
WHERE code LIKE '42%' AND company_id = 1;

-- التكاليف (61xxxxx)
UPDATE chart_of_accounts SET mapping = 'تكاليف', mapping_detailed = 'تكاليف صناعية'
WHERE code LIKE '61%' AND company_id = 1;

-- Verify
SELECT mapping, COUNT(*) as count FROM chart_of_accounts WHERE company_id = 1 AND mapping IS NOT NULL GROUP BY mapping ORDER BY count DESC;
