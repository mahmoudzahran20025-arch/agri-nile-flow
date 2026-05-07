import { api, unwrap, paginatedUrl } from './core'

type LegacyCoverage = {
  has_legacy_gaps: boolean
  posted_events_total: number
  covered_events: number
  missing_journal_link_events: number
  missing_supplier_code_events: number
  coverage_rate_pct: number
  notes: string
}

export const reportsApi = {
  costCenters: (season_id?: number) =>
    unwrap(api.get<{
      data: Array<{
        center_code:     number
        center_name:     string
        expense_total:   number
        revenue_total:   number
        asset_total:     number
        liability_total: number
        entry_count:     number
        net_cost:        number
      }>
      summary: {
        grand_expense:  number
        grand_revenue:  number
        grand_net_cost: number
        center_count:   number
        data_source:    string
      }
    }>(`/reports/cost-centers${season_id ? `?season_id=${season_id}` : ''}`)),

  costCenterDetail: (code: number, season_id?: number) =>
    unwrap(api.get<{
      data: {
        center:   { code: number; name: string }
        summary:  Array<{ account_code: string; account_name: string; account_type: string; total_debit: number; total_credit: number; line_count: number }>
        timeline: Array<{ year: string; month: string; expense_total: number; revenue_total: number; entry_count: number }>
        lines:    Array<{
          id: number; account_code: string; account_name: string; account_type: string
          debit: number; credit: number; line_description: string | null; rule_slot: string | null
          entry_id: number; entry_date: string; entry_description: string | null
          ref_type: string | null; ref_id: number | null
          business_event_type: string | null; source_module: string | null
        }>
        totals:     { expense: number; revenue: number; net_cost: number }
        pagination: { total: number; page: number; page_size: number; has_more: boolean }
        data_source: string
      }
    }>(`/reports/cost-centers/${code}/detail${season_id ? `?season_id=${season_id}` : ''}`)),

  supplierPayments: async (p?: {
    supplier_code?: number
    season_id?: number
    source_table?: 'supplier_transactions' | 'supplier_invoices'
  }) => {
    const raw = await api.get<unknown[]>(paginatedUrl('/reports/supplier-payments', p ?? {})) as unknown as {
      success: boolean
      error?: string
      data?: unknown[]
      summary?: Array<{
        supplier_code: number
        supplier_name: string
        total_credit: number
        total_debit: number
        balance: number
      }>
      legacy_coverage?: LegacyCoverage
    }

    if (!raw.success) throw new Error(raw.error || 'API returned success=false')

    return {
      data: raw.data ?? [],
      summary: raw.summary ?? [],
      legacy_coverage: raw.legacy_coverage ?? null,
    }
  },

  suppliersBalance: async (season_id?: number) => {
    const raw = await api.get<unknown[]>(`/reports/suppliers-balance${season_id ? `?season_id=${season_id}` : ''}`) as unknown as {
      success: boolean
      error?: string
      data?: Array<{
        code: number; name: string; activity: string | null
        total_credit: number; total_debit: number; balance: number
        last_balance: number; tx_count: number
      }>
      legacy_coverage?: LegacyCoverage
    }

    if (!raw.success) throw new Error(raw.error || 'API returned success=false')

    return {
      data: raw.data ?? [],
      legacy_coverage: raw.legacy_coverage ?? null,
    }
  },

  seasonSummary: (season_id: number) =>
    unwrap(api.get<{
      season: { id: number; name: string; season_type: string; start_date: string; end_date: string; status: string } | null
      pl_summary: { total_revenue: number; total_expense: number; net_income: number; gross_margin_pct: number | null }
      balance_summary: { total_assets: number; total_liabilities: number }
      by_account: Array<{ account_code: string; account_name: string; account_type: string; normal_balance: string; total_debit: number; total_credit: number; net_debit: number; entry_count: number }>
      by_cost_center: Array<{ center_code: number; center_name: string; expense_total: number; revenue_total: number; entry_count: number }>
      by_field: Array<{ field_id: number; field_name: string; area_ha: number | null; expense_total: number; revenue_total: number }>
      timeline: Array<{ year: string; month: string; expense_total: number; revenue_total: number; entry_count: number }>
      data_source: string
    }>(`/reports/season-summary?season_id=${season_id}`)),

  seasonPnL: (season_id: number) =>
    unwrap(api.get<{
      season: { id: number; name: string; season_type: string; start_date: string; end_date: string; status: string } | null
      revenue: { contracts_value: number; advance_collected: number; contracts_count: number }
      costs: { inventory: number; labor: number; equipment: number; cash_out: number; supplier_credit: number; land_rent: number; payroll: number; total: number }
      net_margin: number
      total_area: number
      margin_per_feddan: number | null
      margin_pct: number | null
      by_field: Array<{
        id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
        field_revenue: number; inv_cost: number; labor_cost: number
        equipment_cost: number; cash_cost: number
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
      season: { id: number; name: string; season_type: string; start_date: string; end_date: string; status: string }
      checks: Array<{ key: string; label: string; description: string; count: number; ok: boolean; blocker: boolean; action_url: string }>
      summary: { blockers_failed: number; warnings_failed: number; passing: number; total: number; score: number; ready: boolean; total_fields: number; total_harvests: number }
    }>(`/reports/season-readiness?season_id=${season_id}`)),

  trialBalance: (params: { period_id?: number; as_of?: string }) => {
    const qs = new URLSearchParams()
    if (params.period_id != null) qs.set('period_id', String(params.period_id))
    if (params.as_of)            qs.set('as_of', params.as_of)
    return unwrap(api.get<{
      data: Array<{
        account_code:   string
        account_name:   string
        account_type:   string
        normal_balance: string
        parent_code:    string | null
        is_header:      boolean
        opening_balance: number
        period_debit:   number
        period_credit:  number
        closing_balance: number
      }>
      summary: {
        total_period_debit:  number
        total_period_credit: number
        is_balanced:         boolean
        imbalance:           number
        row_count:           number
        by_type:             Record<string, { debit: number; credit: number }>
        data_source:         string
      }
      period_id?: number
      as_of?:     string
    }>(`/reports/trial-balance?${qs.toString()}`))
  },
}
