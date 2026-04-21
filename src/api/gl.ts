import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { postAutoEntry, getOpenPeriod } from '../lib/gl'
import { logAudit } from '../lib/audit'

const gl = new Hono<{ Bindings: Env }>()
gl.use('*', authMiddleware)

// ── Chart of Accounts ─────────────────────────────────────────

gl.get('/accounts', async (c) => {
  const { company_id } = getUser(c)
  const type = c.req.query('type')
  let sql = 'SELECT * FROM chart_of_accounts WHERE company_id = ?'
  const p: unknown[] = [company_id]
  if (type) { sql += ' AND account_type = ?'; p.push(type) }
  sql += ' ORDER BY code'
  const { results } = await c.env.DB.prepare(sql).bind(...p).all()
  return c.json({ success: true, data: results })
})

gl.post('/accounts', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{
    code: string; name: string; account_type: string; normal_balance?: string
    parent_code?: string; level?: number; is_header?: number; notes?: string
  }>()
  if (!b.code || !b.name || !b.account_type) {
    return c.json({ success: false, error: 'الكود والاسم والنوع مطلوبة' }, 400)
  }
  const types = ['asset','liability','equity','revenue','expense']
  if (!types.includes(b.account_type)) {
    return c.json({ success: false, error: 'نوع الحساب غير صالح' }, 400)
  }
  const normalBalance = b.normal_balance ?? (['asset','expense'].includes(b.account_type) ? 'debit' : 'credit')
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header,notes)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.code, b.name, b.account_type, normalBalance,
           b.parent_code ?? null, b.level ?? 3, b.is_header ?? 0, b.notes ?? null).run()
    return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
  } catch {
    return c.json({ success: false, error: 'الكود موجود مسبقاً' }, 409)
  }
})

gl.patch('/accounts/:code', async (c) => {
  const { company_id } = getUser(c)
  const code = c.req.param('code')
  const b    = await c.req.json<Record<string,unknown>>()
  const allowed = ['name','notes','is_active','parent_code']
  const cols = Object.keys(b).filter(k => allowed.includes(k))
  if (!cols.length) return c.json({ success: false, error: 'لا توجد حقول' }, 400)
  await c.env.DB.prepare(
    `UPDATE chart_of_accounts SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE code = ? AND company_id = ?`
  ).bind(...cols.map(f => b[f]), code, company_id).run()
  return c.json({ success: true, data: null })
})

// ── GL Mappings (حسابات الربط الافتراضية) ────────────────────

gl.get('/mappings', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM gl_account_mappings WHERE company_id = ?')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

gl.put('/mappings', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ mapping_key: string; account_code: string }[]>()
  for (const m of b) {
    await c.env.DB.prepare(
      `INSERT INTO gl_account_mappings (company_id, mapping_key, account_code)
       VALUES (?,?,?)
       ON CONFLICT(company_id, mapping_key) DO UPDATE SET account_code = excluded.account_code`
    ).bind(company_id, m.mapping_key, m.account_code).run()
  }
  return c.json({ success: true, data: null })
})

// ── Financial Periods ─────────────────────────────────────────

gl.get('/periods', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM financial_periods WHERE company_id = ? ORDER BY start_date DESC')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

gl.post('/periods', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{
    name: string; period_type?: string; start_date: string; end_date: string
  }>()
  if (!b.name || !b.start_date || !b.end_date) {
    return c.json({ success: false, error: 'الاسم والتواريخ مطلوبة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO financial_periods (company_id, name, period_type, start_date, end_date) VALUES (?,?,?,?,?)`
  ).bind(company_id, b.name, b.period_type ?? 'monthly', b.start_date, b.end_date).run()
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

gl.patch('/periods/:id/close', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE financial_periods SET is_closed = 1, closed_at = datetime('now'), closed_by = ? WHERE id = ? AND company_id = ?`
  ).bind(userId, id, company_id).run()
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CLOSE', table_name: 'financial_periods', record_id: id,
  })
  return c.json({ success: true, data: null })
})

gl.patch('/periods/:id/reopen', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE financial_periods SET is_closed = 0, closed_at = NULL, closed_by = NULL WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).run()
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'REOPEN', table_name: 'financial_periods', record_id: id,
  })
  return c.json({ success: true, data: null })
})

// ── Journal Entries ───────────────────────────────────────────

gl.get('/entries', async (c) => {
  const { company_id } = getUser(c)
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(100, Number(c.req.query('size') ?? 50))
  const offset    = (page - 1) * size
  const start     = c.req.query('start')
  const end       = c.req.query('end')
  const ref_type  = c.req.query('ref_type')

  let where = 'WHERE e.company_id = ?'
  const p: unknown[] = [company_id]
  if (start)    { where += ' AND e.entry_date >= ?'; p.push(start) }
  if (end)      { where += ' AND e.entry_date <= ?'; p.push(end) }
  if (ref_type) { where += ' AND e.ref_type = ?';   p.push(ref_type) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT e.*, fp.name AS period_name,
              (SELECT SUM(l.debit)  FROM journal_entry_lines l WHERE l.entry_id = e.id) AS total_debit,
              (SELECT SUM(l.credit) FROM journal_entry_lines l WHERE l.entry_id = e.id) AS total_credit
       FROM journal_entries e
       LEFT JOIN financial_periods fp ON fp.id = e.period_id
       ${where}
       ORDER BY e.entry_date DESC, e.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...p, size, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM journal_entries e ${where}`)
      .bind(...p).first<{n:number}>(),
  ])

  return c.json({ success: true, data: rows.results, total: cnt?.n ?? 0, page, page_size: size })
})

