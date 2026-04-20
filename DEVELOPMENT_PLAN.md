# دليل تطوير Agri-Nile Flow (النظام المتكامل) 🌾

هذا المستند يوثق البنية النهائية للمشروع وخطوات التطوير بعد الفصل بين الفرونت إند والباك إند.

---

## 🏗️ البنية التحتية الحالية (Architecture)

تم تقسيم المشروع إلى جزئين مستقلين لضمان أفضل أداء وCI/CD:

1.  **الفرونت إند (Cloudflare Pages):**
    *   **الرابط:** `https://agri-nile-flow-lake.pages.dev`
    *   **طريقة التحديث:** يتم البناء والرفع تلقائياً عند عمل `git push`.
2.  **الباك إند (Cloudflare Worker):**
    *   **الرابط:** `https://agri-nile-flow.mahm-zahran22.workers.dev`
    *   **القاعدة المرتبطة:** `agri-nile-flow-data-lake` (D1).

---

## 🛠️ دليل التطوير اليومي

### 1. العمل المحلي (Local Dev)
*   شغل الفرونت إند: `npm run dev:web` (يتصل بالـ API الأونلاين).
*   تعديل الباك إند: عدل في `src` ثم ارفع بـ `wrangler deploy`.

### 2. التحديث العام (Deployment)
*   بمجرد تنفيذ `git add .` و `git commit` و `git push`.. سيقوم Cloudflare بتحديث الفرونت إند أوتوماتيكياً.

---

## 🗄️ إدارة قاعدة البيانات (D1)

اسم قاعدة البيانات الحالي: **`agri-nile-flow-data-lake`**

*   **تحديث الجداول:** `npm run db:init`
*   **استعلام سريع عن المستخدمين:**
    ```bash
    wrangler d1 execute agri-nile-flow-data-lake --remote --command="SELECT * FROM users;"
    ```

---

## ✅ تقرير التقدم (Progress Report)

| المهمة | الحالة | الملاحظات |
| :--- | :---: | :--- |
| إعداد البيئة المحلية | ✅ | تم ربط الـ Proxy وتظبط الـ Scripts |
| إنشاء قاعدة البيانات D1 | ✅ | الاسم الجديد: agri-nile-flow-data-lake |
| تفعيل الـ CI/CD للفرونت إند | ✅ | مربوط بـ Cloudflare Pages |
| تفعيل الـ CI/CD للباك إند | ✅ | مربوط بـ Cloudflare Workers |
| إعداد الـ CORS والـ Auth | ✅ | الباك إند يقبل طلبات من الـ Pages |
| إنشاء مستخدم Admin أول | ✅ | البريد: admin@nawa.eg |

---

## 🚀 الخطوات القادمة
- [ ] إضافة موديول إدارة الموردين (Suppliers).
- [ ] إعداد التقارير المالية (Financial Reports).
- [ ] ضبط أذونات الوصول المتقدمة (RBAC).

---

## 📝 ملاحظات تقنية:
*   رابط الـ API في الكود يتم تبديله تلقائياً بناءً على البيئة (Local vs Production).
*   المفتاح السري للـ JWT تم ضبطه وتأمينه في الـ `wrangler.toml`.
