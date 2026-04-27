import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const banking = new Hono<{ Bindings: Env }>()

// ═══════════════════════════════════════════════════════════
// BANK ACCOUNTS — الحسابات البنكية
// ═══════════════════════════════════════════════════════════

banking.get('/bank-accounts', async (c) => {
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

banking.post('/bank-accounts', async (c) => {
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

banking.patch('/bank-accounts/:id', async (c) => {
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

banking.get('/bank-statements/:accountId', async (c) => {
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

banking.post('/bank-statements/:accountId', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const accountId = Number(c.req.param('accountId'))

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

banking.patch('/bank-statements/:id/match', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { cash_tx_id } = await c.req.json<{ cash_tx_id: number | null }>()

  if (cash_tx_id !== null) {
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

banking.get('/bank-recon/:accountId', async (c) => {
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

banking.post('/bank-recon/:accountId', async (c) => {
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

banking.patch('/bank-recon/:id/close', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const recon = await c.env.DB
    .prepare("SELECT bank_account_id, period_start, period_end FROM bank_reconciliations WHERE id = ? AND company_id = ? AND status = 'draft'")
    .bind(id, company_id).first<{ bank_account_id: number; period_start: string; period_end: string }>()
  if (!recon) return c.json({ success: false, error: 'جلسة المطابقة غير موجودة أو تم إغلاقها مسبقاً' }, 404)

  const unmatched = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM bank_statements WHERE bank_account_id = ? AND statement_date BETWEEN ? AND ? AND is_matched = 0')
    .bind(recon.bank_account_id, recon.period_start, recon.period_end).first<{ n: number }>()
  if ((unmatched?.n ?? 0) > 0) {
    return c.json({ success: false, error: `لا يمكن إغلاق المطابقة — يوجد ${unmatched!.n} بند غير مطابق في هذه الفترة. طابق جميع البنود أولاً.` }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE bank_reconciliations
     SET status = 'reconciled', closed_by = ?, closed_at = datetime('now')
     WHERE id = ? AND company_id = ?`
  ).bind(userId, id, company_id).run()
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CLOSE',
    table_name: 'bank_reconciliations', record_id: id,
    new_value: { period_start: recon.period_start, period_end: recon.period_end },
  })
  return c.json({ success: true, data: null })
})

export default banking
