# Agri-Nile Flow 🌾
**نظام ERP زراعي متكامل — نواة المستقبل**  
**الإصدار:** v1.2.0 | **آخر تحديث:** 27 أبريل 2026

نظام إدارة مالي ومخزني متخصص للشركات الزراعية المصرية، مبني على Cloudflare Edge (Workers + D1 + Pages).

---

## 🚀 الميزات الرئيسية
- **خزينة يومية:** تتبع الإيرادات والمصروفات مع كشف حساب كل مورد
- **مخزون WAC:** 700 حركة مخزنية حقيقية + تكلفة متوسطة مرجحة
- **مراكز التكلفة:** 10 بيفوتات (أراضي الدلتا الجديدة) مع تتبع التكاليف
- **شجرة الحسابات + GL:** قيود يومية + ميزان مراجعة + قوائم مالية
- **HR + هيكل تنظيمي:** موظفون + org chart تفاعلي
- **Multi-tenant:** عزل كامل بين الشركات عبر JWT
- **عربي RTL حقيقي:** واجهة عربية أصيلة لا مجرد ترجمة

## 🛠️ Stack التقني
| المكون | التقنية |
|--------|---------|
| Backend | Hono 3.x على Cloudflare Workers |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Database | Cloudflare D1 (SQLite) — `agri-nile-flow-data-lake` |
| Auth | JWT (HS256, 24h) + PBKDF2-SHA256 (100k iterations) |
| State | TanStack Query v5 + Zustand |
| Routing | React Router v6 |

## 🔗 الروابط الحية
| | الرابط |
|--|--------|
| **Backend** | https://agri-nile-flow.mahm-zahran22.workers.dev |
| **Frontend** | https://9d3e43a2.agri-nile-flow-lake.pages.dev |
| **دخول Admin** | `admin@nawa.eg` / `Admin@2025` / شركة: `NM-001` |

## 📖 التوثيق
| الملف | الغرض |
|-------|-------|
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | ⭐ الحالة الكاملة + التقييم + خارطة العمل |
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | دليل التطوير اليومي + أوامر D1 |
| [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md) | روابط الإنتاج + تفاصيل API |
| [CHANGELOG.md](CHANGELOG.md) | سجل التغييرات بالإصدارات |
| [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) | دليل كل ملفات التوثيق |

## 🏦 GL Architecture (FinanceCore — Single Path)

All financial posting goes through a single canonical path — never call `postAutoEntry` directly from route handlers.

```
Route Handler
    └─▶ FinanceCore.*()           src/lib/finance_core.ts
            └─▶ PostingEngine.*()  src/lib/posting_engine.ts
                    └─▶ postAutoEntry()  src/lib/gl.ts
                                └─▶ D1: journal_entries + journal_entry_lines
```

| FinanceCore Method | Usage |
|--------------------|-------|
| `recordCashMovement` | Treasury in/out |
| `resolveInventoryMovement` | Stock IN/OUT/ADJ |
| `resolveSupplierInvoice` | AP posting |
| `resolvePayrollPosting` | Payroll accrual |
| `resolvePayrollPayment` | Salary disbursement |
| `resolvePartnerCapital` | Partner equity changes |
| `resolvePartnerCurrent` | Partner current account |

> ⚠️ `gl_account_mappings` table is **legacy read-only** (PUT blocked → 405). Canonical GL setup: `POST /gl/posting-setup`.

---

## ⚡ بدء التطوير
```bash
# Frontend محلي
cd web && npm run dev

# Deploy Backend
npx wrangler deploy

# Deploy Frontend
cd web && npm run build && cd .. && npx wrangler pages deploy web/dist --project-name agri-nile-flow-lake

# استعلام D1
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command "SELECT COUNT(*) FROM items;"
```
