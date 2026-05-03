import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, Suspense, lazy } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, useIsAuth } from './store/appStore'
import { configApi, authApi } from './api/client'
import { AppShell } from './components/shell/AppShell'

// ── Always-eager (critical path) ───────────────────────────────────────────
import LoginPage     from './pages/LoginPage'
import DebugPage     from './pages/DebugPage'
import DashboardPage from './pages/DashboardPage'

// ── Lazy chunks: GL / Finance ───────────────────────────────────────────────
const FinanceHomePage          = lazy(() => import('./pages/gl/FinanceHomePage'))
const ChartOfAccountsPage      = lazy(() => import('./pages/gl/ChartOfAccountsPage'))
const JournalEntriesPage       = lazy(() => import('./pages/gl/JournalEntriesPage'))
const FinancialStatementsPage  = lazy(() => import('./pages/gl/FinancialStatementsPage'))
const AccountLedgerPage        = lazy(() => import('./pages/gl/AccountLedgerPage'))
const PeriodsPage              = lazy(() => import('./pages/gl/PeriodsPage'))
const PostingSimulatorPage     = lazy(() => import('./pages/gl/PostingSimulatorPage'))
const ReconciliationPage       = lazy(() => import('./pages/gl/ReconciliationPage'))
const PeriodCloseCockpit       = lazy(() => import('./pages/gl/PeriodCloseCockpit'))
const BatchPostingCenterPage   = lazy(() => import('./pages/gl/BatchPostingCenterPage'))
const HealthIntegrityPage      = lazy(() => import('./pages/gl/HealthIntegrityPage'))
const GlIntegrityAuditPage     = lazy(() => import('./pages/gl/GlIntegrityAuditPage'))
const GLSettingsPage           = lazy(() => import('./pages/gl/GLSettingsPage'))
const PostingGroupsPage        = lazy(() => import('./pages/gl/PostingGroupsPage'))
const PostingSetupPage         = lazy(() => import('./pages/gl/PostingSetupPage'))
const PostingRulesPage         = lazy(() => import('./pages/gl/PostingRulesPage'))
const PostingSetupHealthPage   = lazy(() => import('./pages/gl/PostingSetupHealthPage'))
const SetupWizardPage          = lazy(() => import('./pages/gl/SetupWizardPage'))
const MasterDataPage           = lazy(() => import('./pages/gl/MasterDataPage'))
const ExchangeRatesPage        = lazy(() => import('./pages/gl/ExchangeRatesPage'))
const AccountRolePolicyPage    = lazy(() => import('./pages/gl/AccountRolePolicyPage'))

// ── Lazy chunks: HR ─────────────────────────────────────────────────────────
const EmployeeListPage    = lazy(() => import('./pages/hr/EmployeeListPage'))
const EmployeeProfilePage = lazy(() => import('./pages/hr/EmployeeProfilePage'))
const AttendancePage      = lazy(() => import('./pages/hr/AttendancePage'))
const LeavesAdvancesPage  = lazy(() => import('./pages/hr/LeavesAdvancesPage'))
const PayrollPage         = lazy(() => import('./pages/hr/PayrollPage'))
const OrgChartPage        = lazy(() => import('./pages/hr/OrgChartPage'))
const LocationTasksPage   = lazy(() => import('./pages/hr/LocationTasksPage'))
const HrDashboardPage     = lazy(() => import('./pages/hr/HrDashboardPage'))

// ── Lazy chunks: Reports ─────────────────────────────────────────────────────
const ReportsPage           = lazy(() => import('./pages/ReportsPage'))
const ChartsPage            = lazy(() => import('./pages/reports/ChartsPage'))
const CostCenterReportPage  = lazy(() => import('./pages/reports/CostCenterReportPage'))
const SuppliersBalancePage  = lazy(() => import('./pages/reports/SuppliersBalancePage'))
const SeasonSummaryPage     = lazy(() => import('./pages/reports/SeasonSummaryPage'))
const SeasonPnLPage         = lazy(() => import('./pages/reports/SeasonPnLPage'))
const SeasonClosePage       = lazy(() => import('./pages/reports/SeasonClosePage'))
const SeasonReadinessPage   = lazy(() => import('./pages/reports/SeasonReadinessPage'))
const BudgetVsActualPage    = lazy(() => import('./pages/reports/BudgetVsActualPage'))
const SeasonReportsPage     = lazy(() => import('./pages/reports/SeasonReportsPage'))

