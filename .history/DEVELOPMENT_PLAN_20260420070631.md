# دليل تطوير Agri-Nile Flow (النظام المتكامل) 🌾

هذا المستند يوثق البنية النهائية للمشروع وخطوات التطوير بعد الفصل بين الفرونت إند والباك إند.

---

## 🏗️ البنية التحتية الحالية (Architecture)

تم تقسيم المشروع إلى جزئين مستقلين لضمان أفضل أداء وCI/CD:

1.  **الفرونت إند (Cloudflare Pages):**
    *   **الرابط:** `https://agri-nile-flow-lake.pages.dev`
    *   **Deploy يدوي:** `cd web && npx wrangler pages deploy dist --project-name agri-nile-flow-lake`
    *   **Build:** `cd web && npm run build`
2.  **الباك إند (Cloudflare Worker):**
    *   **الرابط:** `https://agri-nile-flow.mahm-zahran22.workers.dev`
    *   **القاعدة المرتبطة:** `agri-nile-flow-data-lake` (D1)
    *   **Deploy:** `npx wrangler deploy`

---

## 🔑 بيانات الدخول (Admin)

| الحقل | القيمة |
| :--- | :--- |
| البريد | `admin@nawa.eg` |
| الرقم السري | `Admin@2025` |
| الشركة | نواة المستقبل (NM-001) |
| الدور | `super_admin` |

---

## ☁️ موارد Cloudflare

| المورد | الاسم | المعرف |
| :--- | :--- | :--- |
| Worker | `agri-nile-flow` | — |
| D1 Database | `agri-nile-flow-data-lake` | `2dd5cfe6-b694-46bd-9cb8-adf1bc7c27af` |
| Pages Project | `agri-nile-flow-lake` | — |
| Account ID | — | `8101db8ecafb1db6e0e0581acc665778` |

---

## 🛠️ دليل التطوير اليومي

### 1. العمل المحلي (Local Dev)
```bash
# Frontend (يتصل بـ Worker مباشرة عبر Proxy)
cd web && npm run dev

# Backend dev
npx wrangler dev
```

### 2. Deploy الباك إند
```bash
npx wrangler deploy
```

### 3. Deploy الفرونت إند
```bash
cd web && npm run build
npx wrangler pages deploy dist --project-name agri-nile-flow-lake
```

---

## 🗄️ إدارة قاعدة البيانات (D1)

اسم قاعدة البيانات: **`agri-nile-flow-data-lake`**

```bash
# تطبيق الـ Schema كاملاً
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=./schema.sql

# استعلام مباشر
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command "SELECT * FROM users;"

# تحديث سر الـ JWT
printf "SECRET_VALUE" | npx wrangler secret put JWT_SECRET
```

---

## 🔐 الأمان (Security)

*   **JWT_SECRET** محفوظ كـ Cloudflare Worker Secret — **ليس** في `wrangler.toml vars`.
*   **company_id** يُستخرج دائماً من الـ JWT المُحقق، وليس من طلب العميل.
*   **CORS** مسموح فقط من: `agri-nile-flow-lake.pages.dev` + `localhost:5173` + `localhost:4173`.
*   **كلمة المرور**: PBKDF2-SHA256, 100,000 iteration, 16-byte random salt.
*   رابط الـ API في الكود يتم تبديله تلقائياً بناءً على البيئة (`pages.dev` → Worker URL).

---

## ✅ تقرير التقدم (Progress Report)

