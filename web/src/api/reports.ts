import { api, unwrap, paginatedUrl } from './core'
import type { PostingMeta } from './gl'

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
      meta?: PostingMeta
    }

    if (!raw.success) throw new Error(raw.error || 'API returned success=false')

    return {
      data: raw.data ?? [],
      legacy_coverage: raw.legacy_coverage ?? null,
      meta: raw.meta ?? null,
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
      costs: { inventory: number; labor: number; equipment: number; cash_out: number; supplier_credit: number; land_rent: number; payroll: number; depreciation: number; total: number }
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

  pivotCosts: (season_id: number) =>
    unwrap(api.get<{
      season:         { id: number; name: string; start_date: string; end_date: string }
      service_groups: string[]
      rows:           Array<{
        center_code:      number
        center_name:      string
        by_service_group: Record<string, number>
        total:            number
      }>
      column_totals: Record<string, number>
      grand_total:   number
      meta?: {
        total_movements: number
        included_movements: number
        excluded_movements: number
        excluded_reasons: {
          null_season_id: number
          null_service_type_code: number
          null_center_code: number
          future_blocked: number
        }
        coverage_pct: string
      }
    }>(`/reports/pivot-costs?season_id=${season_id}`)),

  serviceTypeSummary: (season_id: number) =>
    unwrap(api.get<{
      season: { id: number; name: string; start_date: string; end_date: string }
      rows:   Array<{
        service_type_code: string
        name_ar:           string
        service_group:     string
        ops_total:         number
        gl_total:          number
        gap:               number
        gap_pct:           number
        txn_count:         number
      }>
      totals: { ops_total: number; gl_total: number; gap: number }
    }>(`/reports/service-type-summary?season_id=${season_id}`)),

  supplierApSummary: (params?: { supplier_code?: number; service_class?: string; overdue_only?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.supplier_code) qs.set('supplier_code', String(params.supplier_code))
    if (params?.service_class) qs.set('service_class', params.service_class)
    if (params?.overdue_only)  qs.set('overdue_only', '1')
    const url = `/reports/supplier-ap-summary${qs.toString() ? '?' + qs.toString() : ''}`
    return unwrap(api.get<{
      success: boolean
      data: {
        suppliers: Array<{
          supplier_code: number; supplier_name: string; supplier_activity: string | null
          open_invoice_count: number; open_amount: number; paid_amount: number
          net_ap_balance: number; oldest_due_date: string | null
          days_overdue_max: number | null; has_estimated_due_date: number
          current_amount: number; overdue_1_30: number
          overdue_31_60: number; overdue_61_90: number; overdue_gt_90: number
        }>
        by_service_class: Array<{
          service_type_code: string; service_type_name_ar: string; service_group: string
          supplier_count: number; open_invoiced: number; total_paid: number; invoice_count: number
        }>
        summary: {
          supplier_count: number; total_open_ap: number; current_amount: number
          total_overdue: number; overdue_pct: number
          aging_buckets: {
            current: number; overdue_1_30: number; overdue_31_60: number
            overdue_61_90: number; overdue_gt_90: number
          }
          estimated_due_date_count: number; _note: string | null
        }
        filters_applied: { supplier_code: number | null; service_class: string | null; overdue_only: boolean }
      }
    }>(url))
  },

  reconciliationStatus: () => {
    type RecBoundary = {
      label: string; sub_account: string
      subledger_total: number; gl_balance: number
      gap: number; ok: boolean; severity: 'ok' | 'warning' | 'critical'
    }
    return unwrap(api.get<{
      checked_at: string
      boundaries: { ap: RecBoundary; inventory: RecBoundary; payroll_payable: RecBoundary }
      integrity:  { ghost_entries: number; orphan_events: number; all_clean: boolean }
      overall_ok: boolean
    }>('/reports/reconciliation-status'))
  },

  costPerFeddan: (season_id: number, field_id?: number, sort?: string) => {
    const qs = new URLSearchParams({ season_id: String(season_id) })
    if (field_id) qs.set('field_id', String(field_id))
    if (sort)     qs.set('sort', sort)
    return unwrap(api.get<{
      season: { id: number; name: string; season_type: string; start_date: string; end_date: string; status: string }
      fields: Array<{
        field_id:           number
        field_code:         string
        field_name:         string
        area_feddan:        number
        crop_type:          string | null
        crop_name:          string | null
        center_code:        number | null
        center_name:        string | null
        total_cost:         number
        total_revenue:      number
        margin:             number
        cost_per_feddan:    number | null
        revenue_per_feddan: number | null
        margin_per_feddan:  number | null
        margin_pct:         number | null
        cost_source:        'gl' | 'ops_fallback'
        gl: {
          expense: number; asset: number; revenue: number; entry_count: number
          by_source: { cash: number; supplier: number; inventory: number; manual: number }
        } | null
        ops: {
          inventory: number; labor: number; equipment: number; cash_out: number; land_rent: number
          total: number; revenue: number; advance_collected: number; contract_count: number
          inventory_qty_out: number; work_order_count: number; equipment_hours: number; cash_tx_count: number
        }
        gl_gap: { cost_gap: number; revenue_gap: number }
      }>
      summary: {
        field_count: number; total_area_feddan: number
        total_cost: number; total_revenue: number; total_margin: number
        cost_per_feddan: number | null; revenue_per_feddan: number | null
        margin_per_feddan: number | null; margin_pct: number | null
        gl_coverage: { gl_covered_fields: number; ops_fallback_fields: number; coverage_pct: number }
      }
      sort_applied: string
    }>(`/reports/cost-per-feddan?${qs.toString()}`))
  },
}
