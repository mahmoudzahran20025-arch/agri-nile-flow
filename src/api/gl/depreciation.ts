import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'
import { FinanceCore } from '../../lib/finance_core'

const depreciation = new Hono<{ Bindings: Env }>()
depreciation.use('*', authMiddleware)

// GET /gl/depreciation/schedule
// Returns fixed assets with their monthly depreciation amount and how many periods remain.
// Open to any authenticated user.
depreciation.get('/depreciation/schedule', async (c) => {
  const { company_id } = getUser(c)

  const { results: assets } = await c.env.DB.prepare(
    `SELECT
       fa.id,
       fa.asset_code,
       fa.name,
       fa.category,
       fa.acquisition_date,
       fa.cost,
       fa.salvage_value,
       fa.useful_life_months,
       fa.depreciation_method,
       fa.center_code,
       cc.name_ar AS center_name,
       fa.field_id,
       f.name  AS field_name,
       fa.season_id,
       fa.is_active,
       -- Months already posted
       (SELECT COUNT(*) FROM depreciation_schedules ds
        WHERE ds.asset_id = fa.id AND ds.company_id = fa.company_id AND ds.status = 'posted') AS posted_months,
       -- Total accumulated posted
       COALESCE((SELECT SUM(ds.amount) FROM depreciation_schedules ds
        WHERE ds.asset_id = fa.id AND ds.company_id = fa.company_id AND ds.status = 'posted'), 0) AS accumulated
     FROM fixed_assets fa
     LEFT JOIN cost_centers cc ON cc.code = fa.center_code AND cc.company_id = fa.company_id
     LEFT JOIN fields f ON f.id = fa.field_id AND f.company_id = fa.company_id
     WHERE fa.company_id = ? AND fa.is_active = 1
     ORDER BY fa.asset_code`
  ).bind(company_id).all<{
    id: number; asset_code: string; name: string; category: string
    acquisition_date: string; cost: number; salvage_value: number | null
    useful_life_months: number; depreciation_method: string
    center_code: number | null; center_name: string | null
    field_id: number | null; field_name: string | null; season_id: number | null
    is_active: number; posted_months: number; accumulated: number
  }>()

  const rows = (assets ?? []).map(a => {
    const depreciable = a.cost - (a.salvage_value ?? 0)
    const monthly_amount = a.useful_life_months > 0
      ? Math.round((depreciable / a.useful_life_months) * 100) / 100
      : 0
    const remaining_months = Math.max(0, a.useful_life_months - a.posted_months)
    const book_value = Math.max(0, a.cost - a.accumulated - (a.salvage_value ?? 0))
    const pct_complete = a.useful_life_months > 0
      ? Math.round((a.posted_months / a.useful_life_months) * 100)
      : 0

    return {
      id: a.id,
      asset_code: a.asset_code,
      name: a.name,
      category: a.category,
      acquisition_date: a.acquisition_date,
      cost: a.cost,
      salvage_value: a.salvage_value ?? 0,
      useful_life_months: a.useful_life_months,
      depreciation_method: a.depreciation_method,
      center_code: a.center_code,
      center_name: a.center_name,
      field_id: a.field_id,
      field_name: a.field_name,
      season_id: a.season_id,
      monthly_amount,
      posted_months: a.posted_months,
      remaining_months,
      accumulated: a.accumulated,
      book_value,
      pct_complete,
      fully_depreciated: remaining_months === 0,
    }
  })

  const total_monthly = rows.reduce((s, r) => s + (r.fully_depreciated ? 0 : r.monthly_amount), 0)

  return c.json({
    success: true,
    data: {
      assets: rows,
      summary: {
        active_assets:      rows.length,
        fully_depreciated:  rows.filter(r => r.fully_depreciated).length,
        pending_assets:     rows.filter(r => !r.fully_depreciated).length,
        total_monthly_charge: Math.round(total_monthly * 100) / 100,
      },
    },
  })
})

// POST /gl/depreciation/run
// Posts monthly depreciation for all active fixed assets for the given period_year / period_month.
// Idempotent: postFromBusinessEvent skips duplicate events; depreciation_schedules UNIQUE ensures no double-posting.
// Requires finance_manager role (company_admin or above).
depreciation.post(
  '/depreciation/run',
  roleGuard(['super_admin', 'company_admin']),
  async (c) => {
    const { company_id, sub: userId } = getUser(c)

    const body = await c.req.json<{ period_year: number; period_month: number }>()

    if (!Number.isInteger(body.period_year) || body.period_year < 2020 || body.period_year > 2100) {
      return c.json({ success: false, error: 'period_year must be a valid integer (2020–2100)' }, 400)
    }
    if (!Number.isInteger(body.period_month) || body.period_month < 1 || body.period_month > 12) {
      return c.json({ success: false, error: 'period_month must be 1–12' }, 400)
    }

    // Guard: reject if fiscal period for this month is already closed
    const periodKey = `${body.period_year}-${String(body.period_month).padStart(2, '0')}`
    const period = await c.env.DB.prepare(
      `SELECT id, status FROM fiscal_periods
       WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND status != 'archived'
       LIMIT 1`
    ).bind(company_id, `${periodKey}-28`, `${periodKey}-01`).first<{ id: number; status: string }>()

    if (period?.status === 'closed') {
      return c.json({
        success: false,
        error: `ERR_PERIOD_CLOSED: الفترة المالية ${periodKey} مغلقة. لا يمكن ترحيل قيود إهلاك جديدة.`,
      }, 409)
    }

    let results: Array<{ asset_id: number; asset_name: string; depreciation_amount: number; entry_id: number | null }>
    try {
      results = await FinanceCore.postMonthlyDepreciation(c.env.DB, {
        company_id,
        period_year:  body.period_year,
        period_month: body.period_month,
        user_id:      userId,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ success: false, error: msg }, 500)
    }

    const posted = results.filter(r => r.entry_id !== null).length
    const skipped = results.length - posted

    void logAudit(c.env.DB, {
      user_id:    userId,
      company_id,
      action:     'CREATE',
      table_name: 'depreciation_schedules',
      record_id:  0,
      new_value:  { period_year: body.period_year, period_month: body.period_month, posted, skipped },
    })

    return c.json({
      success: true,
      data: {
        period_year:  body.period_year,
        period_month: body.period_month,
        total_assets: results.length,
        posted,
        skipped,
        total_charge: Math.round(results.filter(r => r.entry_id !== null).reduce((s, r) => s + r.depreciation_amount, 0) * 100) / 100,
        entries: results,
      },
    })
  },
)

export default depreciation
