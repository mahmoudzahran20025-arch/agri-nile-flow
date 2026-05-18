import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'

const analytics = new Hono<{ Bindings: Env }>()

analytics.get('/cost-by-field', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id')

  const sn = seasonId ? Number(seasonId) : null
  const seasonFilter    = sn ? 'AND f.season_id = ?' : ''
  const subSeasonFilter = sn ? 'AND wo.season_id = ?' : ''
  const cashSeasonFilter= sn ? 'AND season_id = ?' : ''
  const supSeasonFilter = sn ? 'AND st.season_id = ?' : ''

  // Build bind arrays for each subquery independently so the count is unambiguous
  const mainBinds: unknown[] = [company_id]
  if (sn) mainBinds.push(sn)

  const labBinds:  unknown[] = [company_id]; if (sn) labBinds.push(sn)
  const eqBinds:   unknown[] = [company_id]; if (sn) eqBinds.push(sn)
  const cashBinds: unknown[] = [company_id]; if (sn) cashBinds.push(sn)
  const supBinds:  unknown[] = [company_id]; if (sn) supBinds.push(sn)
  const fsbBinds:  unknown[] = [company_id, company_id]; if (sn) fsbBinds.push(sn)
  // WIP ledger: net balance per field via crop_cycles.field_id
  const wipSeasonFilter = sn ? 'AND cc.season_id = ?' : ''
  const wipBinds: unknown[] = [company_id]; if (sn) wipBinds.push(sn)

  const { results } = await c.env.DB.prepare(
    `SELECT
       f.id, f.code, f.name AS field_name, f.area_feddan, f.crop_type,
       f.season_id,
       s.name AS season_name,
       -- Inventory issues
       COALESCE(SUM(CASE WHEN im.movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS') THEN im.value_out ELSE 0 END), 0) AS total_consumed,
       COALESCE(SUM(CASE WHEN im.movement_type IN ('GRN','TRANSFER_IN','RETURN_CUSTOMER','PRODUCTION_OUTPUT','ADJUSTMENT_PROFIT') THEN im.value_in ELSE 0 END), 0)  AS total_added,
       COUNT(DISTINCT CASE WHEN im.movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS') THEN im.item_code END)          AS items_consumed,
       -- Labor + equipment + direct cash costs + unlinked supplier costs
       COALESCE(lab.labor_cost,    0) AS labor_cost,
       COALESCE(eq.equipment_cost, 0) AS equipment_cost,
       COALESCE(cash.cash_cost,    0) AS cash_cost,
       COALESCE(sup.supplier_cost, 0) AS supplier_cost,
       COALESCE(wip.wip_balance,   0) AS wip_cost,
       COALESCE(wip.active_cycles, 0) AS active_cycle_count,
       -- Total and per-feddan (all 5 cost types)
       COALESCE(SUM(CASE WHEN im.movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS') THEN im.value_out ELSE 0 END), 0)
         + COALESCE(lab.labor_cost, 0) + COALESCE(eq.equipment_cost, 0) + COALESCE(cash.cash_cost, 0) + COALESCE(sup.supplier_cost, 0) AS total_cost,
       CASE WHEN f.area_feddan > 0
            THEN (
              COALESCE(SUM(CASE WHEN im.movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS') THEN im.value_out ELSE 0 END), 0)
              + COALESCE(lab.labor_cost, 0) + COALESCE(eq.equipment_cost, 0) + COALESCE(cash.cash_cost, 0) + COALESCE(sup.supplier_cost, 0)
            ) / f.area_feddan
            ELSE NULL END AS cost_per_feddan,
       fsb.id AS budget_id,
       fsb.budget_per_feddan,
       CASE
         WHEN fsb.budget_per_feddan IS NULL OR fsb.budget_per_feddan = 0 OR f.area_feddan = 0 THEN NULL
         ELSE ROUND((
           (COALESCE(SUM(CASE WHEN im.movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS') THEN im.value_out ELSE 0 END), 0)
             + COALESCE(lab.labor_cost, 0) + COALESCE(eq.equipment_cost, 0) + COALESCE(cash.cash_cost, 0) + COALESCE(sup.supplier_cost, 0)
           ) / f.area_feddan - fsb.budget_per_feddan
         ) * 100.0 / fsb.budget_per_feddan, 1)
       END AS variance_pct
     FROM fields f
     LEFT JOIN seasons s ON s.id = f.season_id
     LEFT JOIN inventory_movements im ON im.field_id = f.id AND im.company_id = ?
     LEFT JOIN (
       SELECT wo.field_id, SUM(wt.quantity * wt.unit_cost) AS labor_cost
       FROM work_tasks wt JOIN work_orders wo ON wo.id=wt.work_order_id AND wo.company_id=wt.company_id
       WHERE wo.company_id=? AND wo.field_id IS NOT NULL ${subSeasonFilter}
       GROUP BY wo.field_id
     ) lab ON lab.field_id = f.id
     LEFT JOIN (
       SELECT wo.field_id, SUM(woe.total_cost) AS equipment_cost
       FROM work_order_equipment woe
       JOIN work_orders wo ON wo.id=woe.work_order_id AND wo.company_id=woe.company_id
       WHERE wo.company_id=? AND wo.field_id IS NOT NULL ${subSeasonFilter}
       GROUP BY wo.field_id
     ) eq ON eq.field_id = f.id
     LEFT JOIN (
       SELECT field_id, SUM(amount) AS cash_cost
       FROM cash_transactions
       WHERE company_id=? AND direction='م' AND status='posted' AND field_id IS NOT NULL ${cashSeasonFilter}
       GROUP BY field_id
     ) cash ON cash.field_id = f.id
     LEFT JOIN (
       SELECT f.id AS field_id, SUM(st.amount) AS supplier_cost
       FROM supplier_transactions st
       JOIN fields f ON f.center_code = st.center_code AND f.company_id = st.company_id
       WHERE st.company_id=? AND st.entry_type='د' AND st.status='posted' AND st.work_order_id IS NULL ${supSeasonFilter}
       GROUP BY f.id
     ) sup ON sup.field_id = f.id
     LEFT JOIN (
       SELECT cc.field_id,
              SUM(wl.debit - wl.credit) AS wip_balance,
              COUNT(DISTINCT cc.id)     AS active_cycles
       FROM crop_cycles cc
       JOIN wip_ledger wl ON wl.crop_cycle_id = cc.id AND wl.company_id = cc.company_id
       WHERE cc.company_id = ? AND cc.status = 'active' ${wipSeasonFilter}
       GROUP BY cc.field_id
     ) wip ON wip.field_id = f.id
     LEFT JOIN field_season_budgets fsb
            ON fsb.field_id = f.id AND fsb.company_id = f.company_id
               AND fsb.season_id = f.season_id
     WHERE f.company_id = ? ${seasonFilter}
     GROUP BY f.id
     ORDER BY
       CASE WHEN fsb.budget_per_feddan IS NOT NULL THEN 0 ELSE 1 END,
       variance_pct DESC,
       total_cost DESC`
  ).bind(company_id, ...labBinds, ...eqBinds, ...cashBinds, ...supBinds, ...wipBinds, ...fsbBinds).all()

  return c.json({ success: true, data: results })
})

