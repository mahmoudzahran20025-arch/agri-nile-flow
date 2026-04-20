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
| Data Migration CLI | ✅ | migrate/ — استيراض Excel → D1 |
| **Phase 3 Complete** | ✅ | **جميع البيانات تم تنسيقها مع الاسكيما بنجاح** |
| **Final Data Import** | ✅ | **10 موردين + 286 + 69 + 700 = 1,065 سجل** |
| **Schema Assessment** | ✅ | **تقييم شامل: 98% جاهزية** (انظر SCHEMA_ASSESSMENT.md) |
| **Phase 2: Agricultural ERP** | ✅ | **fields, employees, operations, contracts — APIs deployed** |
| **Phase 3: GL Engine** | ✅ | **شجرة حسابات + يومية + ميزان + P&L + ميزانية عمومية** |
| **Toast System** | ✅ | **ToastContext + ToastContainer — إشعارات فورية** |
| **Data Import Complete** | ✅ | **1,065 سجل: 10 suppliers + 286 transactions + 69 cash + 700 inventory** |
| **Backend Deployment** | ✅ | **https://agri-nile-flow.mahm-zahran22.workers.dev** |
| **Frontend Deployment** | ✅ | **https://fb7b4223.agri-nile-flow-lake.pages.dev** |
| **Database Verification** | ✅ | **35 tables + all core data imported + Phase 2 tables ready** |
| CSV Export (all modules) | ✅ | Treasury, Suppliers, Inventory |
| Financial Reports / Export | ⏳ | Excel export Phase 4 |

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

### المرحلة الرابعة — تطبيق الـ Schema 3 + تشغيل
```bash
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=./schema_phase3.sql
```

### المرحلة الخامسة — التوسع
- [ ] Permission-based UI guards (إخفاء أزرار بناء على الدور)
- [ ] بوابة الشركات الـ 31 (super-admin portal)
- [ ] تقارير مجمعة (consolidated multi-company)
- [ ] Offline-first (PWA + IndexedDB)
- [ ] Excel export للقوائم المالية
- [ ] Account ledger page مستقلة

---

---

## 📁 هيكل المشروع

```
agri-nile-flow/
├── wrangler.toml          # Worker config (DB binding فقط — لا JWT في vars)
├── schema.sql             # 21 جدول + seed (roles, permissions)
├── DEVELOPMENT_PLAN.md    # هذا الملف
├── migrate/               # 🆕 أداة استيراد البيانات
│   ├── import.js          # CLI شامل: suppliers, treasury, inventory, all
│   ├── config.js          # خريطة الأعمدة — عدّله حسب ملفاتك
│   ├── package.json       # dependencies: xlsx
│   └── README.md
├── src/
│   ├── index.ts           # Hono app + CORS + routes
│   ├── types.ts           # Env, JwtPayload, DB types
│   ├── middleware/auth.ts # PBKDF2 + JWT (Web Crypto فقط)
│   └── api/
│       ├── auth.ts        # login / me / companies / change-password 🆕
│       ├── dashboard.ts   # stats / charts / alerts
│       ├── suppliers.ts   # CRUD + statement + transactions
│       ├── treasury.ts    # journal + balance + payments + partners 🆕
│       ├── inventory.ts   # balances + movements (WAC)
│       ├── config.ts      # seasons / items / cost_centers
│       └── users.ts       # user management
└── web/
    ├── vite.config.ts     # proxy + build config
    ├── src/
    │   ├── api/client.ts  # fetch wrapper (auto BASE URL)
    │   ├── store/appStore.ts
    │   ├── components/
    │   │   ├── Header.tsx  # 🆕 avatar dropdown + change password
    │   │   ├── Sidebar.tsx
    │   │   ├── forms/
    │   │   │   ├── ChangePasswordModal.tsx 🆕
    │   │   │   └── ...
    │   │   └── ui/
    │   ├── pages/
    │   │   ├── DashboardPage.tsx
    │   │   ├── LoginPage.tsx
    │   │   ├── ReportsPage.tsx 🆕
    │   │   ├── suppliers/
    │   │   ├── treasury/
    │   │   │   ├── CashJournalPage.tsx
    │   │   │   └── PartnersPage.tsx 🆕
    │   │   ├── inventory/
    │   │   ├── config/
    │   │   └── users/
    │   └── types/
```

---

## 🚀 استيراد البيانات من Excel

### 1. تحضير ملفات Excel

ضع الملفات في folder `migrate/`:
- **suppliers.xlsx** — أعمدة: الكود، الاسم، النشاط
- **treasury.xlsx** — أعمدة: التاريخ، النوع، المبلغ، الملاحظات
- **inventory.xlsx** — أعمدة: الكود، الاسم، الكمية، السعر

### 2. تحديث config.js

عدّل الأعمدة لتطابق ملفاتك:

```javascript
export const SUPPLIERS_CONFIG = {
  file: 'suppliers.xlsx',
  sheet: 'الموردين',
  startRow: 2,
  colMap: {
    code:     'أ',    // العمود A
    name:     'ب',    // العمود B
    activity: 'ج',
  }
}
```

### 3. تشغيل الاستيراد

```bash
cd migrate
npm install          # تثبيت xlsx
node import.js all   # استيراد الكل (suppliers + treasury + inventory)
```

أو استيراد فئة واحدة:

```bash
node import.js suppliers
node import.js treasury
node import.js inventory
```

### 4. التحقق

افتح التطبيق:
- Dashboard — تحقق من الأرصدة
- Suppliers — تحقق من القائمة
- Treasury — تحقق من اليومية
- Inventory — تحقق من الأرصدة
