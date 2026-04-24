import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { logAudit } from '../lib/audit'
import { getOpenPeriod, postAutoEntry, glInventoryMovement } from '../lib/gl'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const finance = new Hono<{ Bindings: Env }>()
finance.use('*', authMiddleware)

const poStatusSchema = z.object({
  status: z.enum(['sent', 'partial', 'received', 'cancelled', 'closed']),
  notes: z.string().optional().nullable(),
})

const poCreateSchema = z.object({
  po_number: z.string().optional().nullable(),
  supplier_code: z.number().optional().nullable(),
  supplier_name: z.string().optional().nullable(),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ خاطئة'),
  expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    item_code: z.union([z.string(), z.number()]).optional().nullable(),
    item_name: z.string().min(2, 'اسم الصنف قصير جداً'),
    unit: z.string().optional().nullable(),
    qty_ordered: z.number().positive('الكمية يجب أن تكون موجبة'),
    unit_price: z.number().nonnegative('السعر لا يمكن أن يكون سالباً'),
    notes: z.string().optional().nullable(),
  })).min(1, 'يجب إضافة صنف واحد على الأقل'),
})

// ═══════════════════════════════════════════════════════════
// BANK ACCOUNTS — الحسابات البنكية
// ═══════════════════════════════════════════════════════════

finance.get('/bank-accounts', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT ba.*,
               (SELECT COALESCE(SUM(s.amount_in) - SUM(s.amount_out),0)
                FROM bank_statements s WHERE s.bank_account_id = ba.id) +
               ba.opening_balance AS current_balance
             FROM bank_accounts ba
             WHERE ba.company_id = ? ORDER BY ba.bank_name, ba.account_name`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

finance.post('/bank-accounts', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    bank_name: string; account_name: string; account_number: string
    iban?: string; currency?: string; gl_account_code?: string
    opening_balance?: number; notes?: string
  }>()
  if (!b.bank_name || !b.account_name || !b.account_number) {
    return c.json({ success: false, error: 'اسم البنك واسم الحساب ورقم الحساب مطلوبة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO bank_accounts
     (company_id, bank_name, account_name, account_number, iban, currency,
      gl_account_code, opening_balance, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.bank_name, b.account_name, b.account_number,
    b.iban ?? null, b.currency ?? 'EGP', b.gl_account_code ?? null,
    b.opening_balance ?? 0, b.notes ?? null
  ).run()
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'bank_accounts', record_id: r.meta.last_row_id,
    new_value: b,
  })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

finance.patch('/bank-accounts/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<Record<string, unknown>>()
  const allowed = ['bank_name','account_name','account_number','iban','currency','gl_account_code','opening_balance','is_active','notes']
  const cols = Object.keys(b).filter(k => allowed.includes(k))
  if (!cols.length) return c.json({ success: false, error: 'لا توجد حقول للتعديل' }, 400)
  await c.env.DB.prepare(
    `UPDATE bank_accounts SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...cols.map(f => b[f]), id, company_id).run()
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// BANK STATEMENTS — كشوف حساب البنك
// ═══════════════════════════════════════════════════════════

finance.get('/bank-statements/:accountId', async (c) => {
  const { company_id } = getUser(c)
  const accountId = Number(c.req.param('accountId'))
  const start     = c.req.query('start')
  const end       = c.req.query('end')
  const unmatched = c.req.query('unmatched')

  let where = 'WHERE s.company_id = ? AND s.bank_account_id = ?'
  const p: unknown[] = [company_id, accountId]
  if (start)    { where += ' AND s.statement_date >= ?'; p.push(start) }
  if (end)      { where += ' AND s.statement_date <= ?'; p.push(end) }
  if (unmatched === '1') { where += ' AND s.is_matched = 0' }

  const { results } = await c.env.DB
    .prepare(`SELECT s.*, u.full_name AS matched_by_name
              FROM bank_statements s
              LEFT JOIN users u ON u.id = s.matched_by
              ${where}
              ORDER BY s.statement_date ASC, s.id ASC`)
    .bind(...p).all()
  return c.json({ success: true, data: results })
})

