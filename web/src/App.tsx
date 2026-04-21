import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, useIsAuth } from './store/appStore'
import { configApi } from './api/client'
import RootLayout    from './layouts/RootLayout'
import LoginPage     from './pages/LoginPage'
import DebugPage     from './pages/DebugPage'
import DashboardPage from './pages/DashboardPage'
import SupplierListPage      from './pages/suppliers/SupplierListPage'
import SupplierDetailPage    from './pages/suppliers/SupplierDetailPage'
import CashJournalPage       from './pages/treasury/CashJournalPage'
import WarehouseBalancesPage from './pages/inventory/WarehouseBalancesPage'
import InventoryMovementsPage from './pages/inventory/InventoryMovementsPage'
import ItemCardPage from './pages/inventory/ItemCardPage'
import UsersPage       from './pages/users/UsersPage'
import PartnersPage    from './pages/treasury/PartnersPage'
import ReportsPage     from './pages/ReportsPage'
import ChartsPage      from './pages/reports/ChartsPage'
import ConfigPage      from './pages/config/ConfigPage'
import FieldsPage      from './pages/fields/FieldsPage'
import EmployeesPage   from './pages/employees/EmployeesPage'
import WorkOrdersPage  from './pages/operations/WorkOrdersPage'
import ContractsPage   from './pages/contracts/ContractsPage'
import ChartOfAccountsPage   from './pages/gl/ChartOfAccountsPage'
import JournalEntriesPage    from './pages/gl/JournalEntriesPage'
import FinancialStatementsPage from './pages/gl/FinancialStatementsPage'
import AccountLedgerPage     from './pages/gl/AccountLedgerPage'
import PeriodsPage           from './pages/gl/PeriodsPage'
import BankReconciliationPage from './pages/treasury/BankReconciliationPage'
import PurchaseOrdersPage    from './pages/treasury/PurchaseOrdersPage'
import SuperAdminPage        from './pages/admin/SuperAdminPage'
import AuditLogPage          from './pages/audit/AuditLogPage'
import EmployeeListPage      from './pages/hr/EmployeeListPage'
import EmployeeProfilePage   from './pages/hr/EmployeeProfilePage'
import AttendancePage        from './pages/hr/AttendancePage'
import LeavesAdvancesPage    from './pages/hr/LeavesAdvancesPage'
import PayrollPage           from './pages/hr/PayrollPage'
import DocumentsPage         from './pages/documents/DocumentsPage'
import HarvestPage           from './pages/fields/HarvestPage'
import LocationTasksPage     from './pages/hr/LocationTasksPage'
import HrDashboardPage       from './pages/hr/HrDashboardPage'
import CalendarPage          from './pages/calendar/CalendarPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuth = useIsAuth()
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const isAuth     = useIsAuth()
  const setSeasons = useAppStore(s => s.setSeasons)

  // Load seasons when authenticated
  const { data: seasons } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
    enabled:  isAuth,
  })

  useEffect(() => {
    if (seasons) setSeasons(seasons as never)
  }, [seasons, setSeasons])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/debug" element={<DebugPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <RootLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"  element={<DashboardPage />} />

        {/* Suppliers */}
        <Route path="suppliers"        element={<SupplierListPage />} />
        <Route path="suppliers/:code"  element={<SupplierDetailPage />} />

        {/* Treasury */}
        <Route path="treasury"          element={<CashJournalPage />} />
        <Route path="treasury/partners" element={<PartnersPage />} />

        {/* Inventory */}
        <Route path="inventory"                element={<WarehouseBalancesPage />} />
        <Route path="inventory/movements"      element={<InventoryMovementsPage />} />
        <Route path="inventory/item/:code"     element={<ItemCardPage />} />

        {/* HR Module */}
        <Route path="hr/dashboard"            element={<HrDashboardPage />} />
        <Route path="hr"                      element={<EmployeeListPage />} />
        <Route path="hr/employees/:id"        element={<EmployeeProfilePage />} />
        <Route path="hr/attendance"           element={<AttendancePage />} />
        <Route path="hr/leaves"               element={<LeavesAdvancesPage />} />
        <Route path="hr/payroll"              element={<PayrollPage />} />
        <Route path="hr/location-tasks"       element={<LocationTasksPage />} />

        {/* Calendar & Tasks */}
        <Route path="calendar" element={<CalendarPage />} />

        {/* Documents */}
        <Route path="documents" element={<DocumentsPage />} />

        {/* Agricultural ERP */}
        <Route path="fields"          element={<FieldsPage />} />
        <Route path="fields/harvest"  element={<HarvestPage />} />
        <Route path="employees"       element={<EmployeesPage />} />
        <Route path="operations" element={<WorkOrdersPage />} />
        <Route path="contracts"  element={<ContractsPage />} />

        {/* General Ledger */}
        <Route path="gl/accounts"        element={<ChartOfAccountsPage />} />
        <Route path="gl/ledger/:code"    element={<AccountLedgerPage />} />
        <Route path="gl/entries"         element={<JournalEntriesPage />} />
        <Route path="gl/statements"      element={<FinancialStatementsPage />} />
        <Route path="gl/periods"         element={<PeriodsPage />} />

        {/* Finance */}
        <Route path="treasury/bank"      element={<BankReconciliationPage />} />
        <Route path="treasury/po"        element={<PurchaseOrdersPage />} />

        {/* Reports */}
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/charts" element={<ChartsPage />} />

        {/* Super Admin */}
        <Route path="admin" element={<SuperAdminPage />} />

        {/* Audit Log */}
        <Route path="audit" element={<AuditLogPage />} />

        {/* Users */}
        <Route path="users" element={<UsersPage />} />

        {/* Config */}
        <Route path="config"       element={<ConfigPage />} />
        <Route path="config/:tab"  element={<ConfigPage />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