// ── Lazy chunks: Operations / misc ──────────────────────────────────────────
const SupplierHubPage          = lazy(() => import('./pages/suppliers/SupplierHubPage'))
const SupplierDetailPage       = lazy(() => import('./pages/suppliers/SupplierDetailPage'))
const CashJournalPage          = lazy(() => import('./pages/treasury/CashJournalPage'))
const PartnersPage             = lazy(() => import('./pages/treasury/PartnersPage'))
const BankReconciliationPage   = lazy(() => import('./pages/treasury/BankReconciliationPage'))
const PurchaseOrdersPage       = lazy(() => import('./pages/treasury/PurchaseOrdersPage'))
const APAgingPage              = lazy(() => import('./pages/treasury/APAgingPage'))
const WarehouseBalancesPage    = lazy(() => import('./pages/inventory/WarehouseBalancesPage'))
const WarehousesPage           = lazy(() => import('./pages/inventory/WarehousesPage'))
const InventoryMovementsPage   = lazy(() => import('./pages/inventory/InventoryMovementsPage'))
const TransactionHistoryPage   = lazy(() => import('./pages/inventory/TransactionHistoryPage'))
const ItemCardPage             = lazy(() => import('./pages/inventory/ItemCardPage'))
const CostByFieldPage          = lazy(() => import('./pages/inventory/CostByFieldPage'))
const ItemCategoriesPage       = lazy(() => import('./pages/inventory/ItemCategoriesPage'))
const InventoryAdjustmentsPage = lazy(() => import('./pages/inventory/InventoryAdjustmentsPage'))
const AdjustmentDetailPage     = lazy(() => import('./pages/inventory/AdjustmentDetailPage'))
const ItemMasterPage           = lazy(() => import('./pages/inventory/ItemMasterPage'))
const InventoryPostingHealthPage = lazy(() => import('./pages/inventory/InventoryPostingHealthPage'))
const InventoryBalancesPage      = lazy(() => import('./pages/inventory/InventoryBalancesPage'))
const FixedAssetsPage            = lazy(() => import('./pages/inventory/FixedAssetsPage'))
const WipBalancesPage            = lazy(() => import('./pages/inventory/WipBalancesPage'))
const UsersPage                = lazy(() => import('./pages/users/UsersPage'))
const ConfigPage               = lazy(() => import('./pages/config/ConfigPage'))
const FieldsPage               = lazy(() => import('./pages/fields/FieldsPage'))
const SeasonsPage              = lazy(() => import('./pages/fields/SeasonsPage'))
const HarvestPage              = lazy(() => import('./pages/fields/HarvestPage'))
const WorkOrdersPage           = lazy(() => import('./pages/operations/WorkOrdersPage'))
const WorkOrderTemplatesPage   = lazy(() => import('./pages/operations/WorkOrderTemplatesPage'))
const ContractsPage            = lazy(() => import('./pages/contracts/ContractsPage'))
const SuperAdminPage           = lazy(() => import('./pages/admin/SuperAdminPage'))
const AuditLogPage             = lazy(() => import('./pages/audit/AuditLogPage'))
const ErrorLogPage             = lazy(() => import('./pages/audit/ErrorLogPage'))
const IntegrityPage            = lazy(() => import('./pages/audit/IntegrityPage'))
const AuditCenterPage          = lazy(() => import('./pages/audit/AuditCenterPage'))
const DocumentsPage            = lazy(() => import('./pages/documents/DocumentsPage'))
const CalendarPage             = lazy(() => import('./pages/calendar/CalendarPage'))