// POST many lines at once (import / manual batch entry)
finance.post('/bank-statements/:accountId', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const accountId = Number(c.req.param('accountId'))

  // Verify ownership
  const acct = await c.env.DB
    .prepare('SELECT id FROM bank_accounts WHERE id = ? AND company_id = ?')
    .bind(accountId, company_id).first()
  if (!acct) return c.json({ success: false, error: 'الحساب غير موجود' }, 404)

  const body = await c.req.json<{
    batch_id?: string
    lines: Array<{
      statement_date: string; value_date?: string; description: string
      ref_number?: string; amount_in?: number; amount_out?: number; bank_balance?: number
    }>
  }>()
  if (!body.lines?.length) return c.json({ success: false, error: 'لا توجد سطور' }, 400)

  const batchId = body.batch_id ?? `import-${Date.now()}`
  const stmts = body.lines.map(l =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO bank_statements
       (company_id, bank_account_id, statement_date, value_date, description,
        ref_number, amount_in, amount_out, bank_balance, import_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, accountId, l.statement_date, l.value_date ?? null, l.description,
      l.ref_number ?? null, l.amount_in ?? 0, l.amount_out ?? 0,
      l.bank_balance ?? null, batchId
    )
  )
  await c.env.DB.batch(stmts)
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'bank_statements', record_id: accountId,
    new_value: { lines: body.lines.length, batch_id: batchId },
  })
  return c.json({ success: true, data: { imported: body.lines.length, batch_id: batchId } }, 201)
})

