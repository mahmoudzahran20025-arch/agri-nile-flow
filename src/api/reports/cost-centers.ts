import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const costCenters = new Hono<{ Bindings: Env }>()

costCenters.get('/cost-centers', async (c) => {
  const { company_id } = getUser(c)
  const rawSeason = c.req.query('season_id')
  const seasonId  = rawSeason ? Number(rawSeason) : null

  const seasonWhere    = seasonId ? 'AND season_id = ?' : ''
  const cashBinds: unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const supBinds:  unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const invSeasonWhere = seasonId ? 'AND f.season_id = ?' : ''
  const invBinds: unknown[] = seasonId ? [company_id, seasonId] : [company_id]

  const cashQ = c.env.DB.prepare(`
    SELECT
      ct.center_code,
      cc.name            AS center_name,
      SUM(ct.amount)     AS cash_total,
      COUNT(ct.id)       AS cash_count
    FROM cash_transactions ct
    LEFT JOIN cost_centers cc ON cc.code = ct.center_code AND cc.company_id = ct.company_id
    WHERE ct.company_id = ?
      AND ct.direction = 'م'
      AND ct.status = 'posted'
      AND ct.center_code IS NOT NULL
      ${seasonWhere}
    GROUP BY ct.center_code
  `).bind(...cashBinds).all<{
    center_code: number; center_name: string | null
    cash_total: number; cash_count: number
  }>()

  const supQ = c.env.DB.prepare(`
    SELECT
      st.center_code,
      cc.name            AS center_name,
      SUM(st.credit)     AS supplier_total,
      COUNT(st.id)       AS supplier_count
    FROM supplier_transactions st
    LEFT JOIN cost_centers cc ON cc.code = st.center_code AND cc.company_id = st.company_id
    WHERE st.company_id = ?
      AND st.status = 'posted'
      AND st.center_code IS NOT NULL
      ${seasonWhere}
    GROUP BY st.center_code
  `).bind(...supBinds).all<{
    center_code: number; center_name: string | null
    supplier_total: number; supplier_count: number
  }>()

  const invQ = c.env.DB.prepare(`
    SELECT
      f.center_code,
      cc.name            AS center_name,
      SUM(im.value_out)  AS inventory_total,
      COUNT(im.id)       AS inventory_count
    FROM inventory_movements im
    JOIN fields f ON f.id = im.field_id AND f.company_id = im.company_id
    LEFT JOIN cost_centers cc ON cc.code = f.center_code AND cc.company_id = f.company_id
    WHERE im.company_id = ?
      AND im.movement_type = 'صرف'
      AND f.center_code IS NOT NULL
      ${invSeasonWhere}
    GROUP BY f.center_code
  `).bind(...invBinds).all<{
    center_code: number; center_name: string | null
    inventory_total: number; inventory_count: number
  }>()

  const [cashRes, supRes, invRes] = await Promise.all([cashQ, supQ, invQ])

  const map = new Map<number, {
    center_code: number; center_name: string | null
    cash_total: number; cash_count: number
    supplier_total: number; supplier_count: number
    inventory_total: number; inventory_count: number
    grand_total: number
  }>()

  for (const r of cashRes.results) {
    map.set(r.center_code, {
      center_code:     r.center_code,
      center_name:     r.center_name,
      cash_total:      r.cash_total ?? 0,
      cash_count:      r.cash_count ?? 0,
      supplier_total:  0,
      supplier_count:  0,
      inventory_total: 0,
      inventory_count: 0,
      grand_total:     r.cash_total ?? 0,
    })
  }

  for (const r of supRes.results) {
    const existing = map.get(r.center_code)
    if (existing) {
      existing.supplier_total  = r.supplier_total ?? 0
      existing.supplier_count  = r.supplier_count ?? 0
      existing.grand_total    += r.supplier_total ?? 0
    } else {
      map.set(r.center_code, {
        center_code:     r.center_code,
        center_name:     r.center_name,
        cash_total:      0,
        cash_count:      0,
        supplier_total:  r.supplier_total ?? 0,
        supplier_count:  r.supplier_count ?? 0,
        inventory_total: 0,
        inventory_count: 0,
        grand_total:     r.supplier_total ?? 0,
      })
    }
  }

  for (const r of invRes.results) {
    const existing = map.get(r.center_code)
    if (existing) {
      existing.inventory_total  = r.inventory_total ?? 0
      existing.inventory_count  = r.inventory_count ?? 0
      existing.grand_total     += r.inventory_total ?? 0
    } else {
      map.set(r.center_code, {
        center_code:     r.center_code,
        center_name:     r.center_name,
        cash_total:      0,
        cash_count:      0,
        supplier_total:  0,
        supplier_count:  0,
        inventory_total: r.inventory_total ?? 0,
        inventory_count: r.inventory_count ?? 0,
        grand_total:     r.inventory_total ?? 0,
      })
    }
  }

  const rows = [...map.values()].sort((a, b) => b.grand_total - a.grand_total)
  const grandTotal = rows.reduce((s, r) => s + r.grand_total, 0)

  return c.json({ success: true, data: rows, grand_total: grandTotal })
})

costCenters.get('/cost-centers/:code/detail', async (c) => {
  const { company_id } = getUser(c)
  const code     = Number(c.req.param('code'))
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  const seasonBind  = seasonId ? [company_id, code, seasonId] : [company_id, code]
  const seasonWhere = seasonId ? 'AND season_id = ?' : ''

  const [cashByCategory, supBySupplier, cashTimeline] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        COALESCE(ct.expense_code, 0)       AS expense_code,
        COALESCE(et.name, 'أخرى')         AS expense_name,
        SUM(ct.amount)                     AS total,
        COUNT(ct.id)                       AS cnt
      FROM cash_transactions ct
      LEFT JOIN expense_types et ON et.code = ct.expense_code AND et.company_id = ct.company_id
      WHERE ct.company_id = ? AND ct.center_code = ? AND ct.direction = 'م' AND ct.status = 'posted'
        ${seasonWhere}
      GROUP BY expense_code
      ORDER BY total DESC
    `).bind(...seasonBind).all(),

    c.env.DB.prepare(`
      SELECT
        st.supplier_code,
        COALESCE(s.name, CAST(st.supplier_code AS TEXT)) AS supplier_name,
        SUM(st.credit)  AS total,
        COUNT(st.id)    AS cnt
      FROM supplier_transactions st
      LEFT JOIN suppliers s ON s.code = st.supplier_code AND s.company_id = st.company_id
      WHERE st.company_id = ? AND st.center_code = ? AND st.status = 'posted'
        ${seasonWhere}
      GROUP BY st.supplier_code
      ORDER BY total DESC
    `).bind(...seasonBind).all(),

    c.env.DB.prepare(`
      SELECT year, month, SUM(amount) AS total
      FROM cash_transactions
      WHERE company_id = ? AND center_code = ? AND direction = 'م' AND status = 'posted'
        ${seasonWhere}
      GROUP BY year, month
      ORDER BY year, month
    `).bind(...seasonBind).all(),
  ])

  return c.json({
    success: true,
    data: {
      cash_by_category:  cashByCategory.results,
      sup_by_supplier:   supBySupplier.results,
      cash_timeline:     cashTimeline.results,
    },
  })
})

export default costCenters
