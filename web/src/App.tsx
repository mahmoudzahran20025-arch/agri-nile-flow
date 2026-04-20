import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, useIsAuth } from './store/appStore'
import { configApi } from './api/client'
import RootLayout    from './layouts/RootLayout'
import LoginPage     from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import SupplierListPage   from './pages/suppliers/SupplierListPage'
import SupplierDetailPage from './pages/suppliers/SupplierDetailPage'
import CashJournalPage    from './pages/treasury/CashJournalPage'
import WarehouseBalancesPage from './pages/inventory/WarehouseBalancesPage'
import ConfigPage    from './pages/config/ConfigPage'

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
        <Route path="treasury"         element={<CashJournalPage />} />

        {/* Inventory */}
        <Route path="inventory"        element={<WarehouseBalancesPage />} />

        {/* Config */}
        <Route path="config"           element={<ConfigPage />} />
        <Route path="config/:tab"      element={<ConfigPage />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
