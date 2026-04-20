# دليل تطوير Agri-Nile Flow (النظام الموحد) 🌾

هذا المستند هو المرجع الأساسي لإدارة وتطوير المشروع باستخدام نظام **Remote-First**.

---

## 🛠️ نظام التطوير اليومي (Workflow)

لضمان أعلى استقرار وأسرع أداء، اتبع هذه الخطوات بالترتيب:

1.  **تعديل الباك إند:** عدل في ملفات `src`.
2.  **رفع الكود (Deploy):** شغل الأمر التالي لرفع التعديلات:
    ```bash
    wrangler deploy
    ```
3.  **تشغيل الواجهات:** شغل الفرونت إند محلياً:
    ```bash
    npm run dev:web
    ```
    *الآن الـ Localhost يكلم الـ API الحقيقي المرفوع فوراً.*

---

## 🗄️ التعامل مع قاعدة البيانات (D1 Remote)

يتم التعامل مع البيانات دائماً على Cloudflare لضمان دقة النتائج.

### 1. الاستعلامات الشائعة (SQL Commands)
استخدم هذه الأوامر في الـ Terminal للمتابعة السريعة:

*   **عرض جميع المستخدمين:**
    ```bash
    wrangler d1 execute agri-nile-flow-data-lake --remote --command="SELECT id, email, full_name FROM users;"
    ```
*   **عرض الشركات المسجلة:**
    ```bash
    wrangler d1 execute agri-nile-flow-data-lake --remote --command="SELECT * FROM companies;"
    ```
*   **التأكد من الأذونات (Permissions):**
    ```bash
    wrangler d1 execute agri-nile-flow-data-lake --remote --command="SELECT * FROM roles;"
    ```
*   **تصفير وإعادة بناء قاعدة البيانات (تحذير: يمسح البيانات):**
    ```bash
    npm run db:init
    ```

---

## 🧪 اختبار الـ Endpoints (Testing)

أفضل وأسهل الطرق لاختبار الباك إند بعد كل `deploy`:

### 1. الاختبار السريع باستخدام `curl`
مثال لاختبار نقطة التحقق من الـ API:
```bash
curl https://agri-nile-flow.zahranmalk2.workers.dev/api/auth/me
```

### 2. الاختبار من المتصفح (للواجهات)
بما أننا ربطنا الـ Proxy في `vite.config.ts` بالرابط الأونلاين، يمكنك ببساطة:
1.  فتح `http://localhost:3000`.
2.  فتح الـ **Inspect Element (F12)** ثم تبويب **Network**.
3.  أي طلب API يظهر أمامك يمكنك الضغط عليه (Right Click) واختيار **"Copy as fetch"** أو **"Copy as curl"** لإعادة اختباره وتعديله.

### 3. نصيحة للمصادقة (Auth Testing)
بما أن النظام يستخدم JWT، ستحتاج لإرسال التوكين في الـ Header. أسهل طريقة هي تسجيل الدخول من الموقع مرة واحدة، ثم نسخ التوكين من الـ `localStorage` واستخدامه في الاختبارات الخارجية.

---

## 🚀 قواعد ذهبية
1.  **Deploy First:** لا تحاول تجربة كود جديد في الفرونت إند قبل أن تتأكد أنك رفعت نسخة الباك إند المتوافقة معه.
2.  **Check Logs:** لو حدث خطأ 500، استخدم أمر متابعة السجلات مباشرة:
    ```bash
    wrangler tail
    ```
    *هذا الأمر يعرض لك الأخطاء اللي بتحصل في السيرفر الآن (Real-time logs).*
3.  **No Local DB:** لا تحاول أبداً تشغيل `wrangler dev` بدون `--remote` لأنها ستنشئ قاعدة بيانات فارغة ومختلفة عن الحقيقية.

---

## 📝 ملاحظات تقنية:
*   رابط الباك إند المعتمد: `https://agri-nile-flow.zahranmalk2.workers.dev`
*   تعديلات الـ Proxy تتم في ملف `web/vite.config.ts`.
