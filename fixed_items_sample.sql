-- Sample items import (first 50 items only for testing)
-- items table schema: code, company_id, name, unit, warehouse, is_active, prod_posting_group_code

INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES (1010004, 1, 'سلفات النشادر محبب', 'كجم', 'اسمدة', 1, 'FERT', datetime('now'));
INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES (1010366, 1, 'سوبر فوسفات محبب', 'كجم', 'اسمدة', 1, 'FERT', datetime('now'));
INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES (1030002, 1, 'تقاوى بنجر جوستاف', 'وحدة', 'تقاوي وبذور', 1, 'SEED', datetime('now'));
INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES (1050197, 1, 'بوش 2" بلاستيك/1"', 'وحدة', 'شبكات ري', 1, 'EQUIP', datetime('now'));
INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES (1040001, 1, 'سولار', 'لتر', 'زيوت ووقود', 1, 'FERT', datetime('now'));
INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES (1070010, 1, 'قفيز حرف U كبير', 'وحدة', 'قطع غيار', 1, 'EQUIP', datetime('now'));
INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES (1080035, 1, 'خيط دبارة (مسلة)', 'كجم', 'تعبئة وتغليف', 1, 'FERT', datetime('now'));
INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES (1090168, 1, 'ماسورة 1" بولي', 'وحدة', 'متنوعات', 1, 'FERT', datetime('now'));
