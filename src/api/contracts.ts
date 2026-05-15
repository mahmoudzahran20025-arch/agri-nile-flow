import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { FinanceCore } from '../lib/finance_core'

const contracts = new Hono<{ Bindings: Env }>()
contracts.use('*', authMiddleware)

// ── Purchase Contracts (عقود شراء) ───────────────────────────

contracts.get('/purchase', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')
  const status    = c.req.query('status')

  let sql = `SELECT pc.*, s.name AS season_name, sup.name AS supplier_name
             FROM purchase_contracts pc
             LEFT JOIN seasons s ON s.id = pc.season_id
             LEFT JOIN suppliers sup ON sup.code = pc.supplier_code AND sup.company_id = pc.company_id
             WHERE pc.company_id = ?`
  const params: unknown[] = [company_id]
  if (season_id) { sql += ' AND pc.season_id = ?'; params.push(Number(season_id)) }
  if (status)    { sql += ' AND pc.status = ?';    params.push(status) }
  sql += ' ORDER BY pc.contract_date DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

contracts.get('/purchase/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare(
    `SELECT pc.*, s.name AS season_name, sup.name AS supplier_name
     FROM purchase_contracts pc
     LEFT JOIN seasons s ON s.id = pc.season_id
     LEFT JOIN suppliers sup ON sup.code = pc.supplier_code AND sup.company_id = pc.company_id
     WHERE pc.id = ? AND pc.company_id = ?`
  ).bind(id, company_id).first()
  if (!row) return c.json({ success: false, error: 'العقد غير موجود' }, 404)
  return c.json({ success: true, data: row })
})

