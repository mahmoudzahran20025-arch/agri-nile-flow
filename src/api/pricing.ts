/**
 * pricing.ts — Layered pricing engine
 *
 * Routes:
 *   GET  /api/pricing/resolve          — resolve effective price for item+branch+customer+qty
 *   GET  /api/pricing/branch-overrides  — list branch price overrides
 *   POST /api/pricing/branch-overrides  — create/update branch price override
 *   DELETE /api/pricing/branch-overrides/:id
 *   GET  /api/pricing/promotions        — list promotions
 *   POST /api/pricing/promotions        — create promotion
 *   PATCH /api/pricing/promotions/:id   — update promotion
 *   DELETE /api/pricing/promotions/:id
 *   GET  /api/pricing/tiers             — list customer price tiers
 *   POST /api/pricing/tiers             — create tier
 *   PATCH /api/pricing/tiers/:id        — update tier
 *   DELETE /api/pricing/tiers/:id
 *
 * Price resolution order (see migration 0154 for full documentation):
 *   promotion → tier discount → branch override → list_price
 *   min_selling_price is always the floor.
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { getUser, permissionGuard } from '../middleware/auth'

const pricing = new Hono<{ Bindings: Env }>()

// ── GET /resolve ──────────────────────────────────────────────────────────────
pricing.get('/resolve', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const itemCode  = Number(c.req.query('item_code'))
  const branchId  = c.req.query('branch_id')  ? Number(c.req.query('branch_id'))  : null
  const customerId = c.req.query('customer_id') ? Number(c.req.query('customer_id')) : null
  const qty       = c.req.query('qty')         ? Number(c.req.query('qty'))         : 1
  const dateStr   = c.req.query('date') ?? new Date().toISOString().slice(0, 10)

  if (!itemCode) return c.json({ success: false, error: 'item_code مطلوب' }, 400)

  const item = await c.env.DB.prepare(
    'SELECT list_price, min_selling_price FROM items WHERE code = ? AND company_id = ?'
  ).bind(itemCode, company_id).first<{ list_price: number | null; min_selling_price: number | null }>()
  if (!item) return c.json({ success: false, error: 'الصنف غير موجود' }, 404)

  let resolvedPrice: number = item.list_price ?? 0
  let priceSource: string = 'list_price'

  // 1. Branch override
  if (branchId) {
    const override = await c.env.DB.prepare(
      'SELECT price FROM branch_price_overrides WHERE company_id = ? AND branch_id = ? AND item_code = ? AND is_active = 1'
    ).bind(company_id, branchId, itemCode).first<{ price: number }>()
    if (override) {
      resolvedPrice = override.price
      priceSource = 'branch_override'
    }
  }

  // 2. Customer tier discount
  let tierDiscount = 0
  if (customerId) {
    const tierRow = await c.env.DB.prepare(
      `SELECT cpt.discount_pct FROM customers cu
       JOIN customer_price_tiers cpt ON cpt.id = cu.tier_id AND cpt.company_id = cu.company_id
       WHERE cu.id = ? AND cu.company_id = ? AND cpt.is_active = 1`
    ).bind(customerId, company_id).first<{ discount_pct: number }>()
    if (tierRow) {
      tierDiscount = tierRow.discount_pct
    }
  }

  // 3. Active promotion (most specific wins: item+branch > item-only > branch-only > global)
  const promoBinds: unknown[] = [company_id, dateStr, dateStr, dateStr, dateStr]
  const promo = await c.env.DB.prepare(
    `SELECT id, name, promo_type, discount_value, item_code, branch_id
     FROM promotions
     WHERE company_id = ?
       AND is_active = 1
       AND (start_date IS NULL OR start_date <= ?)
       AND (end_date   IS NULL OR end_date   >= ?)
       AND (min_qty    IS NULL OR min_qty    <= ?)
       AND (item_code  IS NULL OR item_code  = ?)
       ${branchId ? 'AND (branch_id IS NULL OR branch_id = ?)' : 'AND branch_id IS NULL'}
     ORDER BY
       (CASE WHEN item_code IS NOT NULL THEN 2 ELSE 0 END) +
       (CASE WHEN branch_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
       id DESC
     LIMIT 1`
  ).bind(...promoBinds, ...(branchId ? [itemCode, branchId] : [itemCode]))
    .first<{ id: number; name: string; promo_type: string; discount_value: number; item_code: number | null; branch_id: number | null }>()

  let promoDiscount = 0
  if (promo) {
    if (promo.promo_type === 'percent') {
      promoDiscount = resolvedPrice * (promo.discount_value / 100)
    } else {
      promoDiscount = promo.discount_value
    }
    priceSource = 'promotion'
  }

  // 4. Apply discounts
  const tierAmount  = resolvedPrice * (tierDiscount / 100)
  const finalPrice  = Math.max(
    resolvedPrice - promoDiscount - tierAmount,
    item.min_selling_price ?? 0,
  )
  const finalRounded = Math.round(finalPrice * 100) / 100

  return c.json({
    success: true,
    data: {
      item_code:          itemCode,
      branch_id:          branchId,
      customer_id:        customerId,
      qty,
      date:               dateStr,
      base_price:         item.list_price ?? 0,
      resolved_price:     resolvedPrice,
      promo_discount:     Math.round(promoDiscount * 100) / 100,
      tier_discount_pct:  tierDiscount,
      tier_discount_amt:  Math.round(tierAmount * 100) / 100,
      final_price:        finalRounded,
      min_selling_price:  item.min_selling_price,
      price_source:       priceSource,
      promotion:          promo ? { id: promo.id, name: promo.name } : null,
    },
  })
})

// ── Branch price overrides ────────────────────────────────────────────────────
pricing.get('/branch-overrides', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const branchId = c.req.query('branch_id') ? Number(c.req.query('branch_id')) : null

  const rows = await c.env.DB.prepare(
    `SELECT bpo.*, i.name AS item_name
     FROM branch_price_overrides bpo
     LEFT JOIN items i ON i.code = bpo.item_code AND i.company_id = bpo.company_id
     WHERE bpo.company_id = ?
       ${branchId ? 'AND bpo.branch_id = ?' : ''}
     ORDER BY bpo.branch_id, bpo.item_code`
  ).bind(...[company_id, ...(branchId ? [branchId] : [])]).all()

  return c.json({ success: true, data: rows.results })
})

pricing.post('/branch-overrides', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ branch_id: number; item_code: number; price: number }>()

  if (!b.branch_id || !b.item_code || b.price == null || b.price < 0) {
    return c.json({ success: false, error: 'branch_id وitem_code وprice (≥ 0) مطلوبة' }, 400)
  }

  await c.env.DB.prepare(
    `INSERT INTO branch_price_overrides (company_id, branch_id, item_code, price)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id, branch_id, item_code) DO UPDATE SET
       price = excluded.price, is_active = 1, updated_at = datetime('now')`
  ).bind(company_id, b.branch_id, b.item_code, b.price).run()

  return c.json({ success: true }, 201)
})

pricing.delete('/branch-overrides/:id', permissionGuard('inventory', 'update'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    "UPDATE branch_price_overrides SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND company_id = ?"
  ).bind(id, company_id).run()
  return c.json({ success: true })
})

// ── Promotions ────────────────────────────────────────────────────────────────
pricing.get('/promotions', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const active = c.req.query('active')
  const where = active === '1' ? 'AND is_active = 1' : ''
  const rows = await c.env.DB.prepare(
    `SELECT * FROM promotions WHERE company_id = ? ${where} ORDER BY start_date DESC, id DESC`
  ).bind(company_id).all()
  return c.json({ success: true, data: rows.results })
})

pricing.post('/promotions', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{
    name: string
    promo_type: 'percent' | 'fixed_amount'
    discount_value: number
    item_code?: number
    branch_id?: number
    start_date?: string
    end_date?: string
    min_qty?: number
  }>()

  if (!b.name || !b.promo_type || !b.discount_value) {
    return c.json({ success: false, error: 'name وpromo_type وdiscount_value مطلوبة' }, 400)
  }
  if (!['percent', 'fixed_amount'].includes(b.promo_type)) {
    return c.json({ success: false, error: 'promo_type يجب أن يكون percent أو fixed_amount' }, 400)
  }
  if (b.promo_type === 'percent' && b.discount_value >= 100) {
    return c.json({ success: false, error: 'نسبة الخصم يجب أن تكون أقل من 100%' }, 400)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO promotions (company_id, name, promo_type, discount_value, item_code, branch_id, start_date, end_date, min_qty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  ).bind(
    company_id, b.name, b.promo_type, b.discount_value,
    b.item_code ?? null, b.branch_id ?? null,
    b.start_date ?? null, b.end_date ?? null, b.min_qty ?? null,
  ).first<{ id: number }>()

  return c.json({ success: true, data: { id: result?.id } }, 201)
})

pricing.patch('/promotions/:id', permissionGuard('inventory', 'update'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{
    name?: string; promo_type?: 'percent' | 'fixed_amount'; discount_value?: number
    item_code?: number | null; branch_id?: number | null
    start_date?: string | null; end_date?: string | null; min_qty?: number | null
    is_active?: boolean
  }>()

  const sets: string[] = []
  const binds: unknown[] = []
  if ('name'           in b) { sets.push('name = ?');           binds.push(b.name) }
  if ('promo_type'     in b) { sets.push('promo_type = ?');     binds.push(b.promo_type) }
  if ('discount_value' in b) { sets.push('discount_value = ?'); binds.push(b.discount_value) }
  if ('item_code'      in b) { sets.push('item_code = ?');      binds.push(b.item_code ?? null) }
  if ('branch_id'      in b) { sets.push('branch_id = ?');      binds.push(b.branch_id ?? null) }
  if ('start_date'     in b) { sets.push('start_date = ?');     binds.push(b.start_date ?? null) }
  if ('end_date'       in b) { sets.push('end_date = ?');       binds.push(b.end_date ?? null) }
  if ('min_qty'        in b) { sets.push('min_qty = ?');        binds.push(b.min_qty ?? null) }
  if ('is_active'      in b) { sets.push('is_active = ?');      binds.push(b.is_active ? 1 : 0) }

  if (sets.length === 0) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)
  sets.push("updated_at = datetime('now')")
  binds.push(id, company_id)

  const r = await c.env.DB.prepare(
    `UPDATE promotions SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...binds).run()
  if (!r.meta.changes) return c.json({ success: false, error: 'العرض غير موجود' }, 404)
  return c.json({ success: true })
})

pricing.delete('/promotions/:id', permissionGuard('inventory', 'update'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    "UPDATE promotions SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND company_id = ?"
  ).bind(id, company_id).run()
  return c.json({ success: true })
})

// ── Customer price tiers ──────────────────────────────────────────────────────
pricing.get('/tiers', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const rows = await c.env.DB.prepare(
    'SELECT * FROM customer_price_tiers WHERE company_id = ? ORDER BY discount_pct DESC'
  ).bind(company_id).all()
  return c.json({ success: true, data: rows.results })
})

pricing.post('/tiers', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ name: string; discount_pct: number }>()

  if (!b.name || b.discount_pct == null || b.discount_pct < 0 || b.discount_pct >= 100) {
    return c.json({ success: false, error: 'name مطلوب وdiscount_pct يجب أن تكون بين 0 و99.99' }, 400)
  }

  const r = await c.env.DB.prepare(
    'INSERT INTO customer_price_tiers (company_id, name, discount_pct) VALUES (?, ?, ?) RETURNING id'
  ).bind(company_id, b.name.trim(), b.discount_pct).first<{ id: number }>()

  return c.json({ success: true, data: { id: r?.id } }, 201)
})

pricing.patch('/tiers/:id', permissionGuard('inventory', 'update'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{ name?: string; discount_pct?: number; is_active?: boolean }>()

  const sets: string[] = []
  const binds: unknown[] = []
  if ('name'         in b) { sets.push('name = ?');         binds.push(b.name?.trim()) }
  if ('discount_pct' in b) { sets.push('discount_pct = ?'); binds.push(b.discount_pct) }
  if ('is_active'    in b) { sets.push('is_active = ?');    binds.push(b.is_active ? 1 : 0) }

  if (sets.length === 0) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)
  binds.push(id, company_id)

  const r = await c.env.DB.prepare(
    `UPDATE customer_price_tiers SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...binds).run()
  if (!r.meta.changes) return c.json({ success: false, error: 'الفئة غير موجودة' }, 404)
  return c.json({ success: true })
})

pricing.delete('/tiers/:id', permissionGuard('inventory', 'update'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    'UPDATE customer_price_tiers SET is_active = 0 WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).run()
  return c.json({ success: true })
})

export default pricing
