# Changelog

All notable changes to Agri-Nile Flow project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — April 20, 2026 (Production Release)

### Infrastructure ✅
- **Added**: Complete database schema (35 tables)
- **Added**: D1 database binding (`agri-nile-flow-data-lake`)
- **Added**: Cloudflare Worker deployment
- **Added**: Cloudflare Pages frontend hosting
- **Added**: Seed data (6 roles, 23 permissions)

### Features ✅
- **Authentication**: JWT-based login with PBKDF2-SHA256 hashing
- **Dashboard**: KPI cards, cash flow charts, alerts
- **Suppliers Management**: CRUD + transaction statements + running balance
- **Treasury/Cash Journal**: Income/expense tracking with auto-balancing
- **Inventory Management**: Stock tracking with WAC calculations
- **Configuration**: Seasons, items, cost centers, expense types
- **User Management**: Role-based access control (6 roles)
- **Reports**: Financial statements with export

### Data ✅
- **Imported**: 1,065 production records
  - 10 suppliers
  - 286 supplier transactions
  - 69 cash transactions (balance: -19,801 EGP)
  - 700 inventory movements
- **Calculated**: Weighted Average Cost (WAC) for all inventory items
- **Verified**: All balances match Excel source data

### Security ✅
- **Added**: `.gitignore` with sensitive file exclusions
- **Added**: `.env.example` template
- **Added**: SECURITY.md policy document
- **Added**: GitHub security workflows (secrets scanning, CodeQL, npm audit)
- **Configured**: CORS restrictions (Pages origin + localhost only)
- **Secured**: JWT secret in Cloudflare Worker Secrets
- **Protected**: All routes with authentication except `/api/auth/login`
- **Isolated**: Multi-tenant data by company_id from JWT

### Backend APIs ✅
- `POST /api/auth/login` — User authentication
- `GET /api/auth/me` — Current user info
- `GET /api/auth/companies` — User's companies
- `POST /api/auth/change-password` — Password change with validation
- `GET /api/dashboard/stats` — KPI statistics
- `GET /api/dashboard/charts` — Cashflow & inventory charts
- `GET /api/dashboard/alerts` — System alerts
- `GET /api/suppliers` — List suppliers (paginated)
- `GET /api/suppliers/:id` — Supplier details
- `POST /api/suppliers` — Create supplier
- `PATCH /api/suppliers/:id` — Update supplier
- `GET /api/suppliers/:id/statement` — Supplier statement with running balance
- `GET /api/suppliers/:id/transactions` — Supplier transactions
- `POST /api/suppliers/transactions` — Add transaction
- `GET /api/treasury/journal` — Cash journal (all transactions)
- `GET /api/treasury/balance` — Current balance
- `POST /api/treasury/journal` — Add cash entry
- `PATCH /api/treasury/journal/:id` — Update transaction
- `GET /api/treasury/partners` — Partners (capital accounts)
- `POST /api/treasury/partners` — Add partner
- `GET /api/inventory/balances` — Current stock levels (WAC)
- `POST /api/inventory/movements` — Record inventory movement
- `GET /api/inventory/movements` — Movement history
- `GET /api/config/:type` — Configuration data (seasons, items, etc.)
- `POST /api/config/:type` — Create config item
- `PATCH /api/config/:type/:id` — Update config item
- `GET /api/users` — List users
- `POST /api/users` — Invite new user
- `PATCH /api/users/:id` — Enable/disable user
- `GET /api/health` — Health check

### Frontend Components ✅
- **LoginPage**: 3-step Arabic RTL login
- **DashboardPage**: KPI cards, charts, alerts
- **SupplierListPage**: Searchable list with pagination
- **SupplierDetailPage**: Statement with running balance
- **CashJournalPage**: Full journal with filters and balance
- **WarehouseBalancesPage**: Stock levels by category
- **InventoryMovementsPage**: Movement history with filters
- **ConfigPage**: All config tabs (seasons, items, etc.)
- **UsersPage**: User management and invitations
- **ReportsPage**: Financial reports with print support
- **AddForms**: Modals for all entity creation
- **ChangePasswordModal**: In header avatar dropdown
- **Header**: Navigation + user menu
- **Sidebar**: Mobile-friendly navigation
- **DataTable**: Reusable table component
- **KPICard**: Statistics display
- **Modal**: Generic modal wrapper
- **OfflineBanner**: Offline status indicator

### Documentation ✅
- `README.md` — Project overview
- `DEVELOPMENT_PLAN.md` — Development guide
- `SECURITY.md` — Security policies
- `DEPLOYMENT_STATUS.md` — Production deployment details
- `.env.example` — Environment template
- `.gitignore` — Git ignore rules
- `.github/workflows/security.yml` — Security automation

### Deployment URLs 🚀
- **Backend**: https://agri-nile-flow.mahm-zahran22.workers.dev
- **Frontend**: https://fb7b4223.agri-nile-flow-lake.pages.dev
- **Database**: Cloudflare D1 (`agri-nile-flow-data-lake`)

### Admin Credentials 🔑
- **Email**: admin@nawa.eg
- **Password**: Admin@2025
- **Company**: نواة المستقبل (NM-001)
- **Role**: super_admin

---

## [0.9.0] — Development Phase (Completed)

- Initial schema design (35 tables)
- Backend API development (26 endpoints)
- Frontend component library (15+ components)
- Data import CLI (migrate/)
- Multi-tenant architecture
- Role-based access control
- Treasury calculations
- Inventory WAC implementation

---

## Future Roadmap

### Phase 4: Advanced Reporting
- [ ] PDF export for all reports
- [ ] Excel export for data
- [ ] Period-based financial statements
- [ ] Variance analysis

### Phase 5: Agricultural Features
- [ ] Fields management
- [ ] Work orders & task tracking
- [ ] Employee management
- [ ] Contract management (purchase/sales)
- [ ] Harvest tracking

### Phase 6: General Ledger (GL)
- [ ] Chart of accounts
- [ ] Journal entries
- [ ] Trial balance
- [ ] P&L statement
- [ ] Balance sheet
- [ ] Period closing procedures

### Phase 7: Multi-Company Portal
- [ ] Consolidated reporting
- [ ] Inter-company transactions
- [ ] Super-admin dashboard
- [ ] 31-company management

### Phase 8: Mobile & PWA
- [ ] Offline-first PWA
- [ ] IndexedDB sync
- [ ] Mobile app (React Native)
- [ ] Field crew tablets

---

**Status**: ✅ PRODUCTION READY  
**Last Updated**: April 20, 2026  
**Team**: mahmoud.zahran + claude-team

For questions or suggestions, see DEVELOPMENT_PLAN.md or SECURITY.md