// PATCH match/unmatch a statement line to a cash_transaction
finance.patch('/bank-statements/:id/match', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { cash_tx_id } = await c.req.json<{ cash_tx_id: number | null }>()

  if (cash_tx_id !== null) {
    // Verify the cash_transaction belongs to this company
    const tx = await c.env.DB
      .prepare('SELECT id FROM cash_transactions WHERE id = ? AND company_id = ?')
      .bind(cash_tx_id, company_id).first()
    if (!tx) return c.json({ success: false, error: 'حركة الخزينة غير موجودة' }, 404)
    await c.env.DB.prepare(
      `UPDATE bank_statements
       SET is_matched = 1, matched_tx_id = ?, matched_at = datetime('now'), matched_by = ?
       WHERE id = ? AND company_id = ?`
    ).bind(cash_tx_id, userId, id, company_id).run()
  } else {
    // Unmatch
    await c.env.DB.prepare(
      `UPDATE bank_statements
       SET is_matched = 0, matched_tx_id = NULL, matched_at = NULL, matched_by = NULL
       WHERE id = ? AND company_id = ?`
    ).bind(id, company_id).run()
  }
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// BANK RECONCILIATIONS — جلسات المطابقة
// ═══════════════════════════════════════════════════════════

finance.get('/bank-recon/:accountId', async (c) => {
  const { company_id } = getUser(c)
  const accountId = Number(c.req.param('accountId'))
  const { results } = await c.env.DB
    .prepare(
      `SELECT r.*, u.full_name AS created_by_name, cu.full_name AS closed_by_name
       FROM bank_reconciliations r
       LEFT JOIN users u  ON u.id  = r.created_by
       LEFT JOIN users cu ON cu.id = r.closed_by
       WHERE r.company_id = ? AND r.bank_account_id = ?
       ORDER BY r.period_end DESC`
    ).bind(company_id, accountId).all()
  return c.json({ success: true, data: results })
})

finance.post('/bank-recon/:accountId', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const accountId = Number(c.req.param('accountId'))
  const b = await c.req.json<{
    period_start: string; period_end: string
    bank_closing_bal: number; book_closing_bal: number
    outstanding_checks?: number; deposits_in_transit?: number
    bank_errors?: number; book_errors?: number; notes?: string
  }>()
  if (!b.period_start || !b.period_end) {
    return c.json({ success: false, error: 'تاريخ بداية ونهاية الفترة مطلوبان' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO bank_reconciliations
     (company_id, bank_account_id, period_start, period_end,
      bank_closing_bal, book_closing_bal, outstanding_checks,
      deposits_in_transit, bank_errors, book_errors, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, accountId, b.period_start, b.period_end,
    b.bank_closing_bal, b.book_closing_bal,
    b.outstanding_checks ?? 0, b.deposits_in_transit ?? 0,
    b.bank_errors ?? 0, b.book_errors ?? 0,
    b.notes ?? null, userId
  ).run()
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

finance.patch('/bank-recon/:id/close', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE bank_reconciliations
     SET status = 'reconciled', closed_by = ?, closed_at = datetime('now')
     WHERE id = ? AND company_id = ? AND status = 'draft'`
  ).bind(userId, id, company_id).run()
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CLOSE',
    table_name: 'bank_reconciliations', record_id: id,
  })
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// PURCHASE ORDERS — طلبات الشراء
// ═══════════════════════════════════════════════════════════

finance.get('/purchase-orders', async (c) => {
  const { company_id } = getUser(c)
  const status = c.req.query('status')
  const page   = Math.max(1, Number(c.req.query('page') ?? 1))
  const size   = Math.min(100, Number(c.req.query('size') ?? 50))
  const offset = (page - 1) * size

  let where = 'WHERE po.company_id = ?'
  const p: unknown[] = [company_id]
  if (status) { where += ' AND po.status = ?'; p.push(status) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT po.*,
              u1.full_name AS requested_by_name,
              u2.full_name AS approved_by_name,
              s.name       AS supplier_name_resolved,
              (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id) AS item_count
       FROM purchase_orders po
       LEFT JOIN users    u1 ON u1.id = po.requested_by
       LEFT JOIN users    u2 ON u2.id = po.approved_by
       LEFT JOIN suppliers s  ON s.code = po.supplier_code AND s.company_id = po.company_id
       ${where}
       ORDER BY po.order_date DESC, po.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...p, size, offset).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM purchase_orders po ${where}`
    ).bind(...p).first<{n:number}>(),
  ])
  return c.json({ success: true, data: rows.results, total: cnt?.n ?? 0, page, page_size: size })
})

finance.get('/purchase-orders/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const [po, items] = await Promise.all([
    c.env.DB.prepare(
      `SELECT po.*, u1.full_name AS requested_by_name, u2.full_name AS approved_by_name,
              s.name AS supplier_name_resolved
       FROM purchase_orders po
       LEFT JOIN users    u1 ON u1.id = po.requested_by
       LEFT JOIN users    u2 ON u2.id = po.approved_by
       LEFT JOIN suppliers s  ON s.code = po.supplier_code AND s.company_id = po.company_id
       WHERE po.id = ? AND po.company_id = ?`
    ).bind(id, company_id).first(),
    c.env.DB.prepare(
      'SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY id'
    ).bind(id).all(),
  ])
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)
  return c.json({ success: true, data: { ...po, items: items.results } })
})

finance.post('/purchase-orders', zValidator('json', poCreateSchema), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = c.req.valid('json')

  // Auto-generate PO number if not provided
  const poNumber = b.po_number ?? await (async () => {
    const yr = new Date(b.order_date).getFullYear()
    const cnt = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM purchase_orders WHERE company_id = ? AND order_date LIKE ?`
    ).bind(company_id, `${yr}%`).first<{n:number}>()
    return `PO-${yr}-${String((cnt?.n ?? 0) + 1).padStart(4, '0')}`
  })()

  const totalAmount = b.items.reduce((s, i) => s + i.qty_ordered * i.unit_price, 0)

  const poRes = await c.env.DB.prepare(
    `INSERT INTO purchase_orders
     (company_id, po_number, supplier_code, supplier_name, order_date,
      expected_date, total_amount, notes, requested_by, created_by, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,'draft')`
  ).bind(
    company_id, poNumber, b.supplier_code ?? null,
    b.supplier_name ?? null, b.order_date,
    b.expected_date ?? null, totalAmount, b.notes ?? null, userId, userId
  ).run()

  const poId = poRes.meta.last_row_id

  const itemStmts = b.items.map(i =>
    c.env.DB.prepare(
      `INSERT INTO purchase_order_items
       (po_id, company_id, item_code, item_name, unit, qty_ordered, unit_price, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(poId, company_id, i.item_code ?? null, i.item_name, i.unit ?? null,
           i.qty_ordered, i.unit_price, i.notes ?? null)
  )
  await c.env.DB.batch(itemStmts)

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'purchase_orders', record_id: poId,
    new_value: { po_number: poNumber, total: totalAmount, items: b.items.length },
  })

  return c.json({ success: true, data: { id: poId, po_number: poNumber } }, 201)
})

