import { api, unwrap } from './core'
import type { DashboardStats } from '../types'

export const dashboardApi = {
  stats:              () => unwrap(api.get<DashboardStats>('/dashboard/stats')),
  monthlyCashflow:    (months = 12) =>
    unwrap(api.get(`/dashboard/monthly-cashflow?months=${months}`)),
  costByCrop:         (seasonId?: number) =>
    unwrap(api.get(`/dashboard/cost-by-crop${seasonId ? `?season_id=${seasonId}` : ''}`)),
  recentTransactions: (limit = 15) =>
    unwrap(api.get(`/dashboard/recent-transactions?limit=${limit}`)),
  inventoryAlerts:    () => unwrap(api.get('/dashboard/inventory-alerts')),
}
