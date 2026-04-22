-- ============================================================================
--  SEED MASTER DATA — شركة نواة المستقبل  (company_id = 1)
--  تاريخ الإنشاء: 2026-04-22
--  المصدر: مستخرج مباشرة من ملفات الإكسيل الحقيقية
--    • خزينة نواة المستقبل 2025-2026.xlsx  (شيت الاكواد)
--    • الموردين والعملاء نواة المستقبل2025-2026.xlsx  (شيت الكود)
--    • مخازن نواة المستقبل2025-2026.xlsx  (شيت الكود)
--
--  ما تضيفه / تصلحه هذه السكريبت:
--    ❶ cost_centers   — 15 مركز تكلفة (البيفوتات + الإدارية + المالية)
--    ❷ expense_types  — 75+ كود مصروف
--    ❸ sub_locations  — 2 موقع فرعي
--    ❹ items UPDATE   — تصحيح أسماء الـ61 صنف بالأسماء الصحيحة من الإكسيل
--    ❺ suppliers UPDATE — إضافة النشاط لكل مورد
--    ❻ fields         — 10 حقول (بيفوتات) مع تفاصيل الزراعة
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- ❶  COST CENTERS  —  مراكز التكلفة
--    schema: (code INTEGER PK, company_id INTEGER NOT NULL, name TEXT NOT NULL)
--
--    البيفوتات: أراضي الدلتا الجديدة (مستقبل مصر للتنمية المستدامة)
--      • بوستر 129: قطع 718-723
--      • بوستر 128: قطع 1044-1050
--    + مراكز إدارية ومالية
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO cost_centers (code, company_id, name) VALUES
-- البيفوتات — بوستر 129 (5 قطع)
(1006001, 1, 'بيفوت رقم 718 بوستر129'),
(1006002, 1, 'بيفوت رقم 719 بوستر129'),
(1006003, 1, 'بيفوت رقم 720 بوستر129'),
(1006004, 1, 'بيفوت رقم 722 بوستر129'),
(1006005, 1, 'بيفوت رقم 723 بوستر129'),
-- البيفوتات — بوستر 128 (5 قطع)
(1006006, 1, 'بيفوت رقم 1044 بوستر128'),
(1006007, 1, 'بيفوت رقم 1047 بوستر128'),
(1006008, 1, 'بيفوت رقم 1048 بوستر128'),
(1006009, 1, 'بيفوت رقم 1049 بوستر128'),
(1006010, 1, 'بيفوت رقم 1050 بوستر128'),
-- مركز التكلفة الإداري للمزرعة
(1006011, 1, 'ادارية ارض الدلتا الجديدة'),
-- مراكز مالية (شركاء ورأس مال)
(2104,     1, 'جاري الشركاء'),
(12040201, 1, 'عهد الشركاء'),
(12040202, 1, 'عهد الموظفين'),
(210101,   1, 'رأس المال المدفوع');