// PATCH status transitions: sent → partial → received → closed / cancelled
finance.patch('/purchase-orders/:id/status', zValidator('json', poStatusSchema), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id   = Number(c.req.param('id'))
  const b    = c.req.valid('json')
  const { status, notes } = b

  const po = await c.env.DB
    .prepare('SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string }>()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)

  // Cannot reopen a cancelled/closed PO
  if (['cancelled','closed'].includes(po.status)) {
    return c.json({ success: false, error: `لا يمكن تعديل طلب شراء ${po.status}` }, 400)
  }

  let extra = ''
  const extraBinds: unknown[] = []
  if (status === 'received') {
    extra = ', received_by = ?, received_at = datetime(\'now\')'
    extraBinds.push(userId)
  }
  if (status === 'sent' && po.status === 'draft') {
    extra = ', approved_by = ?, approved_at = datetime(\'now\')'
    extraBinds.push(userId)
  }

  await c.env.DB.prepare(
    `UPDATE purchase_orders
     SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now')${extra}
     WHERE id = ? AND company_id = ?`
  ).bind(status, notes ?? null, ...extraBinds, id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'purchase_orders', record_id: id,
    new_value: { status },
  })

  return c.json({ success: true, data: null })
})

// PATCH receive: update qty_received per item + auto inventory_movements
finance.patch('/purchase-orders/:id/receive', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { items } = await c.req.json<{
    items: Array<{ item_id: number; qty_received: number; warehouse?: string }>
  }>()

  if (!items?.length) return c.json({ success: false, error: 'البنود مطلوبة' }, 400)

  const po = await c.env.DB
    .prepare('SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string }>()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)
  if (['cancelled','closed'].includes(po.status)) {
    return c.json({ success: false, error: 'لا يمكن استلام طلب ملغي أو مغلق' }, 400)
  }

  // Period check
  const today = new Date().toISOString().slice(0, 10)
  const periodId = await getOpenPeriod(c.env.DB, company_id, today)
  if (!periodId) {
    return c.json({ success: false,
      error: `لا توجد فترة مالية مفتوحة للتاريخ ${today} — تحقق من إعدادات الفترات المالية` }, 400)
  }

  // Update qty_received + persist warehouse on item
  const updateStmts = items.map(i =>
    c.env.DB.prepare(
      `UPDATE purchase_order_items
       SET qty_received = MIN(qty_ordered, qty_received + ?),
           warehouse = COALESCE(warehouse, ?)
       WHERE id = ? AND po_id = ?`
    ).bind(i.qty_received, i.warehouse ?? null, i.item_id, id)
  )
  await c.env.DB.batch(updateStmts)

  // Auto-create inventory_movements for items with item_code + warehouse
  for (const recv of items.filter(i => i.qty_received > 0)) {
    const poItem = await c.env.DB
      .prepare('SELECT item_code, item_name, unit_price, warehouse FROM purchase_order_items WHERE id = ? AND po_id = ?')
      .bind(recv.item_id, id)
      .first<{ item_code: string | null; item_name: string; unit_price: number; warehouse: string | null }>()

    const warehouse  = recv.warehouse ?? poItem?.warehouse
    const itemCodeNum = poItem?.item_code ? Number(poItem.item_code) : NaN
    if (!warehouse || isNaN(itemCodeNum) || itemCodeNum <= 0) continue

    const itemRow = await c.env.DB
      .prepare('SELECT code, name FROM items WHERE code = ? AND company_id = ?')
      .bind(itemCodeNum, company_id).first<{ code: number; name: string }>()
    if (!itemRow) continue

    const balRow = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(qty_in) - SUM(qty_out), 0)     AS bal_qty,
              COALESCE(SUM(value_in) - SUM(value_out), 0) AS bal_val
       FROM inventory_movements WHERE company_id = ? AND item_code = ? AND warehouse = ?`
    ).bind(company_id, itemCodeNum, warehouse).first<{ bal_qty: number; bal_val: number }>()

    const prevQty = balRow?.bal_qty ?? 0
    const prevVal = balRow?.bal_val ?? 0
    const price   = poItem?.unit_price ?? 0
    const qtyIn   = recv.qty_received
    const valueIn = qtyIn * price

    await c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, item_code, movement_date, warehouse, movement_type,
        quantity, unit_price, qty_in, qty_out, balance_qty,
        value_in, value_out, balance_value, notes, year, month, created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, itemCodeNum, today, warehouse, 'اضافة',
      qtyIn, price, qtyIn, 0, prevQty + qtyIn,
      valueIn, 0, prevVal + valueIn,
      `PO استلام: ${poItem?.item_name ?? ''}`,
      new Date().getFullYear(), new Date().getMonth() + 1, userId
    ).run()

    const movId = await c.env.DB
      .prepare('SELECT id FROM inventory_movements WHERE company_id = ? ORDER BY id DESC LIMIT 1')
      .bind(company_id).first<{ id: number }>()
    await glInventoryMovement(
      c.env.DB, company_id, movId?.id ?? 0,
      'اضافة', valueIn, today, itemRow.name, userId
    )
  }

  // Auto-update PO status
  const { results: itemRows } = await c.env.DB
    .prepare('SELECT qty_ordered, qty_received FROM purchase_order_items WHERE po_id = ?')
    .bind(id).all<{ qty_ordered: number; qty_received: number }>()

  const allReceived = itemRows.every(i => i.qty_received >= i.qty_ordered)
  const anyReceived = itemRows.some(i => i.qty_received > 0)

  const newStatus = allReceived ? 'received' : anyReceived ? 'partial' : po.status
  if (newStatus !== po.status) {
    await c.env.DB.prepare(
      `UPDATE purchase_orders
       SET status = ?, received_by = ?, received_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    ).bind(newStatus, userId, id).run()
  }

  return c.json({ success: true, data: { status: newStatus } })
})

