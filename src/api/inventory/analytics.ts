import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const analytics = new Hono<{ Bindings: Env }>()

analytics.get('/cost-by-field', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id')

  const binds: unknown[] = [company_id, company_id]
  let seasonFilter = ''
  if (seasonId) {
    seasonFilter = 'AND f.season_id = ?'
    binds.push(Number(seasonId))
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
       f.id, f.code, f.name AS field_name, f.area_feddan, f.crop_type,
       f.season_id,
       s.name AS season_name,
       COALESCE(SUM(CASE WHEN im.movement_type = 'صرف' THEN im.value_out ELSE 0 END), 0) AS total_consumed,
       COALESCE(SUM(CASE WHEN im.movement_type = 'اضافة' THEN im.value_in  ELSE 0 END), 0) AS total_added,
       COUNT(DISTINCT CASE WHEN im.movement_type = 'صرف' THEN im.item_code END)           AS items_consumed,
       CASE WHEN f.area_feddan > 0
            THEN COALESCE(SUM(CASE WHEN im.movement_type = 'صرف' THEN im.value_out ELSE 0 END), 0) / f.area_feddan
            ELSE NULL END AS cost_per_feddan,
       fsb.id          AS budget_id,
       fsb.budget_per_feddan,
       CASE
         WHEN fsb.budget_per_feddan IS NULL OR fsb.budget_per_feddan = 0 OR f.area_feddan = 0 THEN NULL
         ELSE ROUND(
           (
             (COALESCE(SUM(CASE WHEN im.movement_type = 'صرف' THEN im.value_out ELSE 0 END), 0) / f.area_feddan)
             - fsb.budget_per_feddan
           ) * 100.0 / fsb.budget_per_feddan,
           1
         )
       END AS variance_pct
     FROM fields f
     LEFT JOIN seasons s ON s.id = f.season_id
     LEFT JOIN inventory_movements im
            ON im.field_id = f.id AND im.company_id = ?
     LEFT JOIN field_season_budgets fsb
            ON fsb.field_id = f.id AND fsb.company_id = f.company_id
               AND fsb.season_id = f.season_id
     WHERE f.company_id = ? ${seasonFilter}
     GROUP BY f.id
     ORDER BY
       CASE WHEN fsb.budget_per_feddan IS NOT NULL THEN 0 ELSE 1 END,
       variance_pct DESC,
       total_consumed DESC`
  ).bind(...binds).all()

  return c.json({ success: true, data: results })
})

analytics.get('/reorder-alerts', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(`
    WITH last_balance AS (
      SELECT im.item_code, im.balance_qty
      FROM inventory_movements im
      WHERE im.company_id = ?
        AND im.id = (
          SELECT MAX(id) FROM inventory_movements
          WHERE item_code = im.item_code AND company_id = im.company_id
        )
    ),
    active_consumption AS (
      SELECT im.item_code, SUM(im.qty_out) AS consumed_qty
      FROM inventory_movements im
      JOIN work_orders wo ON wo.id = im.work_order_id AND wo.company_id = im.company_id
      WHERE im.company_id = ?
        AND im.movement_type = 'صرف'
        AND wo.status IN ('pending', 'in_progress', 'done')
      GROUP BY im.item_code
    )
    SELECT
      lb.item_code,
      i.name     AS item_name,
      i.unit,
      lb.balance_qty  AS current_balance,
      ac.consumed_qty AS consumed_active_orders,
      ROUND(ac.consumed_qty * 100.0 / lb.balance_qty, 1) AS consumption_pct,
      (SELECT COUNT(DISTINCT wo2.id)
       FROM inventory_movements im2
       JOIN work_orders wo2 ON wo2.id = im2.work_order_id AND wo2.company_id = im2.company_id
       WHERE im2.item_code = lb.item_code AND im2.company_id = ?
         AND im2.movement_type = 'صرف'
         AND wo2.status IN ('pending', 'in_progress', 'done')
      ) AS active_order_count
    FROM last_balance lb
    JOIN active_consumption ac ON ac.item_code = lb.item_code
    JOIN items i ON i.code = lb.item_code AND i.company_id = ?
    WHERE lb.balance_qty > 0
      AND ac.consumed_qty >= lb.balance_qty * 0.8
    ORDER BY consumption_pct DESC
  `).bind(company_id, company_id, company_id, company_id).all()

  return c.json({ success: true, data: results })
})

export default analytics
