import { api, unwrap } from './core'
import type { DashboardStats } from '../types'

export interface MonthlyCashflowRow {
  year: number
  month: number
  cash_in: number
  cash_out: number
}

export interface CropCostRow {
  crop: string | null
  total_cost: number
}

export interface RecentTransactionRow {
  ledger: string
  id: number
  date: string
  description: string
  amount: number
  type: string
}

export interface InventoryAlertRow {
  code: number
  name: string
  unit: string | null
  warehouse: string
  reorder_threshold: number
  balance_qty: number
}

export const dashboardApi = {
  stats:              () => unwrap(api.get<DashboardStats>('/dashboard/stats')),
  monthlyCashflow:    (months = 12) =>
    unwrap(api.get<MonthlyCashflowRow[]>(`/dashboard/monthly-cashflow?months=${months}`)),
  costByCrop:         (seasonId?: number) =>
    unwrap(api.get<CropCostRow[]>(`/dashboard/cost-by-crop${seasonId ? `?season_id=${seasonId}` : ''}`)),
  recentTransactions: (limit = 15) =>
    unwrap(api.get<RecentTransactionRow[]>(`/dashboard/recent-transactions?limit=${limit}`)),
  inventoryAlerts:    () => unwrap(api.get<InventoryAlertRow[]>('/dashboard/inventory-alerts')),
}