// ═══════════════════════════════════════════════════════════
// CASH TRANSACTION SEARCH — for bank statement matching
// ═══════════════════════════════════════════════════════════

finance.get('/cash-tx-search', async (c) => {
  const { company_id } = getUser(c)
  const q         = c.req.query('q') ?? ''
  const direction = c.req.query('direction')

  // Exclude already-matched transactions
  let where = `
    WHERE ct.company_id = ?
    AND ct.id NOT IN (
      SELECT DISTINCT bs.matched_tx_id FROM bank_statements bs
      WHERE bs.matched_tx_id IS NOT NULL AND bs.company_id = ?
    )`
  const binds: unknown[] = [company_id, company_id]

  if (q.length >= 2) {
    where += ' AND (ct.narration LIKE ? OR ct.recipient_name LIKE ?)'
    binds.push(`%${q}%`, `%${q}%`)
  }
  if (direction) { where += ' AND ct.direction = ?'; binds.push(direction) }

  const { results } = await c.env.DB.prepare(
    `SELECT ct.id, ct.transaction_date, ct.direction, ct.narration,
            ct.recipient_name, ct.amount, ct.document_number, ct.running_balance
     FROM cash_transactions ct
     ${where}
     ORDER BY ct.transaction_date DESC, ct.id DESC
     LIMIT 60`
  ).bind(...binds).all()

  return c.json({ success: true, data: results })
})

