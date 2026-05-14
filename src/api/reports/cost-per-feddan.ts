/**
 * Cost-per-Feddan Report
 * ======================
 * Authoritative per-field cost efficiency report for a season.
 * - Primary source: GL journal_entry_lines (posted entries only)
 * - Ops annotations: work tasks, equipment, cash, supplier, inventory (unposted coverage)
 * - Output: cost_per_feddan, revenue_per_feddan, margin_per_feddan per field + season rollup
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const costPerFeddan = new Hono<{ Bindings: Env }>()

// GET /reports/cost-per-feddan?season_id=&field_id=&sort=cost_per_feddan|margin|total_cost
costPerFeddan.get('/cost-per-feddan', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null
  const fieldId  = c.req.query('field_id')  ? Number(c.req.query('field_id'))  : null
  const sort     = c.req.query('sort') ?? 'cost_per_feddan'

  if (!seasonId) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const ALLOWED_SORTS = new Set(['cost_per_feddan', 'margin_per_feddan', 'total_cost', 'total_revenue', 'area_feddan'])
  const sortCol = ALLOWED_SORTS.has(sort) ? sort : 'cost_per_feddan'

  const seasonRow = await c.env.DB.prepare(
    'SELECT id, name, season_type, start_date, end_date, status FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(seasonId, company_id).first<{
    id: number; name: string; season_type: string
    start_date: string; end_date: string; status: string
  }>()

  if (!seasonRow) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  const fieldFilter   = fieldId ? 'AND f.id = ?' : ''
  const fieldBindBase = fieldId ? [company_id, seasonId, fieldId] : [company_id, seasonId]

  // ── 1. All fields in this season with area ────────────────────────────────
  const { results: fields } = await c.env.DB.prepare(`
    SELECT
      f.id,
      f.code,
      f.name     AS field_name,
      f.area_feddan,
      f.crop_type,
      f.crop_name,
      f.center_code,
      f.rent_per_feddan,
      COALESCE(cc.name_ar, cc.name_en) AS center_name
    FROM fields f
    LEFT JOIN cost_centers cc ON cc.code = f.center_code AND cc.company_id = f.company_id
    WHERE f.company_id = ? AND f.season_id = ? ${fieldFilter}
    ORDER BY f.id
  `).bind(...fieldBindBase).all<{
    id: number; code: string; field_name: string
    area_feddan: number; crop_type: string | null; crop_name: string | null
    center_code: number | null; rent_per_feddan: number | null; center_name: string | null
  }>()

  if (!fields.length) {
    return c.json({ success: true, data: { season: seasonRow, fields: [], summary: null } })
  }

  const fieldIds = fields.map(f => f.id)
  const fieldPlaceholders = fieldIds.map(() => '?').join(',')
  const fieldBinds: unknown[] = [company_id, ...fieldIds]

  // ── 2. GL costs per field (primary source) ────────────────────────────────
  const { results: glCosts } = await c.env.DB.prepare(`
    SELECT
      jl.field_id,
      SUM(CASE WHEN coa.account_type = 'expense'   THEN jl.debit - jl.credit ELSE 0 END) AS gl_expense,
      SUM(CASE WHEN coa.account_type = 'asset'     THEN jl.debit - jl.credit ELSE 0 END) AS gl_asset,
      SUM(CASE WHEN coa.account_type = 'revenue'   THEN jl.credit - jl.debit ELSE 0 END) AS gl_revenue,
      -- Source breakdown for cost auditing
      SUM(CASE WHEN jl.source_ledger = 'cash'      AND coa.account_type = 'expense' THEN jl.debit ELSE 0 END) AS gl_cash_cost,
      SUM(CASE WHEN jl.source_ledger = 'supplier'  AND coa.account_type = 'expense' THEN jl.debit ELSE 0 END) AS gl_supplier_cost,
      SUM(CASE WHEN jl.source_ledger = 'inventory' AND coa.account_type = 'expense' THEN jl.debit ELSE 0 END) AS gl_inventory_cost,
      SUM(CASE WHEN jl.source_ledger = 'manual'    AND coa.account_type = 'expense' THEN jl.debit ELSE 0 END) AS gl_manual_cost,
      COUNT(DISTINCT jl.entry_id) AS gl_entry_count
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
    JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
    WHERE jl.company_id = ? AND jl.field_id IN (${fieldPlaceholders})
      AND coa.account_type IN ('expense', 'asset', 'revenue')
    GROUP BY jl.field_id
  `).bind(...fieldBinds).all<{
    field_id: number
    gl_expense: number; gl_asset: number; gl_revenue: number
    gl_cash_cost: number; gl_supplier_cost: number; gl_inventory_cost: number; gl_manual_cost: number
    gl_entry_count: number
  }>()

  // ── 3. Ops cost components per field (annotation / fallback) ─────────────
  const opsBinds: unknown[] = [company_id, seasonId, ...fieldIds]

  const [invCosts, laborCosts, equipCosts, cashCosts, contractRevenue] = await Promise.all([
    // Inventory issued to field
    c.env.DB.prepare(`
      SELECT field_id, SUM(value_out) AS inv_cost, SUM(qty_out) AS qty_out
      FROM inventory_movements
      WHERE company_id = ? AND season_id = ?
        AND movement_type IN ('صرف', 'ISSUE')
        AND field_id IN (${fieldPlaceholders})
      GROUP BY field_id
    `).bind(...opsBinds).all<{ field_id: number; inv_cost: number; qty_out: number }>(),

    // Work task labour costs
    c.env.DB.prepare(`
      SELECT wo.field_id,
             SUM(wt.quantity * wt.unit_cost) AS labor_cost,
             COUNT(DISTINCT wo.id)           AS wo_count
      FROM work_tasks wt
      JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
      WHERE wo.company_id = ? AND wo.season_id = ?
        AND wo.field_id IN (${fieldPlaceholders})
      GROUP BY wo.field_id
    `).bind(...opsBinds).all<{ field_id: number; labor_cost: number; wo_count: number }>(),

    // Equipment costs on work orders
    c.env.DB.prepare(`
      SELECT wo.field_id,
             SUM(woe.total_cost) AS equipment_cost,
             SUM(woe.hours_worked) AS total_hours
      FROM work_order_equipment woe
      JOIN work_orders wo ON wo.id = woe.work_order_id AND wo.company_id = woe.company_id
      WHERE wo.company_id = ? AND wo.season_id = ?
        AND wo.field_id IN (${fieldPlaceholders})
      GROUP BY wo.field_id
    `).bind(...opsBinds).all<{ field_id: number; equipment_cost: number; total_hours: number }>(),

    // Direct cash outflows tagged to field
    c.env.DB.prepare(`
      SELECT field_id, SUM(amount) AS cash_cost, COUNT(*) AS tx_count
      FROM cash_transactions
      WHERE company_id = ? AND season_id = ?
        AND direction = 'م' AND status = 'posted'
        AND field_id IN (${fieldPlaceholders})
      GROUP BY field_id
    `).bind(...opsBinds).all<{ field_id: number; cash_cost: number; tx_count: number }>(),

    // Sales contract revenue per field (ops revenue truth)
    c.env.DB.prepare(`
      SELECT field_id,
             SUM(quantity_ton * unit_price) AS contract_revenue,
             SUM(advance_paid)              AS advance_collected,
             COUNT(*)                       AS contract_count
      FROM sales_contracts
      WHERE company_id = ? AND season_id = ?
        AND status NOT IN ('cancelled', 'draft')
        AND field_id IN (${fieldPlaceholders})
      GROUP BY field_id
    `).bind(...opsBinds).all<{
      field_id: number; contract_revenue: number
      advance_collected: number; contract_count: number
    }>(),
  ])

  // ── 4. Build lookup maps ──────────────────────────────────────────────────
  const glMap   = new Map(glCosts.map(r => [r.field_id, r]))
  const invMap  = new Map(invCosts.results.map(r => [r.field_id, r]))
  const labMap  = new Map(laborCosts.results.map(r => [r.field_id, r]))
  const eqMap   = new Map(equipCosts.results.map(r => [r.field_id, r]))
  const cashMap = new Map(cashCosts.results.map(r => [r.field_id, r]))
  const revMap  = new Map(contractRevenue.results.map(r => [r.field_id, r]))

  // ── 5. Enrich each field ──────────────────────────────────────────────────
  const enriched = fields.map(f => {
    const gl   = glMap.get(f.id)
    const inv  = invMap.get(f.id)
    const lab  = labMap.get(f.id)
    const eq   = eqMap.get(f.id)
    const cash = cashMap.get(f.id)
    const rev  = revMap.get(f.id)

    // Land rent is a direct field attribute (rent_per_feddan × area_feddan)
    const land_rent = (f.rent_per_feddan ?? 0) * (f.area_feddan ?? 0)

    // Ops cost components (always populated — may be zero)
    const ops_inv_cost       = inv?.inv_cost       ?? 0
    const ops_labor_cost     = lab?.labor_cost     ?? 0
    const ops_equipment_cost = eq?.equipment_cost  ?? 0
    const ops_cash_cost      = cash?.cash_cost     ?? 0
    const ops_total_cost     = ops_inv_cost + ops_labor_cost + ops_equipment_cost + ops_cash_cost + land_rent

    const ops_revenue = rev?.contract_revenue ?? 0

    // GL totals (authoritative when available)
    const gl_total_cost    = gl ? (gl.gl_expense + gl.gl_asset) : null
    const gl_total_revenue = gl?.gl_revenue ?? null

    // Primary values: prefer GL, fallback to ops
    const total_cost    = gl_total_cost    ?? ops_total_cost
    const total_revenue = gl_total_revenue ?? ops_revenue
    const margin        = total_revenue - total_cost
    const area          = f.area_feddan ?? 0

    return {
      field_id:            f.id,
      field_code:          f.code,
      field_name:          f.field_name,
      area_feddan:         area,
      crop_type:           f.crop_type,
      crop_name:           f.crop_name,
      center_code:         f.center_code,
      center_name:         f.center_name,

      // Primary metrics (GL-first, ops fallback)
      total_cost,
      total_revenue,
      margin,
      cost_per_feddan:     area > 0 ? Math.round((total_cost    / area) * 100) / 100 : null,
      revenue_per_feddan:  area > 0 ? Math.round((total_revenue / area) * 100) / 100 : null,
      margin_per_feddan:   area > 0 ? Math.round((margin        / area) * 100) / 100 : null,
      margin_pct:          total_revenue > 0 ? Math.round((margin / total_revenue) * 1000) / 10 : null,

      // Cost source indicator
      cost_source: gl ? 'gl' : 'ops_fallback',

      // GL detail (null when no GL lines exist for this field)
      gl: gl ? {
        expense:        gl.gl_expense,
        asset:          gl.gl_asset,
        revenue:        gl.gl_revenue,
        entry_count:    gl.gl_entry_count,
        by_source: {
          cash:       gl.gl_cash_cost,
          supplier:   gl.gl_supplier_cost,
          inventory:  gl.gl_inventory_cost,
          manual:     gl.gl_manual_cost,
        },
      } : null,

      // Ops components (always returned for audit/gap analysis)
      ops: {
        inventory:       ops_inv_cost,
        labor:           ops_labor_cost,
        equipment:       ops_equipment_cost,
        cash_out:        ops_cash_cost,
        land_rent,
        total:           ops_total_cost,
        revenue:         ops_revenue,
        advance_collected: rev?.advance_collected ?? 0,
        contract_count:    rev?.contract_count    ?? 0,
        inventory_qty_out: inv?.qty_out           ?? 0,
        work_order_count:  lab?.wo_count          ?? 0,
        equipment_hours:   eq?.total_hours        ?? 0,
        cash_tx_count:     cash?.tx_count         ?? 0,
      },

      // GL vs ops gap (zero when GL fully covers ops)
      gl_gap: gl ? {
        cost_gap:    Math.max(0, ops_total_cost - (gl.gl_expense + gl.gl_asset)),
        revenue_gap: Math.max(0, ops_revenue   - gl.gl_revenue),
      } : {
        cost_gap:    ops_total_cost,  // entire ops amount unposted
        revenue_gap: ops_revenue,
      },
    }
  })

  // ── 6. Sort ───────────────────────────────────────────────────────────────
  const sorted = [...enriched].sort((a, b) => {
    const av = a[sortCol as keyof typeof a] as number | null
    const bv = b[sortCol as keyof typeof b] as number | null
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return (bv as number) - (av as number)
  })

  // ── 7. Season rollup summary ──────────────────────────────────────────────
  const totalArea    = enriched.reduce((s, f) => s + (f.area_feddan ?? 0), 0)
  const totalCost    = enriched.reduce((s, f) => s + f.total_cost, 0)
  const totalRevenue = enriched.reduce((s, f) => s + f.total_revenue, 0)
  const totalMargin  = totalRevenue - totalCost

  const glCoveredCount   = enriched.filter(f => f.cost_source === 'gl').length
  const opsFallbackCount = enriched.length - glCoveredCount

  const summary = {
    field_count:        enriched.length,
    total_area_feddan:  totalArea,
    total_cost:         totalCost,
    total_revenue:      totalRevenue,
    total_margin:       totalMargin,
    cost_per_feddan:    totalArea > 0 ? Math.round((totalCost    / totalArea) * 100) / 100 : null,
    revenue_per_feddan: totalArea > 0 ? Math.round((totalRevenue / totalArea) * 100) / 100 : null,
    margin_per_feddan:  totalArea > 0 ? Math.round((totalMargin  / totalArea) * 100) / 100 : null,
    margin_pct:         totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 1000) / 10 : null,
    gl_coverage: {
      gl_covered_fields:    glCoveredCount,
      ops_fallback_fields:  opsFallbackCount,
      coverage_pct:         enriched.length > 0
        ? Math.round((glCoveredCount / enriched.length) * 1000) / 10
        : 100,
    },
  }

  return c.json({
    success: true,
    data: {
      season: seasonRow,
      fields: sorted,
      summary,
      sort_applied: sortCol,
    },
  })
})

export default costPerFeddan