analytics.get('/reorder-alerts', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  // Use inventory_balances (snapshot table) for authoritative current stock — never balance_qty
  // on inventory_movements rows which is a stale per-row field.
  const { results } = await c.env.DB.prepare(`
    WITH aggregated_balance AS (
      SELECT item_code, SUM(balance_qty) AS balance_qty
      FROM inventory_balances
      WHERE company_id = ?
      GROUP BY item_code
    ),
    active_consumption AS (
      SELECT im.item_code, SUM(im.qty_out) AS consumed_qty
      FROM inventory_movements im
      JOIN work_orders wo ON wo.id = im.work_order_id AND wo.company_id = im.company_id
      WHERE im.company_id = ?
        AND im.movement_type IN ('ISSUE', 'TRANSFER_OUT', 'COGS_ADJUSTMENT', 'PRODUCTION_INPUT', 'ADJUSTMENT_LOSS')
        AND wo.status IN ('pending', 'in_progress', 'done')
      GROUP BY im.item_code
    )
    SELECT
      ab.item_code,
      i.name     AS item_name,
      i.unit,
      ab.balance_qty  AS current_balance,
      ac.consumed_qty AS consumed_active_orders,
      ROUND(ac.consumed_qty * 100.0 / NULLIF(ab.balance_qty, 0), 1) AS consumption_pct,
      (SELECT COUNT(DISTINCT wo2.id)
       FROM inventory_movements im2
       JOIN work_orders wo2 ON wo2.id = im2.work_order_id AND wo2.company_id = im2.company_id
       WHERE im2.item_code = ab.item_code AND im2.company_id = ?
        AND im2.movement_type IN ('ISSUE', 'TRANSFER_OUT', 'COGS_ADJUSTMENT', 'PRODUCTION_INPUT', 'ADJUSTMENT_LOSS')
         AND wo2.status IN ('pending', 'in_progress', 'done')
      ) AS active_order_count
    FROM aggregated_balance ab
    JOIN active_consumption ac ON ac.item_code = ab.item_code
    JOIN items i ON i.code = ab.item_code AND i.company_id = ?
    WHERE ab.balance_qty > 0
      AND ac.consumed_qty >= ab.balance_qty * 0.8
    ORDER BY consumption_pct DESC
  `).bind(company_id, company_id, company_id, company_id).all()

  return c.json({ success: true, data: results })
})

export default analytics
