import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'
import { logAudit } from '../lib/audit'
import { FinanceCore } from '../lib/finance_core'
import { getTodayIsoDate } from '../lib/utils/date'

const hs = new Hono<{ Bindings: Env }>()
hs.use('*', authMiddleware)
hs.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// ── GET /api/harvest-settlements ─────────────────────────────────────────────
hs.get('/', async (c) => {
  const { company_id } = getUser(c)
  const crop_cycle_id = c.req.query('crop_cycle_id')
  const status        = c.req.query('status')
  const season_id     = c.req.query('season_id')

  let sql = `
    SELECT hs.*,
           cc.crop_name, cc.crop_type, cc.status AS cycle_status,
           f.name AS field_name, f.code AS field_code,
           s.name AS season_name
    FROM harvest_settlements hs
    JOIN crop_cycles cc ON cc.id = hs.crop_cycle_id AND cc.company_id = hs.company_id
    JOIN fields f       ON f.id  = cc.field_id       AND f.company_id  = hs.company_id
    JOIN seasons s      ON s.id  = cc.season_id       AND s.company_id  = hs.company_id
    WHERE hs.company_id = ?`

  const params: unknown[] = [company_id]
  if (crop_cycle_id) { sql += ' AND hs.crop_cycle_id = ?'; params.push(Number(crop_cycle_id)) }
  if (status)        { sql += ' AND hs.status = ?';        params.push(status) }
  if (season_id)     { sql += ' AND cc.season_id = ?';     params.push(Number(season_id)) }

  sql += ' ORDER BY hs.settlement_date DESC, hs.id DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

// ── GET /api/harvest-settlements/:id ─────────────────────────────────────────
hs.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const row = await c.env.DB.prepare(`
    SELECT hs.*,
           cc.crop_name, cc.crop_type, cc.status AS cycle_status,
           cc.planting_date, cc.area_feddan,
           f.name AS field_name, f.code AS field_code,
           s.name AS season_name
    FROM harvest_settlements hs
    JOIN crop_cycles cc ON cc.id = hs.crop_cycle_id AND cc.company_id = hs.company_id
    JOIN fields f       ON f.id  = cc.field_id       AND f.company_id  = hs.company_id
    JOIN seasons s      ON s.id  = cc.season_id       AND s.company_id  = hs.company_id
    WHERE hs.id = ? AND hs.company_id = ?
  `).bind(id, company_id).first()

  if (!row) return c.json({ success: false, error: 'تسوية الحصاد غير موجودة' }, 404)
  return c.json({ success: true, data: row })
})

// ── POST /api/harvest-settlements — create draft ──────────────────────────────
hs.post('/', async (c) => {
  const { company_id, sub: user_id } = getUser(c)
  const b = await c.req.json<{
    crop_cycle_id:    number
    settlement_date?: string
    disposition:      'stored' | 'sold'
    qty_tons?:        number
    // stored
    inventory_value?: number
    warehouse_id?:    number
    item_code?:       number
    // sold
    revenue?:         number
    buyer_name?:      string
    notes?:           string
  }>()

  if (!b.crop_cycle_id || !b.disposition) {
    return c.json({ success: false, error: 'crop_cycle_id والتصرف مطلوبان' }, 400)
  }
  if (!['stored', 'sold'].includes(b.disposition)) {
    return c.json({ success: false, error: 'التصرف يجب أن يكون stored أو sold' }, 400)
  }

  // Fetch cycle — must be active
  const cycle = await c.env.DB.prepare(
    'SELECT id, status, season_id, crop_name FROM crop_cycles WHERE id = ? AND company_id = ?'
  ).bind(b.crop_cycle_id, company_id).first<{ id: number; status: string; season_id: number; crop_name: string }>()
  if (!cycle) return c.json({ success: false, error: 'دورة المحصول غير موجودة' }, 404)
  if (cycle.status !== 'active') {
    return c.json({ success: false, error: `دورة المحصول في حالة "${cycle.status}" — يجب أن تكون نشطة للتسوية` }, 422)
  }

  // Check no existing posted settlement
  const existing = await c.env.DB.prepare(
    "SELECT id FROM harvest_settlements WHERE crop_cycle_id = ? AND company_id = ? AND status = 'posted'"
  ).bind(b.crop_cycle_id, company_id).first<{ id: number }>()
  if (existing) {
    return c.json({ success: false, error: `يوجد تسوية مُرحَّلة بالفعل للدورة (id=${existing.id})` }, 422)
  }

  // Snapshot current WIP balance
  const wipRow = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS wip_balance FROM wip_ledger WHERE company_id = ? AND crop_cycle_id = ?'
  ).bind(company_id, b.crop_cycle_id).first<{ wip_balance: number }>()
  const wipBalance = Math.round((wipRow?.wip_balance ?? 0) * 100) / 100

  const settlementDate = b.settlement_date ?? getTodayIsoDate()
  const qtyTons        = b.qty_tons ?? null
  const costPerTon     = (qtyTons && qtyTons > 0) ? Math.round((wipBalance / qtyTons) * 100) / 100 : null

  const { meta } = await c.env.DB.prepare(`
    INSERT INTO harvest_settlements
      (company_id, crop_cycle_id, disposition, total_wip_cost,
       qty_tons, cost_per_ton,
       inventory_value, warehouse_id, item_code,
       revenue, buyer_name,
       settlement_date, status, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    company_id, b.crop_cycle_id, b.disposition, wipBalance,
    qtyTons, costPerTon,
    b.inventory_value ?? null, b.warehouse_id ?? null, b.item_code ?? null,
    b.revenue ?? null, b.buyer_name ?? null,
    settlementDate, 'draft', b.notes ?? null, user_id,
  ).run()

  const settlementId = meta.last_row_id

  await logAudit(c.env.DB, {
    user_id, company_id,
    action: 'CREATE', table_name: 'harvest_settlements', record_id: settlementId,
    new_value: { crop_cycle_id: b.crop_cycle_id, disposition: b.disposition, wip_balance: wipBalance },
  })

  return c.json({ success: true, data: { id: settlementId, total_wip_cost: wipBalance } }, 201)
})

// ── PATCH /api/harvest-settlements/:id — update draft fields ─────────────────
hs.patch('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{
    settlement_date?: string
    disposition?:     'stored' | 'sold'
    qty_tons?:        number
    inventory_value?: number
    warehouse_id?:    number
    item_code?:       number
    revenue?:         number
    buyer_name?:      string
    notes?:           string
  }>()

  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM harvest_settlements WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; status: string }>()
  if (!existing) return c.json({ success: false, error: 'التسوية غير موجودة' }, 404)
  if (existing.status !== 'draft') {
    return c.json({ success: false, error: 'لا يمكن تعديل تسوية مُرحَّلة أو مُعكوسة' }, 422)
  }

  const sets: string[]    = []
  const params: unknown[] = []

  if (b.settlement_date !== undefined) { sets.push('settlement_date = ?'); params.push(b.settlement_date) }
  if (b.disposition     !== undefined) { sets.push('disposition = ?');     params.push(b.disposition) }
  if (b.qty_tons        !== undefined) { sets.push('qty_tons = ?');        params.push(b.qty_tons) }
  if (b.inventory_value !== undefined) { sets.push('inventory_value = ?'); params.push(b.inventory_value) }
  if (b.warehouse_id    !== undefined) { sets.push('warehouse_id = ?');    params.push(b.warehouse_id) }
  if (b.item_code       !== undefined) { sets.push('item_code = ?');       params.push(b.item_code) }
  if (b.revenue         !== undefined) { sets.push('revenue = ?');         params.push(b.revenue) }
  if (b.buyer_name      !== undefined) { sets.push('buyer_name = ?');      params.push(b.buyer_name) }
  if (b.notes           !== undefined) { sets.push('notes = ?');           params.push(b.notes) }

  if (!sets.length) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)

  params.push(id, company_id)
  await c.env.DB.prepare(
    `UPDATE harvest_settlements SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...params).run()

  return c.json({ success: true })
})

