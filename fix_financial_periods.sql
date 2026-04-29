-- ============================================
-- تعديل الفترات المالية لتكون فترة واحدة
-- موسم نواة المستقبل 2025-2026
-- ============================================

-- 1. حذف الفترات الزائدة (id > 1)
DELETE FROM financial_periods WHERE id > 1;

-- 2. تعديل الفترة الأولى لتغطي الموسم كاملاً
UPDATE financial_periods 
SET 
    name = 'الموسم الشتوي 2025-2026',
    start_date = '2025-07-01',
    end_date = '2026-06-30',
    period_type = 'annual',
    status = 'open'
WHERE id = 1;

-- 3. التحقق من التعديل
SELECT * FROM financial_periods;