// ═══════════════════════════════════════════════════════════
// SUPPLIER INVOICES — المطابقة الثلاثية (PO → GR → Invoice)
// ═══════════════════════════════════════════════════════════

// GET /finance/purchase-orders/:id/match
// Returns PO items with qty_ordered / qty_received / qty_invoiced for 3-way match
finance.get('/purchase-orders/:id/match', async (c) => {
  const { company_id } = getUser(c)
  const poId = Number(c.req.param('id'))

  const po = await c.env.DB.prepare(
    'SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?'
  ).bind(poId, company_id).first()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)

  const [items, invoices] = await Promise.all([
    c.env.DB.prepare(
      'SELECT * FROM purchase_order_items WHERE po_id = ? AND company_id = ? ORDER BY id'
    ).bind(poId, company_id).all(),

    c.env.DB.prepare(`
      SELECT si.id AS invoice_id, si.invoice_number, si.invoice_date,
             si.total_amount, si.notes AS invoice_notes,
             sii.po_item_id, sii.qty_invoiced, sii.unit_price AS invoice_unit_price
      FROM supplier_invoices si
      JOIN supplier_invoice_items sii ON sii.invoice_id = si.id
      WHERE si.po_id = ? AND si.company_id = ?
      ORDER BY si.invoice_date DESC, si.id DESC
    `).bind(poId, company_id).all<{
      invoice_id: number; invoice_number: string; invoice_date: string
      total_amount: number; invoice_notes: string | null
      po_item_id: number; qty_invoiced: number; invoice_unit_price: number
    }>(),
  ])

  // Aggregate invoiced qty per po_item_id
  const invoicedByItem = new Map<number, { qty: number; price: number; invoice_id: number; invoice_number: string }>()
  for (const row of invoices.results) {
    const existing = invoicedByItem.get(row.po_item_id)
    if (existing) {
      existing.qty += row.qty_invoiced
    } else {
      invoicedByItem.set(row.po_item_id, {
        qty:            row.qty_invoiced,
        price:          row.invoice_unit_price,
        invoice_id:     row.invoice_id,
        invoice_number: row.invoice_number,
      })
    }
  }

  // Build match rows
  const matchRows = (items.results as Array<{
    id: number; item_name: string; unit: string | null
    qty_ordered: number; qty_received: number; unit_price: number
  }>).map(item => {
    const inv = invoicedByItem.get(item.id)
    const qtyInv  = inv?.qty   ?? 0
    const priceInv = inv?.price ?? item.unit_price

    let match_status: 'matched' | 'price_variance' | 'qty_variance' | 'over_invoiced' | 'pending_invoice' | 'no_gr'
    if (item.qty_received === 0) {
      match_status = 'no_gr'
    } else if (qtyInv === 0) {
      match_status = 'pending_invoice'
    } else if (qtyInv > item.qty_received) {
      match_status = 'over_invoiced'
    } else if (Math.abs(qtyInv - item.qty_received) > 0.001) {
      match_status = 'qty_variance'
    } else if (Math.abs(priceInv - item.unit_price) > 0.01) {
      match_status = 'price_variance'
    } else {
      match_status = 'matched'
    }

    return {
      po_item_id:     item.id,
      item_name:      item.item_name,
      unit:           item.unit,
      qty_ordered:    item.qty_ordered,
      qty_received:   item.qty_received,
      qty_invoiced:   qtyInv,
      po_unit_price:  item.unit_price,
      inv_unit_price: priceInv,
      match_status,
      invoice_id:     inv?.invoice_id     ?? null,
      invoice_number: inv?.invoice_number ?? null,
    }
  })

  // Unique invoices list for this PO
  const uniqueInvoices = [...new Map(
    invoices.results.map(r => [r.invoice_id, {
      id: r.invoice_id, number: r.invoice_number,
      date: r.invoice_date, total: r.total_amount,
    }])
  ).values()]

  return c.json({ success: true, data: { po, match_rows: matchRows, invoices: uniqueInvoices } })
})