-- ─────────────────────────────────────────────────────────────────────────────
-- ❷  EXPENSE TYPES  —  أكواد المصروفات
--    schema: (code INTEGER PK, company_id INTEGER NOT NULL, name TEXT NOT NULL)
--    المصدر: شيت الاكواد، عمود المصروف
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO expense_types (code, company_id, name) VALUES
-- مصروفات إدارية عامة (33xxx)
(33001, 1, 'اجور ومرتبات'),
(33002, 1, 'اتعاب محاسبيه'),
(33003, 1, 'ادوات مكتبيه'),
(33004, 1, 'صيانه مبانى'),
(33005, 1, 'انتقالات'),
(33006, 1, 'مصاريف جاب و شهادات'),
(33007, 1, 'اكراميات'),
(33008, 1, 'مصاريف علاجيه'),
(33009, 1, 'تليفونات'),
(33010, 1, 'كهرباء'),
(33011, 1, 'اشتراكات و معارض'),
(33012, 1, 'مصاريف و مهمات متنوعه'),
(33013, 1, 'مصاريف بنكيه'),
(33014, 1, 'عيديات و مكافات'),
(33015, 1, 'ايجارات'),
(33016, 1, 'صيانه و اصلاح'),
(33017, 1, 'عماله خارجيه عموميه'),
(33018, 1, 'دعايه واعلان'),
(33019, 1, 'بريد ومراسلات'),
(33020, 1, 'بوفيه و ميس وضيافه'),
(33021, 1, 'م ضيافة واقامة عملاء'),
(33022, 1, 'تبرعات وزكاة'),
(33023, 1, 'رسوم و دمغات و غرامات'),
(33024, 1, 'ايجار آلات ومعدات'),
(33025, 1, 'صيانة وسائل نقل'),
(33026, 1, 'ضرائب عقاريه'),
(33027, 1, 'مصاريف دعم الصادرات'),
(33028, 1, 'ترجمه'),
(33029, 1, 'نخل'),
(33030, 1, 'م سياره ملاكى'),
(33031, 1, 'ادوات نظافه'),
(33032, 1, 'ابحاث و تحاليل'),
(33033, 1, 'احبار'),
(33034, 1, 'استشارات'),
(33035, 1, 'مصروف اهلاك'),
(33036, 1, 'ايجار حفار'),
(33037, 1, 'عمولات'),
(33038, 1, 'تسويات فروق جرديه بالعجز او الزياده'),
(33039, 1, 'مصروف مخصص مطالبات محتمله'),
(33040, 1, 'مصروف ضريبه الدخل'),
(33041, 1, 'مصاريف بنكيه تسهيلات'),
(33042, 1, 'فوائد تسهيلات ائتمانيه'),
(33043, 1, 'مصروف تامين'),
(33044, 1, 'مصاريف تقييم'),
(33045, 1, 'اجور عماله اضافيه'),
(33046, 1, 'مصاريف تامينات'),
(33047, 1, 'هدايا'),
(33048, 1, 'المساهمه التكافليه'),
(33049, 1, 'اعاشة'),
(33050, 1, 'شقه التجمع 2'),
(33051, 1, 'الحراسه والامن'),
(33052, 1, 'قطع غيار وصيانة'),
(33053, 1, 'وقود وزيوت'),
(33054, 1, 'رسوم مرور وكرت طريق'),
(33055, 1, 'مياه'),
(33056, 1, 'تحميل وتعتيق'),
(33057, 1, 'م. طريق مندوب'),
(33058, 1, 'م. فيلا رويال'),
(33059, 1, 'قضايا'),
(33060, 1, 'مطبوعات'),
(33061, 1, 'شقة التجمع 1'),
(33062, 1, 'م. جراج'),
(33063, 1, 'صيانة اصول ثابتة'),
(33064, 1, 'صيانة مولدات'),
(33065, 1, 'تراخيص سيارات'),
(33066, 1, 'غاز'),
(33067, 1, 'اشراف زراعي'),
-- مصروفات مخصوصة (34xxx)
(34001, 1, 'م. الحمله الانتخابية'),
(34002, 1, 'اشتراكات'),
(34003, 1, 'مصاريف سفريات و معارض خارجيه'),
(34004, 1, 'خصم مسموح به للعملاء'),
-- مشتريات وتكلفة المبيعات (35xxx)
(35001, 1, 'المشتريات'),
(35006, 1, 'تكلفة المبيعات'),
-- مصروفات زراعية وشحن (36xxx)
(36002, 1, 'م تخليص جمركي'),
(36003, 1, 'مستلزمات تشغيل'),
(36004, 1, 'شحن جوى'),
(36005, 1, 'شحن بحرى'),
(36006, 1, 'تخليص جمركى صادر'),
(36007, 1, 'اكراميه'),
(36008, 1, 'نقل ( نولون )'),
(36009, 1, 'بريد و مراسلات'),
(36010, 1, 'مصروفات شحن اخرى'),
(36011, 1, 'مصروفات فحص'),
(36012, 1, 'مصاريف نقل بالخارج'),
(36013, 1, 'رويالتى'),
(36014, 1, 'عمالة زراعية'),
(36015, 1, 'صيانة بيفوتات'),
(36016, 1, 'م. نبطشية'),
(36017, 1, 'تحليلي متبقيات'),
(36018, 1, 'مشروع العفن البني'),
(36019, 1, 'سحب عينات'),
(36020, 1, 'قسيمة بدل');


-- ─────────────────────────────────────────────────────────────────────────────
-- ❸  SUB LOCATIONS  —  المواقع الفرعية
--    schema: (code INTEGER PK, company_id INTEGER NOT NULL, name TEXT NOT NULL)
--    المصدر: عمود SUB في شيت الاكواد (خزينة)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO sub_locations (code, company_id, name) VALUES
(1001, 1, 'جهاز مستقبل مصر للتنمية المستدامة'),
(1002, 1, 'طايل مشحوت احمد عرفة');