// ── Fallback while lazy chunks load ─────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="w-6 h-6 border-2 border-[#0F2D5C] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuth = useIsAuth()
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const isAuth        = useIsAuth()
  const isDebugEnabled = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const setSeasons     = useAppStore(s => s.setSeasons)
  const setPermissions = useAppStore(s => s.setPermissions)

  // Load seasons when authenticated
  const { data: seasons } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
    enabled:  isAuth,
  })

  // Refresh permissions from server on mount (fixes stale [] from old sessions)
  const { data: meData } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn:  authApi.me,
    enabled:  isAuth,
    staleTime: 300_000,
  })

  useEffect(() => {
    if (seasons) setSeasons(seasons as never)
  }, [seasons, setSeasons])

  useEffect(() => {
    if (meData?.permissions) setPermissions(meData.permissions)
  }, [meData, setPermissions])

  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {isDebugEnabled && (
        <Route path="/debug" element={<RequireAuth><DebugPage /></RequireAuth>} />
      )}

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"  element={<DashboardPage />} />

        {/* Suppliers */}
        <Route path="suppliers"        element={<SupplierHubPage />} />
        <Route path="suppliers/:code"  element={<SupplierDetailPage />} />

        {/* Treasury */}
        <Route path="treasury"          element={<CashJournalPage />} />
        <Route path="treasury/partners" element={<PartnersPage />} />

        {/* Inventory */}
        <Route path="inventory"                  element={<WarehouseBalancesPage />} />
        <Route path="inventory/items"            element={<ItemMasterPage />} />
        <Route path="inventory/categories"       element={<ItemCategoriesPage />} />
        <Route path="inventory/adjustments"      element={<InventoryAdjustmentsPage />} />
        <Route path="inventory/adjustments/:id"  element={<AdjustmentDetailPage />} />
        <Route path="inventory/setup"            element={<WarehousesPage />} />
        <Route path="inventory/movements"        element={<InventoryMovementsPage />} />
        <Route path="inventory/transactions"     element={<TransactionHistoryPage />} />
        <Route path="inventory/item/:code"       element={<ItemCardPage />} />
        <Route path="inventory/cost-by-field"    element={<CostByFieldPage />} />
        <Route path="inventory/posting-health"   element={<InventoryPostingHealthPage />} />
        <Route path="inventory/balances-detail"  element={<InventoryBalancesPage />} />
        <Route path="inventory/fixed-assets"     element={<FixedAssetsPage />} />
        <Route path="inventory/wip"              element={<WipBalancesPage />} />

        {/* HR Module */}
        <Route path="hr/dashboard"            element={<HrDashboardPage />} />
        <Route path="hr"                      element={<EmployeeListPage />} />
        <Route path="hr/employees/:id"        element={<EmployeeProfilePage />} />
        <Route path="hr/attendance"           element={<AttendancePage />} />
        <Route path="hr/leaves"               element={<LeavesAdvancesPage />} />
        <Route path="hr/payroll"              element={<PayrollPage />} />
        <Route path="hr/org"                  element={<OrgChartPage />} />
        <Route path="hr/location-tasks"       element={<LocationTasksPage />} />

        {/* Calendar & Tasks */}
        <Route path="calendar" element={<CalendarPage />} />

        {/* Documents */}
        <Route path="documents" element={<DocumentsPage />} />

        {/* Agricultural ERP */}
        <Route path="fields"          element={<FieldsPage />} />
        <Route path="seasons"         element={<SeasonsPage />} />
        <Route path="fields/harvest"  element={<HarvestPage />} />
        <Route path="operations" element={<WorkOrdersPage />} />
        <Route path="operations/templates" element={<WorkOrderTemplatesPage />} />
        <Route path="contracts"  element={<ContractsPage />} />

        {/* General Ledger */}
        <Route path="gl"             element={<FinanceHomePage />} />
        <Route path="gl/accounts"     element={<ChartOfAccountsPage />} />
        <Route path="gl/ledger/:code" element={<AccountLedgerPage />} />
        <Route path="gl/entries"      element={<JournalEntriesPage />} />
        <Route path="gl/statements"   element={<FinancialStatementsPage />} />
        <Route path="gl/health-integrity" element={<HealthIntegrityPage />} />
        <Route path="gl/integrity-audit"  element={<GlIntegrityAuditPage />} />
        {/* GL Settings hub — tabs: mappings | integrations | periods */}
        <Route path="gl/settings"      element={<GLSettingsPage />} />
        <Route path="gl/posting-groups" element={<PostingGroupsPage />} />
        <Route path="gl/posting-setup"  element={<PostingSetupPage />} />
        <Route path="gl/posting-setup/health" element={<PostingSetupHealthPage />} />
        <Route path="gl/posting-rules"        element={<PostingRulesPage />} />
        <Route path="gl/setup-wizard" element={<SetupWizardPage />} />
        <Route path="gl/master-data"  element={<MasterDataPage />} />
        <Route path="gl/exchange-rates" element={<ExchangeRatesPage />} />
        <Route path="gl/account-role-policy" element={<AccountRolePolicyPage />} />
        {/* Sprint 2 Finance epics */}
        <Route path="gl/posting-simulator" element={<PostingSimulatorPage />} />
        <Route path="gl/reconciliation"    element={<ReconciliationPage />} />
        <Route path="gl/period-close"      element={<PeriodCloseCockpit />} />
        {/* Sprint 3 Finance epics */}
        <Route path="gl/batch-posting"     element={<BatchPostingCenterPage />} />
        {/* Keep direct routes alive for backward-compat / deep-linking */}
        <Route path="gl/periods"      element={<PeriodsPage />} />
        <Route path="gl/classifier"   element={<Navigate to="/gl" replace />} />
        <Route path="gl/integrations" element={<Navigate to="/gl" replace />} />
        <Route path="treasury/ap"     element={<APAgingPage />} />

        {/* Finance */}
        <Route path="treasury/bank"      element={<BankReconciliationPage />} />
        <Route path="treasury/po"        element={<PurchaseOrdersPage />} />

        {/* Reports */}
        <Route path="reports"                    element={<ReportsPage />} />
        <Route path="reports/charts"             element={<ChartsPage />} />
        <Route path="reports/cost-centers"       element={<CostCenterReportPage />} />
        <Route path="reports/suppliers-balance"  element={<SuppliersBalancePage />} />
        {/* Season reports hub — tabs: summary | pnl | budget | readiness | close */}
        <Route path="reports/season"             element={<SeasonReportsPage />} />
        {/* Keep individual routes for backward-compat */}
        <Route path="reports/season-summary"     element={<SeasonSummaryPage />} />
        <Route path="reports/season-pnl"         element={<SeasonPnLPage />} />
        <Route path="reports/season-close"       element={<SeasonClosePage />} />
        <Route path="reports/season-readiness"   element={<SeasonReadinessPage />} />
        <Route path="reports/budget-vs-actual"   element={<BudgetVsActualPage />} />

        {/* Super Admin */}
        <Route path="admin" element={<SuperAdminPage />} />

        {/* Audit Center — unified with tabs: log | errors | integrity */}
        <Route path="audit"           element={<AuditCenterPage />} />
        {/* Keep deep-link routes for backward-compat */}
        <Route path="audit/log"       element={<AuditLogPage />} />
        <Route path="audit/errors"    element={<ErrorLogPage />} />
        <Route path="audit/integrity" element={<IntegrityPage />} />

        {/* Users */}
        <Route path="users" element={<UsersPage />} />

        {/* Config */}
        <Route path="config"       element={<ConfigPage />} />
        <Route path="config/:tab"  element={<ConfigPage />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