// POST /finance/purchase-orders/:id/invoices
finance.post('/purchase-orders/:id/invoices', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const poId = Number(c.req.param('id'))

  const b = await c.req.json<{
    invoice_number: string; invoice_date: string; notes?: string
    items: Array<{ po_item_id: number; qty_invoiced: number; unit_price: number }>
  }>()

  if (!b.invoice_number || !b.invoice_date || !b.items?.length) {
    return c.json({ success: false, error: 'رقم الفاتورة والتاريخ والبنود مطلوبة' }, 400)
  }

  const po = await c.env.DB.prepare(
    'SELECT id, supplier_code FROM purchase_orders WHERE id = ? AND company_id = ?'
  ).bind(poId, company_id).first<{ id: number; supplier_code: number | null }>()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)

  // Validate financial period
  const { getOpenPeriod, glSupplierInvoice } = await import('../lib/gl')
  const periodId = await getOpenPeriod(c.env.DB, company_id, b.invoice_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.invoice_date}` }, 400)
  }

  // 3-Way Match Enforcement: Check existing invoiced qty vs received qty
  for (const item of b.items) {
    const poItem = await c.env.DB.prepare(
      `SELECT item_name, qty_received, (SELECT COALESCE(SUM(qty_invoiced),0) FROM supplier_invoice_items WHERE po_item_id = ?) AS already_invoiced
       FROM purchase_order_items WHERE id = ? AND po_id = ? AND company_id = ?`
    ).bind(item.po_item_id, item.po_item_id, poId, company_id).first<{ item_name: string; qty_received: number; already_invoiced: number }>()

    if (!poItem) return c.json({ success: false, error: `البند ${item.po_item_id} غير موجود` }, 404)
    
    const remainingToInvoice = poItem.qty_received - poItem.already_invoiced
    if (item.qty_invoiced > remainingToInvoice) {
      return c.json({ 
        success: false, 
        error: `الكمية المفوترة (${item.qty_invoiced}) تتجاوز المتبقي من الاستلام (${remainingToInvoice}) لبند ${poItem.item_name}. المطابقة الثلاثية مطلوبة.` 
      }, 409)
    }
  }

  const totalAmount = b.items.reduce((s, i) => s + i.qty_invoiced * i.unit_price, 0)

  const invRes = await c.env.DB.prepare(
    `INSERT INTO supplier_invoices
     (company_id, po_id, invoice_number, invoice_date, supplier_code, total_amount, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(company_id, poId, b.invoice_number, b.invoice_date,
         po.supplier_code ?? null, totalAmount, b.notes ?? null, userId).run()

  const invoiceId = invRes.meta.last_row_id

  await c.env.DB.batch(b.items.map(i =>
    c.env.DB.prepare(
      `INSERT INTO supplier_invoice_items (invoice_id, po_item_id, company_id, qty_invoiced, unit_price)
       VALUES (?,?,?,?,?)`
    ).bind(invoiceId, i.po_item_id, company_id, i.qty_invoiced, i.unit_price)
  ))

  const glEntryId = await glSupplierInvoice(
    c.env.DB, company_id, invoiceId, totalAmount, b.invoice_date,
    `فاتورة مورد: ${b.invoice_number}`, userId,
  )

  if (glEntryId) {
    await c.env.DB.prepare('UPDATE supplier_invoices SET journal_entry_id = ? WHERE id = ?')
      .bind(glEntryId, invoiceId).run()
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'supplier_invoices', record_id: invoiceId,
    new_value: { po_id: poId, invoice_number: b.invoice_number, total: totalAmount, gl_entry_id: glEntryId },
  })

  return c.json({ success: true, data: { id: invoiceId, gl_entry_id: glEntryId } }, 201)
})

// ── AP Aging ──────────────────────────────────────────────────