-- ─────────────────────────────────────────────────────────────────────────────
-- ❹  ITEMS — تصحيح الأسماء بالأسماء الحقيقية من الإكسيل
--    الأسماء السابقة كانت مبنية على تخمين — هذه هي الأسماء الفعلية
--    المصدر: شيت الكود، مخازن نواة المستقبل2025-2026.xlsx
-- ─────────────────────────────────────────────────────────────────────────────

-- أسمدة — تصحيح الأسماء والوحدات
UPDATE items SET name = 'حمض فسفوريك',             unit = 'كجم' WHERE code = 1010002 AND company_id = 1;
UPDATE items SET name = 'سلفات النشادر محبب',       unit = 'كجم' WHERE code = 1010004 AND company_id = 1;
UPDATE items SET name = 'حمض كبرتيك',              unit = 'كجم' WHERE code = 1010006 AND company_id = 1;
UPDATE items SET name = 'سلفات ماغنسيوم',           unit = 'كجم' WHERE code = 1010023 AND company_id = 1;
UPDATE items SET name = 'ماب',                      unit = 'كجم' WHERE code = 1010060 AND company_id = 1;
UPDATE items SET name = 'فولفيك',                   unit = 'كجم' WHERE code = 1010062 AND company_id = 1;
UPDATE items SET name = 'حامض نيتريك',              unit = 'كجم' WHERE code = 1010066 AND company_id = 1;
UPDATE items SET name = 'هيومك',                    unit = 'كجم' WHERE code = 1010071 AND company_id = 1;
UPDATE items SET name = 'نترات ابوقير',             unit = 'كجم' WHERE code = 1010074 AND company_id = 1;
UPDATE items SET name = 'بوتاسيوم 0050',            unit = 'كجم' WHERE code = 1010075 AND company_id = 1;
UPDATE items SET name = 'يوريا',                    unit = 'كجم' WHERE code = 1010095 AND company_id = 1;
UPDATE items SET name = 'نترات كالسيوم محبب صيني',  unit = 'كجم' WHERE code = 1010132 AND company_id = 1;
UPDATE items SET name = 'اى جى امينو (احماض امينوه)', unit = 'لتر' WHERE code = 1010189 AND company_id = 1;
UPDATE items SET name = 'سبيد الجاماكس',           unit = 'لتر' WHERE code = 1010327 AND company_id = 1;
UPDATE items SET name = 'سوبر  فوسفات محبب',        unit = 'كجم' WHERE code = 1010366 AND company_id = 1;
UPDATE items SET name = 'فيرتك 19-19-19',           unit = 'كجم' WHERE code = 1010374 AND company_id = 1;
UPDATE items SET name = 'فيروكس (منشط جذور)',       unit = 'لتر' WHERE code = 1010436 AND company_id = 1;
UPDATE items SET name = 'سبلة سير',                 unit = 'متر' WHERE code = 1010437 AND company_id = 1;
UPDATE items SET name = 'اى جى سى انيتروبى اس',    unit = 'لتر' WHERE code = 1010438 AND company_id = 1;
UPDATE items SET name = 'اى جى مالتى ميكس (مكس عناصر)', unit = 'لتر' WHERE code = 1010439 AND company_id = 1;
UPDATE items SET name = 'اى جى سى بورامين 15%',    unit = 'لتر' WHERE code = 1010449 AND company_id = 1;

-- مبيدات — تصحيح الأسماء
UPDATE items SET name = 'خل',                       unit = 'لتر' WHERE code = 1020259 AND company_id = 1;
UPDATE items SET name = 'ساليكس',                   unit = 'كجم' WHERE code = 1020288 AND company_id = 1;
UPDATE items SET name = 'مارفل ( معالج ملوحة )',    unit = 'لتر' WHERE code = 1020361 AND company_id = 1;
UPDATE items SET name = 'نصر بروكسيد(ماء اكسجين)', unit = 'لتر' WHERE code = 1020362 AND company_id = 1;
UPDATE items SET name = 'ريزوفير 15',               unit = 'لتر' WHERE code = 1020380 AND company_id = 1;
UPDATE items SET name = 'هاى كيو',                  unit = 'لتر' WHERE code = 1020393 AND company_id = 1;
UPDATE items SET name = 'لارفا مايورا',             unit = 'لتر' WHERE code = 1020401 AND company_id = 1;