// ── POST /api/harvest-settlements/:id/post — post the settlement ──────────────
hs.post('/:id/post', async (c) => {
  const { company_id, sub: user_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const settlement = await c.env.DB.prepare(`
    SELECT hs.*, cc.season_id, cc.crop_name, cc.status AS cycle_status
    FROM harvest_settlements hs
    JOIN crop_cycles cc ON cc.id = hs.crop_cycle_id AND cc.company_id = hs.company_id
    WHERE hs.id = ? AND hs.company_id = ?
  `).bind(id, company_id).first<{
    id: number; crop_cycle_id: number; season_id: number; disposition: 'stored' | 'sold'
    total_wip_cost: number; inventory_value: number | null; warehouse_id: number | null
    item_code: number | null; revenue: number | null; buyer_name: string | null
    qty_tons: number | null; notes: string | null; settlement_date: string
    status: string; cycle_status: string; crop_name: string
  }>()

  if (!settlement) return c.json({ success: false, error: 'التسوية غير موجودة' }, 404)
  if (settlement.status !== 'draft') {
    return c.json({ success: false, error: `التسوية في حالة "${settlement.status}" — يجب أن تكون مسودة للترحيل` }, 422)
  }
  if (settlement.cycle_status !== 'active') {
    return c.json({ success: false, error: 'دورة المحصول ليست نشطة — لا يمكن الترحيل' }, 422)
  }

  // Validation per disposition
  if (settlement.disposition === 'stored') {
    if (!settlement.inventory_value || settlement.inventory_value <= 0) {
      return c.json({ success: false, error: 'قيمة المخزون مطلوبة لتصرف "مخزن"' }, 422)
    }
  } else if (settlement.disposition === 'sold') {
    if (!settlement.revenue || settlement.revenue <= 0) {
      return c.json({ success: false, error: 'قيمة الإيراد مطلوبة لتصرف "بيع"' }, 422)
    }
  }

  try {
    const glEntries = await FinanceCore.postHarvestSettlement(c.env.DB, {
      company_id, user_id,
      settlement_id:   id,
      crop_cycle_id:   settlement.crop_cycle_id,
      season_id:       settlement.season_id,
      settlement_date: settlement.settlement_date,
      disposition:     settlement.disposition,
      total_wip_cost:  settlement.total_wip_cost,
      inventory_value: settlement.inventory_value ?? undefined,
      warehouse_id:    settlement.warehouse_id ?? undefined,
      item_code:       settlement.item_code ?? undefined,
      revenue:         settlement.revenue ?? undefined,
      buyer_name:      settlement.buyer_name ?? undefined,
      qty_tons:        settlement.qty_tons ?? undefined,
      notes:           settlement.notes ?? undefined,
    })

    await logAudit(c.env.DB, {
      user_id, company_id,
      action: 'UPDATE', table_name: 'harvest_settlements', record_id: id,
      new_value: { status: 'posted', ...glEntries },
    })

    return c.json({ success: true, data: { id, status: 'posted', ...glEntries } })
  } catch (e: any) {
    return c.json({ success: false, error: `فشل ترحيل التسوية: ${e.message}` }, 400)
  }
})

export default hs