// GET /finance/ap-aging
finance.get('/ap-aging', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(`
    SELECT
      si.id,
      si.invoice_number,
      si.invoice_date,
      COALESCE(si.due_date_days, 30)             AS due_date_days,
      DATE(si.invoice_date, '+' || COALESCE(si.due_date_days,30) || ' days') AS due_date,
      si.total_amount,
      COALESCE(si.paid_amount, 0)                AS paid_amount,
      si.total_amount - COALESCE(si.paid_amount, 0) AS outstanding,
      si.payment_date,
      si.payment_ref,
      po.po_number,
      po.supplier_name,
      CAST(
        julianday('now') -
        julianday(DATE(si.invoice_date, '+' || COALESCE(si.due_date_days,30) || ' days'))
        AS INTEGER
      ) AS days_overdue
    FROM supplier_invoices si
    LEFT JOIN purchase_orders po ON po.id = si.po_id AND po.company_id = si.company_id
    WHERE si.company_id = ?
      AND si.total_amount > COALESCE(si.paid_amount, 0)
    ORDER BY due_date ASC
  `).bind(company_id).all()

  return c.json({ success: true, data: results })
})

// PATCH /finance/supplier-invoices/:id/pay
finance.patch('/supplier-invoices/:id/pay', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{
    paid_amount: number; payment_date?: string; payment_ref?: string
  }>()

  const inv = await c.env.DB.prepare(
    'SELECT * FROM supplier_invoices WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{
    total_amount: number; paid_amount: number
    payment_date: string | null; payment_ref: string | null
  }>()
  if (!inv) return c.json({ success: false, error: 'الفاتورة غير موجودة' }, 404)

  const newPaid = Math.min(Number(b.paid_amount) || 0, inv.total_amount)
  const today   = b.payment_date ?? new Date().toISOString().slice(0, 10)

  // Pre-validate GL mappings and open period before touching financial records
  const [apRow, cashRow] = await Promise.all([
    c.env.DB.prepare('SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = ?')
      .bind(company_id, 'accounts_payable').first<{ account_code: string }>(),
    c.env.DB.prepare('SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = ?')
      .bind(company_id, 'cash').first<{ account_code: string }>(),
  ])
  if (!apRow || !cashRow) {
    return c.json({ success: false, error: 'GL_MAPPING_MISSING: حسابات الدائنون أو الخزينة غير معرفة في إعدادات الحسابات' }, 400)
  }
  const periodId = await getOpenPeriod(c.env.DB, company_id, today)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${today}` }, 400)
  }

  // Update payment record
  await c.env.DB.prepare(
    `UPDATE supplier_invoices
     SET paid_amount = ?, payment_date = COALESCE(?, payment_date),
         payment_ref = COALESCE(?, payment_ref)
     WHERE id = ? AND company_id = ?`
  ).bind(newPaid, b.payment_date ?? null, b.payment_ref ?? null, id, company_id).run()

  // GL: DR Accounts Payable / CR Cash — balanced and batched via postAutoEntry
  try {
    await postAutoEntry(c.env.DB, {
      company_id, entry_date: today,
      description: `سداد فاتورة مورد #${id}`,
      ref_type: 'supplier_payment', ref_id: id,
      lines: [
        { account_code: apRow.account_code,   debit: newPaid, credit: 0,       description: `سداد فاتورة #${id}` },
        { account_code: cashRow.account_code, debit: 0,       credit: newPaid, description: `سداد فاتورة #${id}` },
      ],
      created_by: userId,
    })
  } catch (e: any) {
    // Compensating rollback — restore original payment values
    await c.env.DB.prepare(
      `UPDATE supplier_invoices SET paid_amount = ?, payment_date = ?, payment_ref = ?
       WHERE id = ? AND company_id = ?`
    ).bind(inv.paid_amount, inv.payment_date, inv.payment_ref, id, company_id).run()
    return c.json({ success: false, error: `فشل إنشاء القيد المحاسبي: ${e.message}` }, 400)
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'supplier_invoices', record_id: id,
    new_value: { paid_amount: newPaid, payment_date: b.payment_date },
  })

  return c.json({ success: true, data: null })
})

export default finance