-- تقاوي وبذور — تصحيح الأسماء
UPDATE items SET name = 'تقاوى بنجر جوستاف',       unit = 'وحدة' WHERE code = 1030002 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر اسكوتا',       unit = 'وحدة' WHERE code = 1030003 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر جينيو',         unit = 'وحدة' WHERE code = 1030008 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر تايسون',        unit = 'وحدة' WHERE code = 1030229 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر برسيا',         unit = 'وحدة' WHERE code = 1030233 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر فنجينس',        unit = 'وحدة' WHERE code = 1030234 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر الهو',          unit = 'وحدة' WHERE code = 1030259 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر استخيا',        unit = 'وحدة' WHERE code = 1030260 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر ماتروس',        unit = 'وحدة' WHERE code = 1030264 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر Pitt',          unit = 'وحدة' WHERE code = 1030265 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر دنزيل',         unit = 'وحدة' WHERE code = 1030266 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر بى تى اس 7870', unit = 'وحدة' WHERE code = 1030267 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر بريليف',        unit = 'وحدة' WHERE code = 1030274 AND company_id = 1;
UPDATE items SET name = 'تقاوى بنجر امالدى',        unit = 'وحدة' WHERE code = 1030277 AND company_id = 1;

-- وقود — تصحيح
UPDATE items SET name = 'سولار',                    unit = 'لتر' WHERE code = 1040001 AND company_id = 1;

-- شبكات ري — تصحيح الأسماء
UPDATE items SET name = 'لفة خرطوم 2"',            unit = 'وحدة' WHERE code = 1050092 AND company_id = 1;
UPDATE items SET name = 'نبل بلاستيك 4/3"',        unit = 'وحدة' WHERE code = 1050095 AND company_id = 1;
UPDATE items SET name = 'قفيز 2" حديد',             unit = 'وحدة' WHERE code = 1050149 AND company_id = 1;
UPDATE items SET name = 'بوش 2" بلاستيك/1"',        unit = 'وحدة' WHERE code = 1050197 AND company_id = 1;
UPDATE items SET name = 'محبس 3\4 سن',              unit = 'وحدة' WHERE code = 1050316 AND company_id = 1;
UPDATE items SET name = 'نبل 1/2" بلاستيك',         unit = 'وحدة' WHERE code = 1050364 AND company_id = 1;
UPDATE items SET name = 'بوش 1" * 2/1 " بلاستيك',   unit = 'وحدة' WHERE code = 1050401 AND company_id = 1;

-- قطع غيار — تصحيح الأسماء
UPDATE items SET name = 'قفيز حرف U كبير',          unit = 'وحدة' WHERE code = 1070010 AND company_id = 1;
UPDATE items SET name = 'شريط لحام',                unit = 'وحدة' WHERE code = 1070238 AND company_id = 1;
UPDATE items SET name = 'اسكوتش',                   unit = 'وحدة' WHERE code = 1070245 AND company_id = 1;
UPDATE items SET name = 'سيلكون اسود',              unit = 'وحدة' WHERE code = 1070317 AND company_id = 1;
UPDATE items SET name = 'سرفيل 50 نحاس',            unit = 'وحدة' WHERE code = 1070786 AND company_id = 1;
UPDATE items SET name = 'مفتاح كهرباء',             unit = 'وحدة' WHERE code = 1070844 AND company_id = 1;

-- تعبئة وتغليف — تصحيح
UPDATE items SET name = 'خيط دبارة ( مسلة)',         unit = 'كجم' WHERE code = 1080035 AND company_id = 1;

-- متنوعات — تصحيح الأسماء
UPDATE items SET name = 'لمبه 9 وات',               unit = 'وحدة' WHERE code = 1090043 AND company_id = 1;
UPDATE items SET name = 'ماسورة 1" بولي',           unit = 'وحدة' WHERE code = 1090168 AND company_id = 1;
UPDATE items SET name = 'صرف قاعده سوسته',          unit = 'وحدة' WHERE code = 1090228 AND company_id = 1;
UPDATE items SET name = 'كوع سيفون 4"',              unit = 'وحدة' WHERE code = 1090230 AND company_id = 1;

