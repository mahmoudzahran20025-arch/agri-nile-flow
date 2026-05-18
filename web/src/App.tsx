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
// ── Lazy chunks: GL / Finance (core) ────────────────────────────────────────
const FinanceHomePage          = lazy(() => import('./pages/gl/FinanceHomePage'))
const ChartOfAccountsPage      = lazy(() => import('./pages/gl/ChartOfAccountsPage'))
const JournalEntriesPage       = lazy(() => import('./pages/gl/JournalEntriesPage'))
const FinancialStatementsPage  = lazy(() => import('./pages/gl/FinancialStatementsPage'))
const AccountLedgerPage        = lazy(() => import('./pages/gl/AccountLedgerPage'))
const PeriodsPage              = lazy(() => import('./pages/gl/PeriodsPage'))
const PeriodCloseCockpit       = lazy(() => import('./pages/gl/PeriodCloseCockpit'))
const ReconciliationPage       = lazy(() => import('./pages/gl/ReconciliationPage'))
const BatchPostingCenterPage   = lazy(() => import('./pages/gl/BatchPostingCenterPage'))
const PostingGroupsPage        = lazy(() => import('./pages/gl/PostingGroupsPage'))
const PostingRulesPage         = lazy(() => import('./pages/gl/PostingRulesPage'))
const PostingSetupPage         = lazy(() => import('./pages/gl/PostingSetupPage'))
const PostingSetupHealthPage   = lazy(() => import('./pages/gl/PostingSetupHealthPage'))
const GLSettingsPage           = lazy(() => import('./pages/gl/GLSettingsPage'))
// Merged workspaces
const HardeningDashboardPage   = lazy(() => import('./pages/gl/HardeningDashboardPage'))
const HealthIntegrityPage      = lazy(() => import('./pages/gl/HealthIntegrityPage'))
const GlIntegrityAuditPage     = lazy(() => import('./pages/gl/GlIntegrityAuditPage'))
const JERegenerationPage       = lazy(() => import('./pages/gl/JERegenerationPage'))
const VerificationDashboardPage = lazy(() => import('./pages/gl/VerificationDashboardPage'))
const ServiceTypesPage          = lazy(() => import('./pages/gl/ServiceTypesPage'))
const DepreciationPage          = lazy(() => import('./pages/gl/DepreciationPage'))

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
const PivotCostsPage        = lazy(() => import('./pages/reports/PivotCostsPage'))
const CostPerFeddanPage     = lazy(() => import('./pages/reports/CostPerFeddanPage'))
const SupplierAPSummaryPage    = lazy(() => import('./pages/reports/SupplierAPSummaryPage'))
const ServiceTypeSummaryPage   = lazy(() => import('./pages/reports/ServiceTypeSummaryPage'))
const SeasonClosePage       = lazy(() => import('./pages/reports/SeasonClosePage'))
const SeasonReadinessPage   = lazy(() => import('./pages/reports/SeasonReadinessPage'))
const BudgetVsActualPage    = lazy(() => import('./pages/reports/BudgetVsActualPage'))
const SeasonReportsPage     = lazy(() => import('./pages/reports/SeasonReportsPage'))

// ── Lazy chunks: Operations / misc ──────────────────────────────────────────
const SupplierHubPage          = lazy(() => import('./pages/suppliers/SupplierHubPage'))
const ProcurementGatewayPage   = lazy(() => import('./pages/suppliers/ProcurementGatewayPage'))
const SupplierDetailPage       = lazy(() => import('./pages/suppliers/SupplierDetailPage'))
const PendingApprovalsPage     = lazy(() => import('./pages/suppliers/PendingApprovalsPage'))
const APAgingPage              = lazy(() => import('./pages/suppliers/APAgingPage'))
const TreasuryHubPage          = lazy(() => import('./pages/treasury/TreasuryHubPage'))
const PartnersPage             = lazy(() => import('./pages/treasury/PartnersPage'))
const BankReconciliationPage   = lazy(() => import('./pages/treasury/BankReconciliationPage'))
const WarehouseBalancesPage    = lazy(() => import('./pages/inventory/WarehouseBalancesPage'))
const WarehousesPage           = lazy(() => import('./pages/inventory/WarehousesPage'))
const MovementWorkspacePage    = lazy(() => import('./pages/inventory/MovementWorkspacePage'))
const InventoryMovementsPage   = lazy(() => import('./pages/inventory/InventoryMovementsPage'))
const TransactionHistoryPage   = lazy(() => import('./pages/inventory/TransactionHistoryPage'))
const TransactionDetailPage    = lazy(() => import('./pages/inventory/TransactionDetailPage'))
const ItemCardPage             = lazy(() => import('./pages/inventory/ItemCardPage'))
const CostByFieldPage          = lazy(() => import('./pages/inventory/CostByFieldPage'))
const ItemCategoriesPage       = lazy(() => import('./pages/inventory/ItemCategoriesPage'))
const ItemMasterPage           = lazy(() => import('./pages/inventory/ItemMasterPage'))
const InventoryPostingHealthPage = lazy(() => import('./pages/inventory/InventoryPostingHealthPage'))
const PhysicalCountPage          = lazy(() => import('./pages/inventory/PhysicalCountPage'))
const FixedAssetsPage            = lazy(() => import('./pages/inventory/FixedAssetsPage'))
const WipBalancesPage            = lazy(() => import('./pages/inventory/WipBalancesPage'))

