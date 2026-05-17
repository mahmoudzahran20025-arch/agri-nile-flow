# Clean Reseed Decision Report (2026-05-09)

## الهدف
تحديد قرار عملي قبل الإنتاج:
1. ما الذي نحتفظ به من القاعدة الحالية.
2. ما الذي يجب إعادة بنائه من المصدر.
3. خطة clean reseed بدون legacy أو test data.

## 1) ما الذي نحتفظ به من القاعدة الحالية

نحتفظ بالطبقة البنيوية والحوكمة، وليس بالبيانات التشغيلية القديمة:

- بنية الجداول والمفاتيح والقيود والمشغلات المضافة عبر المايجريشنات.
- حوكمة COA الحالية (audit view + قواعد منع posting غير صالح + deploy gate).
- منطق النشر الحتمي في الكود (deterministic posting + fail-fast).
- مصفوفة العمليات وقواعد الربط الرسمية بعد الإصلاحات.
- أي إعدادات نظام ثابتة لا تعتمد على تاريخ معاملات قديم.

ملاحظة:
- لا نحتفظ بأي test residue أو بيانات legacy تشغيلية عند تنفيذ reseed.

## 2) ما الذي يجب إعادة بنائه من المصدر

يعاد البناء من مصادر JSON الرسمية فقط (بعد تحويل Canonical):

- شجرة الحسابات من [شجرة_نواة_المستقبل.json](c:/Users/mahmo/Contacts/CLAUDE_CO%20WORK%20MY%20WORK/agri-nile-flow/شجرة_نواة_المستقبل.json).
- بيانات الموردين والعملاء من [نواة_المستقبل_2025-2026.json](c:/Users/mahmo/Contacts/CLAUDE_CO%20WORK%20MY%20WORK/agri-nile-flow/نواة_المستقبل_2025-2026.json).
- بيانات الخزينة من [خزينة_نواة_المستقبل_2025-2026.json](c:/Users/mahmo/Contacts/CLAUDE_CO%20WORK%20MY%20WORK/agri-nile-flow/خزينة_نواة_المستقبل_2025-2026.json).
- بيانات المخازن من [مخازن_نواة_المستقبل_2025-2026.json](c:/Users/mahmo/Contacts/CLAUDE_CO%20WORK%20MY%20WORK/agri-nile-flow/مخازن_نواة_المستقبل_2025-2026.json).

يعاد البناء كذلك من قواعد الأعمال المعتمدة:

- posting_rules من Mapping Matrix الرسمية (وليس نسخًا عشوائيًا من DB).
- control accounts والـ intent classification بشكل حتمي.
- opening balances فقط إذا كانت معتمدة رسميًا ومراجعة.

لا يعاد ترحيل ما يلي:

- journal_entries القديمة.
- journal_entry_lines القديمة.
- supplier_transactions legacy.
- inventory_movements legacy.
- cash_transactions legacy.
- أي سجلات test مثل [TEST_UNPOSTED].

## 3) خطة Clean Reseed بدون Legacy/Test Data

### المرحلة A: Freeze + Backup (إجباري)

- أخذ snapshot كامل قبل أي حذف.
- تصدير schema + metadata + counts للرجوع عند الطوارئ.
- توثيق timestamp وbookmark قبل التنفيذ.

### المرحلة B: Canonical Transformation

- تحويل كل JSON إلى canonical staging schema موحد.
- توحيد أنواع الحقول (code/date/amount/enum).
- إزالة التكرارات، ومعالجة nulls، وتوحيد parent-child relationships.
- إخراج artifact نهائي واحد لكل domain (COA, suppliers, treasury, inventory).

### المرحلة C: Hard Clean (Transactional Wipe)

- حذف جميع جداول المعاملات فقط.
- الإبقاء على الجداول البنيوية والإعدادات الحاكمة.
- التأكد أن عدد سجلات test والـ legacy المعاملات = 0.

### المرحلة D: Deterministic Seed

- إدخال COA من canonical COA فقط.
- إدخال master data (suppliers/items/warehouses/cost centers/banks).
- إدخال posting_rules من matrix المعتمدة فقط.
- إدخال opening balances المعتمدة فقط (إن وجدت).

### المرحلة E: Integrity + Governance Gates

- تشغيل verify:coa-governance ويجب أن تكون critical = 0.
- تشغيل تدقيق العلاقات المرجعية ويجب أن تكون broken links = 0.
- التأكد من عدم وجود posted_to_header.
- التأكد من عدم وجود orphan_rules أو parent_missing.
- التأكد أن test/legacy transactional residue = 0.

### المرحلة F: Pre-Production Sign-off

- نشر تجريبي بنفس مسار النشر الرسمي مع gate.
- اعتماد تقرير القبول النهائي.
- تثبيت النسخة كـ pre-production baseline.

## معايير القبول (Go / No-Go)

Go فقط إذا تحققت كل الشروط:

- جميع critical COA metrics = 0.
- جميع broken journal references = 0.
- orphan journal lines = 0.
- test entries = 0.
- لا يوجد legacy transactional rows في نطاق reseed.
- posting matrix coverage مكتملة للأحداث المطلوبة.

أي شرط غير محقق = No-Go.

## القرار التنفيذي

- نحتفظ بالهيكل والحوكمة والمنطق الحتمي الحالي.
- نعيد بناء البيانات التشغيلية من المصادر الرسمية عبر Canonical Transformation.
- ننفذ Clean Reseed على المعاملات بدون legacy/test data.

هذا المسار يعطي قاعدة نظيفة وقابلة للحكم قبل الإنتاج بدون التضحية بإصلاحات الحوكمة التي تم إنجازها.

## تحديث تحقق التاريخ (2026-05-09)

تم التحقق المباشر من قاعدة البيانات الحية للتأكد من نقطة البداية الزمنية للفترة المالية:

- الفترة المالية المفتوحة الحالية تبدأ من 2025-11-01 وتنتهي 2027-12-31.
- أقدم تاريخ فعلي في البيانات التشغيلية = 2025-11-06 (خزينة وقيود يومية).
- أقدم تاريخ موردين = 2025-11-12.
- أقدم تاريخ مخزون = 2025-11-24.

الاستنتاج:
- لا توجد مشكلة أن الفترة تبدأ في 2026؛ البداية الفعلية بالفعل في 2025 ومتوافقة مع نطاق البيانات المصدر.