gl.get('/entries/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const [entry, lines] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM journal_entries WHERE id = ? AND company_id = ?')
      .bind(id, company_id).first(),
    c.env.DB.prepare(
      `SELECT l.*, a.name AS account_name, a.account_type FROM journal_entry_lines l
       LEFT JOIN chart_of_accounts a ON a.code = l.account_code AND a.company_id = l.company_id
       WHERE l.entry_id = ? ORDER BY l.id`
    ).bind(id).all(),
  ])
  if (!entry) return c.json({ success: false, error: 'القيد غير موجود' }, 404)
  return c.json({ success: true, data: { ...entry, lines: lines.results } })
})

gl.post('/entries', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    entry_date: string
    description: string
    lines: { account_code: string; debit: number; credit: number; description?: string }[]
  }>()

  if (!b.entry_date || !b.description || !b.lines?.length) {
    return c.json({ success: false, error: 'بيانات القيد ناقصة' }, 400)
  }
  const totalDebit  = b.lines.reduce((s, l) => s + (l.debit  ?? 0), 0)
  const totalCredit = b.lines.reduce((s, l) => s + (l.credit ?? 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return c.json({ success: false, error: `القيد غير متوازن — مدين: ${totalDebit.toFixed(2)} / دائن: ${totalCredit.toFixed(2)}` }, 400)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.entry_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.entry_date}` }, 400)
  }

  await postAutoEntry(c.env.DB, {
    company_id, entry_date: b.entry_date, description: b.description,
    ref_type: 'manual', ref_id: 0, lines: b.lines, created_by: userId,
  })

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'journal_entries',
    new_value: { entry_date: b.entry_date, description: b.description, total: totalDebit },
  })

  return c.json({ success: true, data: null }, 201)
})

// ── Account Ledger (دفتر الأستاذ) ────────────────────────────

gl.get('/ledger/:code', async (c) => {
  const { company_id } = getUser(c)
  const code  = c.req.param('code')
  const start = c.req.query('start')
  const end   = c.req.query('end')

  let where = 'WHERE l.account_code = ? AND l.company_id = ?'
  const p: unknown[] = [code, company_id]
  if (start) { where += ' AND e.entry_date >= ?'; p.push(start) }
  if (end)   { where += ' AND e.entry_date <= ?'; p.push(end) }

  const [account, lines] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM chart_of_accounts WHERE code = ? AND company_id = ?')
      .bind(code, company_id).first(),
    c.env.DB.prepare(
      `SELECT l.*, e.entry_date, e.description AS entry_desc, e.ref_type, e.ref_id
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.entry_id AND e.is_posted = 1
       ${where}
       ORDER BY e.entry_date, e.id, l.id`
    ).bind(...p).all(),
  ])

  if (!account) return c.json({ success: false, error: 'الحساب غير موجود' }, 404)

  // Add running balance
  let running = 0
  const linesWithBalance = (lines.results as Record<string,unknown>[]).map(l => {
    running += (l.debit as number) - (l.credit as number)
    return { ...l, running_balance: running }
  })

  return c.json({ success: true, data: { account, lines: linesWithBalance } })
})

// ── Trial Balance (ميزان المراجعة) ───────────────────────────

gl.get('/trial-balance', async (c) => {
  const { company_id } = getUser(c)
  const start = c.req.query('start')
  const end   = c.req.query('end')

  let entryWhere = 'e.is_posted = 1 AND e.company_id = ?'
  const p: unknown[] = [company_id]
  if (start) { entryWhere += ' AND e.entry_date >= ?'; p.push(start) }
  if (end)   { entryWhere += ' AND e.entry_date <= ?'; p.push(end) }

  const { results } = await c.env.DB.prepare(
    `SELECT a.code, a.name, a.account_type, a.normal_balance, a.level, a.is_header,
            COALESCE(SUM(l.debit),  0) AS total_debit,
            COALESCE(SUM(l.credit), 0) AS total_credit,
            CASE WHEN a.normal_balance = 'debit'
                 THEN COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)
                 ELSE COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0) END AS balance
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND ${entryWhere}
     WHERE a.company_id = ? AND a.is_active = 1
     GROUP BY a.code, a.name, a.account_type, a.normal_balance, a.level, a.is_header
     ORDER BY a.code`
  ).bind(...p, company_id).all()

  const totalDebit  = (results as Record<string,number>[]).reduce((s,r) => s + (r.total_debit  ?? 0), 0)
  const totalCredit = (results as Record<string,number>[]).reduce((s,r) => s + (r.total_credit ?? 0), 0)

  return c.json({ success: true, data: { accounts: results, total_debit: totalDebit, total_credit: totalCredit } })
})

// ── Income Statement (قائمة الدخل / P&L) ─────────────────────

gl.get('/income-statement', async (c) => {
  const { company_id } = getUser(c)
  const start = c.req.query('start')
  const end   = c.req.query('end')

  let entryWhere = 'e.is_posted = 1 AND e.company_id = ?'
  const p: unknown[] = [company_id]
  if (start) { entryWhere += ' AND e.entry_date >= ?'; p.push(start) }
  if (end)   { entryWhere += ' AND e.entry_date <= ?'; p.push(end) }

  const { results } = await c.env.DB.prepare(
    `SELECT a.code, a.name, a.account_type, a.parent_code, a.level, a.is_header,
            CASE WHEN a.account_type = 'revenue'
                 THEN COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0)
                 ELSE COALESCE(SUM(l.debit),0)  - COALESCE(SUM(l.credit),0) END AS amount
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND ${entryWhere}
     WHERE a.company_id = ? AND a.account_type IN ('revenue','expense') AND a.is_active = 1
     GROUP BY a.code, a.name, a.account_type, a.parent_code, a.level, a.is_header
     ORDER BY a.account_type DESC, a.code`
  ).bind(...p, company_id).all()

  const rows = results as { code: string; name: string; account_type: string; is_header: number; amount: number }[]
  const revenue  = rows.filter(r => r.account_type === 'revenue' && !r.is_header)
  const expenses = rows.filter(r => r.account_type === 'expense' && !r.is_header)
  const totalRevenue  = revenue.reduce((s, r)  => s + r.amount, 0)
  const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0)

  return c.json({ success: true, data: {
    revenue, expenses, total_revenue: totalRevenue,
    total_expenses: totalExpenses, net_income: totalRevenue - totalExpenses,
  }})
})

// ── Balance Sheet (الميزانية العمومية) ───────────────────────

gl.get('/balance-sheet', async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? new Date().toISOString().slice(0,10)

  const { results } = await c.env.DB.prepare(
    `SELECT a.code, a.name, a.account_type, a.normal_balance, a.parent_code, a.level, a.is_header,
            CASE WHEN a.normal_balance = 'debit'
                 THEN COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)
                 ELSE COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0) END AS balance
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.is_posted = 1 AND e.entry_date <= ?
     WHERE a.company_id = ? AND a.account_type IN ('asset','liability','equity') AND a.is_active = 1
     GROUP BY a.code, a.name, a.account_type, a.normal_balance, a.parent_code, a.level, a.is_header
     ORDER BY a.code`
  ).bind(asOf, company_id).all()

  const rows = results as { code:string; name:string; account_type:string; is_header:number; balance:number }[]
  const assets      = rows.filter(r => r.account_type === 'asset')
  const liabilities = rows.filter(r => r.account_type === 'liability')
  const equity      = rows.filter(r => r.account_type === 'equity')

  const totalAssets      = assets.filter(r => !r.is_header).reduce((s, r) => s + r.balance, 0)
  const totalLiabilities = liabilities.filter(r => !r.is_header).reduce((s, r) => s + r.balance, 0)
  const totalEquity      = equity.filter(r => !r.is_header).reduce((s, r) => s + r.balance, 0)

  return c.json({ success: true, data: {
    assets, liabilities, equity,
    total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity,
    as_of: asOf,
  }})
})

export default gl
