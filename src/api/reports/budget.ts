import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const budget = new Hono<{ Bindings: Env }>()

budget.get('/budget-vs-actual', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = Number(c.req.query('season_id'))
  if (!seasonId) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const [season, fieldRows] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM seasons WHERE id = ? AND company_id = ?')
      .bind(seasonId, company_id).first(),

    c.env.DB.prepare(`
      SELECT
        f.id, f.code, f.name AS field_name, f.area_feddan, f.crop_type,
        COALESCE(b.budget_per_feddan, 0)                                                       AS budget_per_feddan,
        COALESCE(b.budget_per_feddan, 0) * f.area_feddan                                       AS budget_total,
        COALESCE(inv.inv_cost,   0)                                                            AS inv_cost,
        COALESCE(lab.labor_cost, 0)                                                            AS labor_cost,
        COALESCE(csh.cash_cost,  0)                                                            AS cash_cost,
        COALESCE(inv.inv_cost, 0) + COALESCE(lab.labor_cost, 0) + COALESCE(csh.cash_cost, 0)  AS actual_total,
        CASE WHEN f.area_feddan > 0
          THEN (COALESCE(inv.inv_cost, 0) + COALESCE(lab.labor_cost, 0) + COALESCE(csh.cash_cost, 0)) / f.area_feddan
          ELSE 0 END                                                                           AS actual_per_feddan
      FROM fields f
      LEFT JOIN field_season_budgets b ON b.field_id = f.id AND b.season_id = ?
      LEFT JOIN (
        SELECT field_id, SUM(value_out) AS inv_cost
        FROM inventory_movements
        WHERE company_id = ? AND season_id = ? AND movement_type = 'صرف'
          AND field_id IS NOT NULL
        GROUP BY field_id
      ) inv ON inv.field_id = f.id
      LEFT JOIN (
        SELECT wo.field_id, SUM(wt.quantity * wt.unit_cost) AS labor_cost
        FROM work_tasks wt
        JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
        WHERE wo.company_id = ? AND wo.season_id = ? AND wo.field_id IS NOT NULL
        GROUP BY wo.field_id
      ) lab ON lab.field_id = f.id
      LEFT JOIN (
        SELECT field_id, SUM(amount) AS cash_cost
        FROM cash_transactions
        WHERE company_id = ? AND season_id = ? AND direction = 'م'
          AND field_id IS NOT NULL AND status = 'posted'
        GROUP BY field_id
      ) csh ON csh.field_id = f.id
      WHERE f.company_id = ? AND f.season_id = ?
      ORDER BY actual_total DESC
    `).bind(seasonId, company_id, seasonId, company_id, seasonId, company_id, seasonId, company_id, seasonId).all<{
      id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
      budget_per_feddan: number; budget_total: number
      inv_cost: number; labor_cost: number; cash_cost: number; actual_total: number; actual_per_feddan: number
    }>(),
  ])

  if (!season) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  const rows = fieldRows.results.map(r => {
    const variance    = r.actual_total - r.budget_total
    const variancePct = r.budget_total > 0
      ? Math.round((variance / r.budget_total) * 1000) / 10 : null
    const utilization = r.budget_total > 0
      ? Math.round((r.actual_total / r.budget_total) * 1000) / 10 : null
    const status      = r.budget_total === 0  ? 'no_budget'
      : r.actual_total >= r.budget_total      ? 'over_budget'
      : (utilization ?? 0) >= 80             ? 'at_risk'
      : 'on_track'
    return { ...r, variance, variance_pct: variancePct, utilization_pct: utilization, status }
  })

  const totalBudget       = rows.reduce((s, r) => s + r.budget_total,  0)
  const totalActual       = rows.reduce((s, r) => s + r.actual_total,  0)
  const totalVariance     = totalActual - totalBudget
  const budgetedFields    = rows.filter(r => r.budget_total > 0).length
  const overBudgetCount   = rows.filter(r => r.status === 'over_budget').length
  const utilizationPct    = totalBudget > 0
    ? Math.round((totalActual / totalBudget) * 1000) / 10 : null

  return c.json({
    success: true,
    data: {
      season,
      totals: {
        budget:           totalBudget,
        actual:           totalActual,
        variance:         totalVariance,
        variance_pct:     totalBudget > 0 ? Math.round((totalVariance / totalBudget) * 1000) / 10 : null,
        utilization_pct:  utilizationPct,
        budgeted_fields:  budgetedFields,
        over_budget_count: overBudgetCount,
        total_fields:     rows.length,
      },
      rows,
    },
  })
})

export default budget
