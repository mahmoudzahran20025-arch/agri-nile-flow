import { api, unwrap, paginatedUrl } from './core'

export const reportsApi = {
  costCenters: (season_id?: number) =>
    unwrap(api.get<{
      data: Array<{
        center_code: number; center_name: string | null
        cash_total: number; cash_count: number
        supplier_total: number; supplier_count: number
        inventory_total: number; inventory_count: number
        grand_total: number
      }>
      grand_total: number
    }>(`/reports/cost-centers${season_id ? `?season_id=${season_id}` : ''}`)),

  costCenterDetail: (code: number, season_id?: number) =>
    unwrap(api.get<{
      cash_by_category: Array<{ expense_code: number; expense_name: string; total: number; cnt: number }>
      sup_by_supplier:  Array<{ supplier_code: number; supplier_name: string; total: number; cnt: number }>
      cash_timeline:    Array<{ year: number; month: number; total: number }>
    }>(`/reports/cost-centers/${code}/detail${season_id ? `?season_id=${season_id}` : ''}`)),

  supplierPayments: (p?: { supplier_code?: number; season_id?: number }) =>
    unwrap(api.get<{
      data:    unknown[]
      summary: Array<{
        supplier_code: number; supplier_name: string
        total_credit: number; total_debit: number; balance: number
      }>
    }>(paginatedUrl('/reports/supplier-payments', p ?? {}))),

  suppliersBalance: (season_id?: number) =>
    unwrap(api.get<Array<{
      code: number; name: string; activity: string | null
      total_credit: number; total_debit: number; balance: number
      last_balance: number; tx_count: number
    }>>(`/reports/suppliers-balance${season_id ? `?season_id=${season_id}` : ''}`)),

  seasonSummary: (season_id: number) =>
    unwrap(api.get<{
      season:            unknown
      by_cost_center:    Array<{ center_code: number; center_name: string; cash_total: number; supplier_total: number; inventory_total: number; grand_total: number }>
      by_expense_type:   Array<{ expense_code: number; expense_name: string; total: number; cnt: number }>
      by_supplier:       Array<{ supplier_code: number; supplier_name: string; activity: string | null; total_credit: number; total_debit: number; balance: number; tx_count: number }>
      by_inventory_item: Array<{ item_code: number; item_name: string; unit: string | null; total_qty_out: number; total_value_out: number }>
      monthly_timeline:  Array<{ year: number; month: number; cash_out: number; supplier_credit: number }>
      totals: { cash_out: number; supplier_credit: number; supplier_debit: number; inventory_consumed: number; grand_total: number }
    }>(`/reports/season-summary?season_id=${season_id}`)),

  seasonPnL: (season_id: number) =>
    unwrap(api.get<{
      season:            { id: number; name: string; season_type: string; start_date: string; end_date: string; status: string } | null
      revenue:           { contracts_value: number; advance_collected: number; contracts_count: number }
      costs:             { inventory: number; labor: number; cash_out: number; supplier_credit: number; land_rent: number; payroll: number; total: number }
      net_margin:        number
      total_area:        number
      margin_per_feddan: number | null
      margin_pct:        number | null
      by_field:          Array<{
        id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
        field_revenue: number; inv_cost: number; labor_cost: number
        field_cost: number; field_margin: number; margin_per_feddan: number | null
      }>
    }>(`/reports/season-pnl?season_id=${season_id}`)),

  budgetVsActual: (season_id: number) =>
    unwrap(api.get<{
      season: unknown
      totals: {
        budget: number; actual: number; variance: number
        variance_pct: number | null; utilization_pct: number | null
        budgeted_fields: number; over_budget_count: number; total_fields: number
      }
      rows: Array<{
        id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
        budget_per_feddan: number; budget_total: number
        inv_cost: number; labor_cost: number; cash_cost: number
        actual_total: number; actual_per_feddan: number
        variance: number; variance_pct: number | null; utilization_pct: number | null
        status: 'on_track' | 'at_risk' | 'over_budget' | 'no_budget'
      }>
    }>(`/reports/budget-vs-actual?season_id=${season_id}`)),

  seasonReadiness: (season_id: number) =>
    unwrap(api.get<{
      season:  { id: number; name: string; season_type: string; start_date: string; end_date: string; status: string }
      checks:  Array<{ key: string; label: string; description: string; count: number; ok: boolean; blocker: boolean; action_url: string }>
      summary: { blockers_failed: number; warnings_failed: number; passing: number; total: number; score: number; ready: boolean; total_fields: number; total_harvests: number }
    }>(`/reports/season-readiness?season_id=${season_id}`)),
}