-- إضافة صنف 1010001 (سبلة امهات — متر) غير موجود في seed_data.sql الأصلي
INSERT OR IGNORE INTO items (code, company_id, name, unit, warehouse, reorder_threshold, is_active)
VALUES (1010001, 1, 'سبلة امهات', 'متر', 'اسمدة', 50, 1);


-- ─────────────────────────────────────────────────────────────────────────────
-- ❺  SUPPLIERS — تحديث حقل النشاط بالأسماء الحقيقية من الإكسيل
--    schema: suppliers (code PK, company_id PK, name, activity, notes, is_active, created_at)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE suppliers SET activity = 'موردين ألات ومعدات'     WHERE code = 20300086 AND company_id = 1;
UPDATE suppliers SET activity = 'موردين منتجات زراعية'    WHERE code = 20900151 AND company_id = 1;
UPDATE suppliers SET activity = 'موردين منتجات زراعية'    WHERE code = 20900353 AND company_id = 1;
UPDATE suppliers SET activity = 'موردين عمالة'            WHERE code = 21400002 AND company_id = 1;
UPDATE suppliers SET activity = 'موردين ألات ومعدات'     WHERE code = 20100033 AND company_id = 1;
UPDATE suppliers SET activity = 'موردين عمالة'            WHERE code = 21400108 AND company_id = 1;
UPDATE suppliers SET activity = 'موردين متنوعات'          WHERE code = 20800286 AND company_id = 1;
UPDATE suppliers SET activity = 'عملاء محليون'            WHERE code = 10100192 AND company_id = 1;
UPDATE suppliers SET activity = 'موردين ألات ومعدات'     WHERE code = 20300121 AND company_id = 1;
UPDATE suppliers SET activity = 'موردين متنوعات'          WHERE code = 35300902 AND company_id = 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- ❻  FIELDS — قطع الأرض / البيفوتات
--    schema: (id PK, company_id, season_id, code TEXT, name, area_feddan,
--             location, crop_type, soil_type, irrigation_type, landlord_name, ...)
--    season_id = 1 (الموسم الشتوي 2025-2026)
--    المحصول الرئيسي: بنجر السكر (sugar_beet) — حسب تقاوي البنجر في المستودع
--    نوع الري: pivot (ري بالبيفوت)
--    الأراضي: ضمن عقد جهاز مستقبل مصر للتنمية المستدامة
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO fields
  (company_id, season_id, code, name, area_feddan, location, crop_type, soil_type, irrigation_type, landlord_name)
VALUES
-- بوستر 129
(1, 1, '1006001', 'بيفوت رقم 718 بوستر129',  55.0,
 'أراضي الدلتا الجديدة - بوستر 129', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
(1, 1, '1006002', 'بيفوت رقم 719 بوستر129',  55.0,
 'أراضي الدلتا الجديدة - بوستر 129', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
(1, 1, '1006003', 'بيفوت رقم 720 بوستر129',  55.0,
 'أراضي الدلتا الجديدة - بوستر 129', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
(1, 1, '1006004', 'بيفوت رقم 722 بوستر129',  55.0,
 'أراضي الدلتا الجديدة - بوستر 129', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
(1, 1, '1006005', 'بيفوت رقم 723 بوستر129',  55.0,
 'أراضي الدلتا الجديدة - بوستر 129', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
-- بوستر 128
(1, 1, '1006006', 'بيفوت رقم 1044 بوستر128', 55.0,
 'أراضي الدلتا الجديدة - بوستر 128', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
(1, 1, '1006007', 'بيفوت رقم 1047 بوستر128', 55.0,
 'أراضي الدلتا الجديدة - بوستر 128', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
(1, 1, '1006008', 'بيفوت رقم 1048 بوستر128', 55.0,
 'أراضي الدلتا الجديدة - بوستر 128', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
(1, 1, '1006009', 'بيفوت رقم 1049 بوستر128', 55.0,
 'أراضي الدلتا الجديدة - بوستر 128', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة'),
(1, 1, '1006010', 'بيفوت رقم 1050 بوستر128', 55.0,
 'أراضي الدلتا الجديدة - بوستر 128', 'بنجر السكر', 'رملي طيني', 'pivot',
 'جهاز مستقبل مصر للتنمية المستدامة');
