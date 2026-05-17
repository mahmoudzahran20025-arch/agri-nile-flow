-- Update/Insert Items
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010004, 'سلفات النشادر محبب', 'كجم', 'شيكارة', 50, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010366, 'سوبر  فوسفات محبب', 'كجم', 'شيكارة', 50, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030002, 'تقاوى بنجر جوستاف', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030260, 'تقاوي بنجر استخيا', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030234, 'تقاوى بنجر فنجينس', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030229, 'تقاوي بنجر تايسون', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030259, 'تقاوي بنجر المو', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030003, 'تقاوى بنجر اسكوتا', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1050197, 'بوش 2" بلاستيك/1"', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1050401, 'بوش 1" * 2/1 " بلاستيك', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1050364, 'نبل 1/2" بلاستيك', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1070010, 'قفيز حرف U كبير', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1070317, 'سيلكون اسود', 'وحدة', 'علبه', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1080035, 'خيط دبارة ( مسلة)', 'كجم', 'كجم', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1090168, 'ماسورة 1" بولي', 'وحدة', 'متر', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1040001, 'سولار', 'لتر', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1070238, 'شريط لحام', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1070786, 'سرفيل 50 نحاس', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1070245, 'اسكوتش', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010095, 'يوريا', 'كجم', 'شيكارة', 50, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010006, 'حمض كبرتيك', 'كجم', 'جركن', 32, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010002, 'حمض فسفوريك', 'كجم', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010189, 'اي جي امينو(احماض امينيه)', 'لتر', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010436, 'فيروكس (منشط جزور)', 'لتر', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1020361, 'مارفل ( معالج ملوحة )', 'لتر', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010074, 'نترات ابوقير', 'كجم', 'شيكارة', 50, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010060, 'ماب', 'كجم', 'شيكارة', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010066, 'حامض نيتريك', 'كجم', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1020362, 'نصر بروكسيد(ماء اكسجين)', 'لتر', 'جركن', 65, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010132, 'نترات كالسيوم محبب صيني', 'كجم', 'شيكارة', 50, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1050095, 'نبل بلاستيك 4/3"', 'وحدة', 'كيس', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1050316, 'محبس 3\4 سن', 'وحدة', 'كيس', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010075, 'بوتاسيوم 0050', 'كجم', 'شيكارة', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030008, 'تقاوى بنجر جنيو', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010374, 'فيرتك 19-19-19', 'كجم', 'شيكارة', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010071, 'هيومك', 'كجم', 'شيكارة', 10, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010062, 'فولفيك', 'كجم', 'شيكارة', 10, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1070844, 'مفتاح كهرباء', 'وحدة', '', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1090043, 'لمبه 9 وات', 'وحدة', '', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030267, 'تقاوي بنجر بي تي اس 7870', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030264, 'تقاوي بنجر ماتروس', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030265, 'تقاوي بنجر Pitt', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030233, 'تقاوى بنجر برسيا', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030266, 'تقاوي بنجر دنزيل', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010438, 'اي جي سي انيتروبي اس', 'لتر', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010439, 'اي جي مالتي ميكس (مكس عناصر)', 'لتر', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010023, 'سلفات ماغنسيوم', 'كجم', 'شيكارة', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1090228, 'صرف قاعده سوسته', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1090230, 'كوع سيفون 4"', 'وحدة', 'عدد', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1020380, 'ريزوسفير 15', 'لتر', 'عدد', 1000, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010437, 'سبلة سير', 'متر', '', 0, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030274, 'تقاوي بنجر بريليف', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1020259, 'خل', 'لتر', 'لتر', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1020288, 'ساليكس', 'كجم', 'كرتونة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1030277, 'تقاوي بنجر امالدي', 'وحدة', 'عبوة', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1050092, 'لفة خرطوم 2"', 'وحدة', '', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1050149, 'قفيز 2" حديد', 'وحدة', '', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1020393, 'هاي كيو', 'لتر', '', 1, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010449, 'اي جي سي بورامين 15%', 'لتر', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1010327, 'سبيد الجاماكس', 'لتر', 'جركن', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
INSERT INTO items (company_id, code, name, unit, package_type, package_capacity, is_active) 
VALUES (1, 1020401, 'لارفا مايورا', 'لتر', '', 25, 1)
ON CONFLICT(code, company_id) DO UPDATE SET 
  name = EXCLUDED.name,
  package_type = EXCLUDED.package_type,
  package_capacity = EXCLUDED.package_capacity;