const UsersPage                = lazy(() => import('./pages/users/UsersPage'))
const ConfigPage               = lazy(() => import('./pages/config/ConfigPage'))
const BulkImportPage           = lazy(() => import('./pages/config/BulkImportPage'))
const FieldsPage               = lazy(() => import('./pages/fields/FieldsPage'))
const SeasonsPage              = lazy(() => import('./pages/fields/SeasonsPage'))
const HarvestPage              = lazy(() => import('./pages/fields/HarvestPage'))
const CropCyclesPage           = lazy(() => import('./pages/fields/CropCyclesPage'))
const CropCycleDetailPage      = lazy(() => import('./pages/fields/CropCycleDetailPage'))
const HarvestSettlementPage      = lazy(() => import('./pages/fields/HarvestSettlementPage'))
const HarvestSettlementsListPage = lazy(() => import('./pages/fields/HarvestSettlementsListPage'))
const WorkOrdersPage           = lazy(() => import('./pages/operations/WorkOrdersPage'))
const WorkOrderTemplatesPage   = lazy(() => import('./pages/operations/WorkOrderTemplatesPage'))
const ContractsPage            = lazy(() => import('./pages/contracts/ContractsPage'))
const SuperAdminPage           = lazy(() => import('./pages/admin/SuperAdminPage'))
const OnboardingPage           = lazy(() => import('./pages/admin/OnboardingPage'))
const ConsolidatedPnlPage      = lazy(() => import('./pages/admin/ConsolidatedPnlPage'))
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
        <Route path="/debug" element={isDebugEnabled ? <RequireAuth><DebugPage /></RequireAuth> : <Navigate to="/dashboard" replace />} />
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
        <Route path="suppliers"              element={<SupplierHubPage />} />
        <Route path="suppliers/procurement"  element={<ProcurementGatewayPage />} />
        <Route path="suppliers/aging"        element={<APAgingPage />} />
        <Route path="suppliers/pending"      element={<PendingApprovalsPage />} />
        <Route path="suppliers/:code"        element={<SupplierDetailPage />} />

        {/* Treasury Hub — unified Procure-to-Pay workspace */}
        <Route path="treasury"          element={<TreasuryHubPage />} />
        <Route path="treasury/partners" element={<PartnersPage />} />

        {/* Inventory */}
        <Route path="inventory"                  element={<WarehouseBalancesPage />} />
        <Route path="inventory/items"            element={<ItemMasterPage />} />
        <Route path="inventory/categories"       element={<ItemCategoriesPage />} />
        <Route path="inventory/setup"            element={<WarehousesPage />} />
        <Route path="inventory/workspace/create"    element={<MovementWorkspacePage />} />
        <Route path="inventory/movements"        element={<InventoryMovementsPage />} />
        <Route path="inventory/transactions"     element={<TransactionHistoryPage />} />
        <Route path="inventory/transactions/:id" element={<TransactionDetailPage />} />
        <Route path="inventory/item/:code"       element={<ItemCardPage />} />
        <Route path="inventory/cost-by-field"    element={<CostByFieldPage />} />
        <Route path="inventory/posting-health"   element={<InventoryPostingHealthPage />} />
        <Route path="inventory/physical-count"   element={<PhysicalCountPage />} />
        <Route path="inventory/fixed-assets"     element={<FixedAssetsPage />} />
        <Route path="inventory/wip-balances"     element={<WipBalancesPage />} />

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
        <Route path="fields"                    element={<FieldsPage />} />
        <Route path="seasons"                   element={<SeasonsPage />} />
        <Route path="fields/harvest"            element={<HarvestPage />} />
        <Route path="fields/crop-cycles"        element={<CropCyclesPage />} />
        <Route path="fields/crop-cycles/:id"    element={<CropCycleDetailPage />} />
        <Route path="fields/harvest-settlement"  element={<HarvestSettlementPage />} />
        <Route path="fields/harvest-settlements" element={<HarvestSettlementsListPage />} />
        <Route path="operations" element={<WorkOrdersPage />} />
        <Route path="operations/templates" element={<WorkOrderTemplatesPage />} />
        <Route path="contracts"  element={<ContractsPage />} />

        {/* ── General Ledger: core workspaces ─────────────────────────────── */}
        <Route path="gl"              element={<FinanceHomePage />} />
        <Route path="gl/accounts"     element={<ChartOfAccountsPage />} />
        <Route path="gl/ledger/:code" element={<AccountLedgerPage />} />
        <Route path="gl/entries"      element={<JournalEntriesPage />} />
        <Route path="gl/statements"   element={<FinancialStatementsPage />} />
        <Route path="gl/batch-posting" element={<BatchPostingCenterPage />} />
        <Route path="gl/reconciliation" element={<ReconciliationPage />} />
        <Route path="gl/periods"       element={<PeriodsPage />} />
        <Route path="gl/period-close"  element={<PeriodCloseCockpit />} />

        {/* ── Posting workspace (rules + tables + health as tabs) ──────────── */}
        <Route path="gl/posting-groups"       element={<PostingGroupsPage />} />
        <Route path="gl/posting-rules"        element={<PostingRulesPage />} />
        <Route path="gl/posting-setup"        element={<PostingSetupPage />} />
        <Route path="gl/posting-setup/health" element={<PostingSetupHealthPage />} />

        {/* ── GL Hardening workspace (governance + health + integrity) ─────── */}
        <Route path="gl/hardening"           element={<HardeningDashboardPage />} />
        <Route path="gl/health-integrity"    element={<HealthIntegrityPage />} />
        <Route path="gl/integrity-audit"     element={<GlIntegrityAuditPage />} />
        <Route path="gl/je-regeneration"     element={<JERegenerationPage />} />
        <Route path="gl/verification"        element={<VerificationDashboardPage />} />

        {/* ── GL Settings ─────────────────────────────────────────────────── */}
        <Route path="gl/settings"      element={<GLSettingsPage />} />
        <Route path="gl/service-types" element={<ServiceTypesPage />} />
        <Route path="gl/depreciation"  element={<DepreciationPage />} />

        {/* ── Archived pages: redirect to nearest live workspace ───────────── */}
        <Route path="gl/posting-simulator"   element={<Navigate to="/gl/posting-rules" replace />} />
        <Route path="gl/setup-wizard"        element={<Navigate to="/gl/settings"      replace />} />
        <Route path="gl/master-data"         element={<Navigate to="/gl/settings"      replace />} />
        <Route path="gl/exchange-rates"      element={<Navigate to="/gl/settings"      replace />} />
        <Route path="gl/account-role-policy" element={<Navigate to="/gl/hardening"     replace />} />
        {/* legacy treasury sub-routes — redirect to live destinations */}
        <Route path="treasury/ap"  element={<Navigate to="/suppliers/aging"        replace />} />
        <Route path="treasury/po"  element={<Navigate to="/suppliers/procurement"  replace />} />

        {/* Finance */}
        <Route path="treasury/bank"      element={<BankReconciliationPage />} />

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
        <Route path="reports/pivot-costs"        element={<PivotCostsPage />} />
        <Route path="reports/cost-per-feddan"    element={<CostPerFeddanPage />} />
        <Route path="reports/supplier-ap-summary"    element={<SupplierAPSummaryPage />} />
        <Route path="reports/service-type-summary"  element={<ServiceTypeSummaryPage />} />
        <Route path="reports/season-close"       element={<SeasonClosePage />} />
        <Route path="reports/season-readiness"   element={<SeasonReadinessPage />} />
        <Route path="reports/budget-vs-actual"   element={<BudgetVsActualPage />} />

        {/* Super Admin */}
        <Route path="admin"                  element={<SuperAdminPage />} />
        <Route path="admin/onboarding"       element={<OnboardingPage />} />
        <Route path="admin/consolidated-pnl" element={<ConsolidatedPnlPage />} />

        {/* Audit Center — unified with tabs: log | errors | integrity */}
        <Route path="audit"           element={<AuditCenterPage />} />
        {/* Keep deep-link routes for backward-compat */}
        <Route path="audit/log"       element={<AuditLogPage />} />
        <Route path="audit/errors"    element={<ErrorLogPage />} />
        <Route path="audit/integrity" element={<IntegrityPage />} />

        {/* Users */}
        <Route path="users" element={<UsersPage />} />

        {/* Config */}
        <Route path="config"             element={<ConfigPage />} />
        <Route path="config/:tab"        element={<ConfigPage />} />
        <Route path="config/bulk-import" element={<BulkImportPage />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