contracts.post('/purchase', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    contract_number: string; contract_date: string; subject: string
    total_value: number; season_id?: number; supplier_code?: number
    paid_value?: number; delivery_date?: string; notes?: string
  }>()
  if (!b.contract_number || !b.contract_date || !b.subject) {
    return c.json({ success: false, error: 'رقم العقد والتاريخ والموضوع مطلوبة' }, 400)
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO purchase_contracts (company_id, season_id, supplier_code, contract_number,
     contract_date, subject, total_value, paid_value, delivery_date, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(company_id, b.season_id ?? null, b.supplier_code ?? null, b.contract_number,
     b.contract_date, b.subject, b.total_value ?? 0, b.paid_value ?? 0,
     b.delivery_date ?? null, b.notes ?? null, userId).run()
  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

contracts.patch('/purchase/:id/status', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { status, paid_value } = await c.req.json<{ status: string; paid_value?: number }>()
  const allowed = ['draft','active','partial','completed','cancelled']
  if (!allowed.includes(status)) return c.json({ success: false, error: 'حالة غير صالحة' }, 400)
  await c.env.DB.prepare(
    'UPDATE purchase_contracts SET status = ?, paid_value = COALESCE(?, paid_value) WHERE id = ? AND company_id = ?'
  ).bind(status, paid_value ?? null, id, company_id).run()
  return c.json({ success: true, data: null })
})

// ── Sales Contracts (عقود بيع) ───────────────────────────────

contracts.get('/sales', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')
  const status    = c.req.query('status')

  let sql = `SELECT sc.*, s.name AS season_name, f.name AS field_name
             FROM sales_contracts sc
             LEFT JOIN seasons s ON s.id = sc.season_id
             LEFT JOIN fields f ON f.id = sc.field_id
             WHERE sc.company_id = ?`
  const params: unknown[] = [company_id]
  if (season_id) { sql += ' AND sc.season_id = ?'; params.push(Number(season_id)) }
  if (status)    { sql += ' AND sc.status = ?';    params.push(status) }
  sql += ' ORDER BY sc.contract_date DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

contracts.post('/sales', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    contract_number: string; contract_date: string; buyer_name: string
    crop_type: string; quantity_ton: number; unit_price: number
    season_id?: number; field_id?: number; advance_paid?: number
    buyer_phone?: string; delivery_date?: string; notes?: string
  }>()
  if (!b.contract_number || !b.buyer_name || !b.crop_type || !b.quantity_ton) {
    return c.json({ success: false, error: 'بيانات العقد ناقصة' }, 400)
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO sales_contracts (company_id, season_id, buyer_name, buyer_phone,
     contract_number, contract_date, crop_type, quantity_ton, unit_price, advance_paid,
     delivery_date, field_id, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(company_id, b.season_id ?? null, b.buyer_name, b.buyer_phone ?? null,
     b.contract_number, b.contract_date, b.crop_type, b.quantity_ton, b.unit_price ?? 0,
     b.advance_paid ?? 0, b.delivery_date ?? null, b.field_id ?? null,
     b.notes ?? null, userId).run()
  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

contracts.patch('/sales/:id/status', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { status, advance_paid } = await c.req.json<{ status: string; advance_paid?: number }>()
  const allowed = ['draft','active','partial','completed','cancelled']
  if (!allowed.includes(status)) return c.json({ success: false, error: 'حالة غير صالحة' }, 400)
  await c.env.DB.prepare(
    'UPDATE sales_contracts SET status = ?, advance_paid = COALESCE(?, advance_paid) WHERE id = ? AND company_id = ?'
  ).bind(status, advance_paid ?? null, id, company_id).run()
  return c.json({ success: true, data: null })
})

// GET /contracts/sales/:id/advances — list all advance receipts for a contract
contracts.get('/sales/:id/advances', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const contract = await c.env.DB
    .prepare('SELECT id FROM sales_contracts WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ id: number }>()
  if (!contract) return c.json({ success: false, error: 'العقد غير موجود' }, 404)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM contract_advances WHERE company_id = ? AND contract_id = ? ORDER BY receipt_date DESC, id DESC')
    .bind(company_id, id).all()
  return c.json({ success: true, data: results })
})

// POST /contracts/sales/:id/receive-advance
// Records cash received as advance from buyer: DR Cash / CR Deferred Revenue.
// Supports multiple advances; advance_paid on the contract is the running total.
contracts.post('/sales/:id/receive-advance', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { amount, receipt_date, notes } = await c.req.json<{
    amount: number; receipt_date: string; notes?: string
  }>()

  if (!amount || amount <= 0) return c.json({ success: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }, 400)
  if (!receipt_date)          return c.json({ success: false, error: 'تاريخ الاستلام مطلوب' }, 400)

  const contract = await c.env.DB
    .prepare('SELECT id, contract_number, advance_paid FROM sales_contracts WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ id: number; contract_number: string; advance_paid: number }>()
  if (!contract) return c.json({ success: false, error: 'العقد غير موجود' }, 404)

  let glId: number | null = null
  try {
    glId = await FinanceCore.resolveContractAdvance(c.env.DB, {
      company_id,
      ref_id: id,
      contract_id: id,
      amount,
      date: receipt_date,
      description: `دفعة مقدمة عقد بيع #${contract.contract_number}${notes ? ` — ${notes}` : ''}`,
      created_by: userId,
    })
  } catch (e: any) {
    return c.json({ success: false, error: `فشل إنشاء القيد المحاسبي: ${e.message}` }, 400)
  }

  // Log each advance in the new table
  await c.env.DB.prepare(
    `INSERT INTO contract_advances (company_id, contract_id, amount, receipt_date, notes, gl_entry_id, created_by)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(company_id, id, amount, receipt_date, notes ?? null, glId, userId).run()

  // Update running total; keep advance_gl_entry_id pointing to the latest entry for audit
  const newTotal = Number(contract.advance_paid ?? 0) + amount
  await c.env.DB.prepare(
    'UPDATE sales_contracts SET advance_paid = ?, advance_gl_entry_id = ? WHERE id = ? AND company_id = ?'
  ).bind(newTotal, glId, id, company_id).run()

  return c.json({ success: true, data: { gl_entry_id: glId, advance_paid: newTotal } })
})

// ── Summary (for dashboard) ──────────────────────────────────
contracts.get('/summary', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')
  const params: unknown[] = [company_id, company_id]
  let where = ''
  if (season_id) { where = ' AND season_id = ?'; params.push(Number(season_id)); params.push(Number(season_id)) }

  const [purchase, sales] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n, SUM(total_value) AS total, SUM(paid_value) AS paid FROM purchase_contracts WHERE company_id = ?${where}`).bind(...params.slice(0,1 + (season_id?1:0))).first<Record<string,number>>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n, SUM(quantity_ton * unit_price) AS total, SUM(advance_paid) AS paid FROM sales_contracts WHERE company_id = ?${where}`).bind(...params.slice(season_id?2:1)).first<Record<string,number>>(),
  ])

  return c.json({ success: true, data: { purchase, sales } })
})

export default contracts