| المهمة | الحالة | الملاحظات |
| :--- | :---: | :--- |
| إعداد البيئة المحلية | ✅ | Proxy يوجه `/api` → Worker |
| إنشاء قاعدة البيانات D1 | ✅ | `agri-nile-flow-data-lake` — 21 جدول |
| Deploy الفرونت إند (Pages) | ✅ | `agri-nile-flow-lake.pages.dev` |
| Deploy الباك إند (Worker) | ✅ | `agri-nile-flow.mahm-zahran22.workers.dev` |
| إعداد CORS للـ Pages | ✅ | origins محددة فقط |
| تأمين JWT_SECRET | ✅ | Worker Secret — لا يظهر في wrangler.toml |
| إنشاء مستخدم Admin | ✅ | `admin@nawa.eg` / `Admin@2025` |
| API: Auth (login/me/companies) | ✅ | 3-step login flow |
| API: Dashboard (stats/charts/alerts) | ✅ | KPIs + cashflow + inventory alerts |
| API: Suppliers (CRUD + statement) | ✅ | paginated + running balance |
| API: Treasury (journal + balance) | ✅ | auto running_balance |
| API: Inventory (WAC + stock guard) | ✅ | 409 if insufficient stock |
| API: Config (seasons/items/cost_centers) | ✅ | generic CRUD factory |
| Frontend: Login Page | ✅ | 3-step Arabic RTL |
| Frontend: Dashboard | ✅ | KPI cards + bar charts + alerts |
| Frontend: Suppliers List + Detail | ✅ | searchable + statement |
| Frontend: Cash Journal | ✅ | filters + running balance |
| Frontend: Warehouse Balances | ✅ | tab pills + collapsible sections |
| Frontend: Config Page (كل التابات) | ✅ | seasons+items+cost_centers+accounts+expense_types |
| Frontend: Add Forms — Suppliers | ✅ | AddSupplierModal + AddSupplierTransactionModal |
| Frontend: Add Forms — Treasury | ✅ | AddCashTransactionModal |
| Frontend: Add Forms — Inventory | ✅ | AddInventoryMovementModal |
| Frontend: Add Forms — Config | ✅ | AddSeasonModal + AddItemModal + AddMasterRecordModal |
| Frontend: Inventory Movements Page | ✅ | حركات منفصلة عن الأرصدة مع فلاتر |
| Backend: User Management API | ✅ | GET/POST/PATCH /api/users |
| Frontend: User Management Page | ✅ | قائمة + دعوة + تفعيل/تعطيل |
| Backend: Change Password API | ✅ | POST /api/auth/change-password مع PBKDF2 |
| Frontend: Change Password Modal | ✅ | في Header avatar dropdown |
| Backend: Partners Management | ✅ | GET/POST/PATCH /api/treasury/partners |
| Frontend: Partners Page | ✅ | /treasury/partners — رأس المال + الحساب الجاري |
| Reports Page | ✅ | /reports — تقرير مالي شامل مع طباعة |
| Data Migration CLI | ✅ | migrate/ — استيراد Excel → D1 (suppliers, treasury, inventory) |
| Financial Reports / Export | ⏳ | PDF/Excel export (in progress) |

---

## 🚀 الخطوات القادمة (Prioritized)

### المرحلة الأولى — إكمال الواجهات ✅ مكتمل
- [x] نماذج إضافة المعاملات لكل الموديولات
- [x] ConfigPage — كل التابات نشطة مع نماذج الإضافة
- [x] صفحة حركات المخزون المستقلة
- [x] إدارة المستخدمين (API + Frontend)

### المرحلة الثالثة — استيراد البيانات الفعلي (التالي)
- [ ] **ضبط migrate/config.js** — تحديد أسماء الـ sheets والأعمدة
- [ ] `cd migrate && npm install`
- [ ] `node import.js all`
- [ ] مراجعة البيانات على التطبيق المباشر

### المرحلة الرابعة — تقارير متقدمة + تصدير
- [ ] تصدير كشف حساب المورد إلى PDF/Excel
- [ ] تصدير دفتر اليومية
- [ ] تصدير تقرير المخزون
- [ ] بوابة الشركات الـ 31 (super-admin)
- [ ] Offline-first (PWA + IndexedDB)

---

---

## 📁 هيكل المشروع

```
agri-nile-flow/
├── wrangler.toml          # Worker config (DB binding فقط — لا JWT في vars)
├── schema.sql             # 21 جدول + seed (roles, permissions)
├── DEVELOPMENT_PLAN.md    # هذا الملف
├── src/
│   ├── index.ts           # Hono app + CORS + routes
│   ├── types.ts           # Env, JwtPayload, DB types
│   ├── middleware/auth.ts # PBKDF2 + JWT (Web Crypto فقط)
│   └── api/
│       ├── auth.ts        # login / me / companies
│       ├── dashboard.ts   # stats / charts / alerts
│       ├── suppliers.ts   # CRUD + statement + transactions
│       ├── treasury.ts    # journal + balance + payments
│       ├── inventory.ts   # balances + movements (WAC)
│       └── config.ts      # seasons / items / cost_centers
└── web/
    ├── vite.config.ts     # proxy + build config
    ├── src/
    │   ├── api/client.ts  # fetch wrapper (auto BASE URL)
    │   ├── store/appStore.ts
    │   ├── components/ui/ # KPICard + DataTable
    │   └── pages/         # Login + Dashboard + Suppliers + Treasury + Inventory + Config
```
