import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'
import { postAutoEntry, getOpenPeriod } from '../lib/gl'
import { logAudit } from '../lib/audit'
import {
  resolveInventoryMovement as peResolveInventory,
  resolveSupplierInvoice   as peResolveSupplierInvoice,
  resolveSupplierPayment   as peResolveSupplierPayment,
  resolveExpensePosting    as peResolveExpense,
  resolveSalesRevenue      as peResolveSalesRevenue,
  clearPostingEngineCaches,
} from '../lib/posting_engine'

const gl = new Hono<{ Bindings: Env }>()
gl.use('*', authMiddleware)
// RBAC: General Ledger and period management are restricted to accounting roles.
gl.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

type CoaNode = { code: string; parent_code: string | null }

function hasCoaCycle(nodes: CoaNode[]): boolean {
  const parentOf = new Map<string, string | null>()
  for (const n of nodes) parentOf.set(n.code, n.parent_code)

  const state = new Map<string, 0 | 1 | 2>()
  const visit = (code: string): boolean => {
    const s = state.get(code) ?? 0
    if (s === 1) return true
    if (s === 2) return false
    state.set(code, 1)
    const parent = parentOf.get(code)
    if (parent && parentOf.has(parent) && visit(parent)) return true
    state.set(code, 2)
    return false
  }

  for (const n of nodes) {
    if (visit(n.code)) return true
  }
  return false
}

async function validateCoaParent(
  db: Env['DB'],
  company_id: number,
  code: string,
  parent_code: string | null,
): Promise<string | null> {
  if (!parent_code) return null
  if (parent_code === code) return 'لا يمكن أن يكون الحساب أباً لنفسه'

  const parent = await db.prepare(
    'SELECT code FROM chart_of_accounts WHERE company_id = ? AND code = ?'
  ).bind(company_id, parent_code).first<{ code: string }>()
  if (!parent) return `الحساب الأب (${parent_code}) غير موجود`

  const all = await db.prepare(
    'SELECT code, parent_code FROM chart_of_accounts WHERE company_id = ?'
  ).bind(company_id).all<CoaNode>()

  const byCode = new Map(all.results.map(r => [r.code, r]))
  if (byCode.has(code)) {
    byCode.set(code, { code, parent_code })
  } else {
    byCode.set(code, { code, parent_code })
  }

  if (hasCoaCycle([...byCode.values()])) {
    return 'تحديث الشجرة يسبب دورة في parent_code (circular reference)'
  }

  return null
}

// ── Chart of Accounts ─────────────────────────────────────────

gl.get('/accounts', async (c) => {
  const { company_id } = getUser(c)
  const type       = c.req.query('type')
  const leafOnly   = c.req.query('leaf') === '1'   // leaf=1 → exclude header accounts
  let sql = 'SELECT * FROM chart_of_accounts WHERE company_id = ? AND is_active = 1'
  const p: unknown[] = [company_id]
  if (type)     { sql += ' AND account_type = ?'; p.push(type) }
  if (leafOnly) { sql += ' AND is_header = 0' }
  sql += ' ORDER BY code'
  const { results } = await c.env.DB.prepare(sql).bind(...p).all()
  return c.json({ success: true, data: results })
})

gl.get('/accounts/usage-metadata', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT
       a.code AS account_code,
       COALESCE(u.usage_count, 0) AS usage_count,
       u.last_used_date,
       CASE WHEN COALESCE(u.usage_count, 0) > 0 THEN 1 ELSE 0 END AS is_locked
     FROM chart_of_accounts a
     LEFT JOIN (
       SELECT
         l.account_code,
         COUNT(*) AS usage_count,
         MAX(e.entry_date) AS last_used_date
       FROM journal_entry_lines l
       JOIN journal_entries e
         ON e.id = l.entry_id
        AND e.company_id = l.company_id
        AND e.is_posted = 1
       WHERE l.company_id = ?
       GROUP BY l.account_code
     ) u ON u.account_code = a.code
     WHERE a.company_id = ?
     ORDER BY a.code`
  ).bind(company_id, company_id).all()

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
  const parentError = await validateCoaParent(c.env.DB, company_id, b.code, b.parent_code ?? null)
  if (parentError) {
    return c.json({ success: false, error: parentError }, 400)
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

  if (Object.prototype.hasOwnProperty.call(b, 'parent_code')) {
    const parentCode = (b.parent_code ?? null) as string | null
    const parentError = await validateCoaParent(c.env.DB, company_id, code, parentCode)
    if (parentError) {
      return c.json({ success: false, error: parentError }, 400)
    }
  }

  await c.env.DB.prepare(
    `UPDATE chart_of_accounts SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE code = ? AND company_id = ?`
  ).bind(...cols.map(f => b[f]), code, company_id).run()
  return c.json({ success: true, data: null })
})

// ── GL Mappings — DEPRECATED ────────────────────────────────
// Replaced by: /gl/posting-groups/* + /gl/posting-setup/*
// These endpoints are kept for backward-compat only.
// Clients should migrate to the posting-engine setup routes.

const MAPPINGS_DEPRECATION_DATE   = 'Sat, 01 Aug 2026 00:00:00 GMT'
const MAPPINGS_DEPRECATION_LINK   = 'rel="sunset"; url="/gl/posting-setup"'

gl.get('/mappings', async (c) => {
  const { company_id } = getUser(c)
  c.header('Deprecation', MAPPINGS_DEPRECATION_DATE)
  c.header('Sunset', MAPPINGS_DEPRECATION_DATE)
  c.header('Link', MAPPINGS_DEPRECATION_LINK)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM gl_account_mappings WHERE company_id = ?')
    .bind(company_id).all()
  return c.json({
    success: true,
    data: results,
    _deprecated: 'هذا المسار قديم. استخدم /gl/posting-setup بدلاً منه.',
  })
})

// PUT /gl/mappings — LOCKED (writes disabled, sunset Aug 2026)
gl.put('/mappings', async (c) => {
  c.header('Deprecation', MAPPINGS_DEPRECATION_DATE)
  c.header('Sunset', MAPPINGS_DEPRECATION_DATE)
  c.header('Link', MAPPINGS_DEPRECATION_LINK)
  return c.json({
    success: false,
    error: 'هذا المسار قديم وأُغلق للكتابة. استخدم /gl/posting-setup لإعداد مجموعات الترحيل.',
    migrate_to: '/gl/posting-setup',
  }, 405)
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
              (SELECT SUM(l.credit) FROM journal_entry_lines l WHERE l.entry_id = e.id) AS total_credit,
              (SELECT rev.id FROM journal_entries rev
               WHERE rev.ref_type = 'reversal' AND rev.ref_id = e.id AND rev.company_id = e.company_id
               LIMIT 1) AS reversal_entry_id
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
      `SELECT l.*, a.name AS account_name, a.account_type, s.name AS season_name, f.name AS field_name
       FROM journal_entry_lines l
       LEFT JOIN chart_of_accounts a ON a.code = l.account_code AND a.company_id = l.company_id
       LEFT JOIN seasons s ON s.id = l.season_id
       LEFT JOIN fields f ON f.id = l.field_id
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

// Builds a map: account code → set of all descendant codes (including itself)
// Uses parent_code relationships — correct for any code scheme, not just numeric prefixes.
function buildDescendants(accounts: { code: string; parent_code: string | null }[]): Map<string, Set<string>> {
  const childrenOf = new Map<string, string[]>()
  for (const acc of accounts) {
    if (acc.parent_code) {
      if (!childrenOf.has(acc.parent_code)) childrenOf.set(acc.parent_code, [])
      childrenOf.get(acc.parent_code)!.push(acc.code)
    }
  }
  const cache = new Map<string, Set<string>>()
  const visiting = new Set<string>()
  function collect(code: string): Set<string> {
    if (cache.has(code)) return cache.get(code)!
    if (visiting.has(code)) {
      throw new Error(`COA_CYCLE: circular parent relation detected at account ${code}`)
    }
    visiting.add(code)
    const set = new Set<string>([code])
    for (const child of (childrenOf.get(code) ?? [])) {
      for (const d of collect(child)) set.add(d)
    }
    cache.set(code, set)
    visiting.delete(code)
    return set
  }
  for (const acc of accounts) collect(acc.code)
  return cache
}

// ── Trial Balance (ميزان المراجعة) ───────────────────────────

gl.get('/trial-balance', async (c) => {
  const { company_id } = getUser(c)
  const start = c.req.query('start')
  const end   = c.req.query('end')

  let entryWhere = 'e.is_posted = 1 AND e.company_id = ?'
  const p: unknown[] = [company_id]
  if (start) { entryWhere += ' AND e.entry_date >= ?'; p.push(start) }
  if (end)   { entryWhere += ' AND e.entry_date <= ?'; p.push(end) }

  // 1. Get raw leaf balances
  const rawBalances = await c.env.DB.prepare(
    `SELECT a.code, a.parent_code, a.is_header,
            COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END), 0) AS leaf_debit,
            COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END), 0) AS leaf_credit
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND ${entryWhere}
     WHERE a.company_id = ? AND a.is_active = 1
     GROUP BY a.code`
  ).bind(...p, company_id).all<{ code: string; parent_code: string | null; is_header: number; leaf_debit: number; leaf_credit: number }>()

  // 2. Get all accounts to build the tree
  const allAccounts = await c.env.DB.prepare(
    'SELECT code, name, account_type, normal_balance, parent_code, level, is_header FROM chart_of_accounts WHERE company_id = ? AND is_active = 1 ORDER BY code'
  ).bind(company_id).all<{ code: string; name: string; account_type: string; normal_balance: string; parent_code: string | null; level: number; is_header: number }>()

  // 3. Consolidate in code (Recursive)
  const debitMap = new Map<string, number>()
  const creditMap = new Map<string, number>()
  for (const b of rawBalances.results) {
    debitMap.set(b.code, b.leaf_debit)
    creditMap.set(b.code, b.leaf_credit)
  }

  const descendants = buildDescendants(allAccounts.results)
  const finalAccounts = allAccounts.results.map(acc => {
    let totalD = 0; let totalC = 0
    const descSet = descendants.get(acc.code) ?? new Set([acc.code])
    for (const b of rawBalances.results) {
      if (descSet.has(b.code)) {
        totalD += b.leaf_debit
        totalC += b.leaf_credit
      }
    }
    const bal = acc.normal_balance === 'debit' ? (totalD - totalC) : (totalC - totalD)
    return { ...acc, total_debit: totalD, total_credit: totalC, balance: bal }
  })

  const totalDebit  = rawBalances.results.reduce((s, r) => s + r.leaf_debit, 0)
  const totalCredit = rawBalances.results.reduce((s, r) => s + r.leaf_credit, 0)

  return c.json({ success: true, data: { accounts: finalAccounts, total_debit: totalDebit, total_credit: totalCredit } })
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

  // 1. Get raw leaf balances for Revenue/Expense
  const raw = await c.env.DB.prepare(
    `SELECT a.code, a.account_type,
            SUM(CASE WHEN e.id IS NOT NULL THEN (CASE WHEN a.account_type = 'revenue' THEN (l.credit - l.debit) ELSE (l.debit - l.credit) END) ELSE 0 END) AS amount
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND ${entryWhere}
     WHERE a.company_id = ? AND a.account_type IN ('revenue','expense') AND a.is_active = 1
     GROUP BY a.code`
  ).bind(...p, company_id).all<{ code: string; account_type: string; amount: number }>()

  // 2. Get all Revenue/Expense accounts
  const allAccs = await c.env.DB.prepare(
    `SELECT code, name, account_type, parent_code, level, is_header FROM chart_of_accounts
     WHERE company_id = ? AND account_type IN ('revenue','expense') AND is_active = 1
     ORDER BY account_type DESC, code`
  ).bind(company_id).all<{ code: string; name: string; account_type: string; parent_code: string | null; level: number; is_header: number }>()

  const descendants = buildDescendants(allAccs.results)
  const finalRows = allAccs.results.map(acc => {
    let sum = 0
    const descSet = descendants.get(acc.code) ?? new Set([acc.code])
    for (const r of raw.results) {
      if (descSet.has(r.code)) sum += (r.amount ?? 0)
    }
    return { ...acc, amount: sum }
  })

  const revenue  = finalRows.filter(r => r.account_type === 'revenue')
  const expenses = finalRows.filter(r => r.account_type === 'expense')
  const totalRevenue  = raw.results.filter(r => r.account_type === 'revenue').reduce((s, r) => s + r.amount, 0)
  const totalExpenses = raw.results.filter(r => r.account_type === 'expense').reduce((s, r) => s + r.amount, 0)

  return c.json({ success: true, data: {
    revenue, expenses, total_revenue: totalRevenue,
    total_expenses: totalExpenses, net_income: totalRevenue - totalExpenses,
  }})
})

// ── Balance Sheet (الميزانية العمومية) ───────────────────────

gl.get('/balance-sheet', async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? new Date().toISOString().slice(0,10)

  // 1. Get raw leaf balances for BS accounts
  const raw = await c.env.DB.prepare(
    `SELECT a.code, a.account_type, a.normal_balance,
            CASE WHEN a.normal_balance = 'debit'
                 THEN COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END),0) - COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END),0)
                 ELSE COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END),0) - COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END),0) END AS balance
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.is_posted = 1 AND e.entry_date <= ?
     WHERE a.company_id = ? AND a.account_type IN ('asset','liability','equity') AND a.is_active = 1
     GROUP BY a.code`
  ).bind(asOf, company_id).all<{ code: string; account_type: string; normal_balance: string; balance: number }>()

  // 2. Get all BS accounts
  const allAccs = await c.env.DB.prepare(
    `SELECT code, name, account_type, normal_balance, parent_code, level, is_header FROM chart_of_accounts
     WHERE company_id = ? AND account_type IN ('asset','liability','equity') AND is_active = 1
     ORDER BY code`
  ).bind(company_id).all<{ code: string; name: string; account_type: string; normal_balance: string; parent_code: string | null; level: number; is_header: number }>()

  const descendants = buildDescendants(allAccs.results)
  const finalRows = allAccs.results.map(acc => {
    let sum = 0
    const descSet = descendants.get(acc.code) ?? new Set([acc.code])
    for (const r of raw.results) {
      if (descSet.has(r.code)) sum += (r.balance ?? 0)
    }
    return { ...acc, balance: sum }
  })

  const assets      = finalRows.filter(r => r.account_type === 'asset')
  const liabilities = finalRows.filter(r => r.account_type === 'liability')
  const equity      = finalRows.filter(r => r.account_type === 'equity')

  const totalAssets      = raw.results.filter(r => r.account_type === 'asset').reduce((s, r) => s + r.balance, 0)
  const totalLiabilities = raw.results.filter(r => r.account_type === 'liability').reduce((s, r) => s + r.balance, 0)
  const totalEquity      = raw.results.filter(r => r.account_type === 'equity').reduce((s, r) => s + r.balance, 0)

  return c.json({ success: true, data: {
    assets, liabilities, equity,
    total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity,
    as_of: asOf,
  }})
})

// POST /api/gl/entries/:id/reverse — create a mirror entry with negated lines
gl.post('/entries/:id/reverse', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  // Fetch original entry
  const [entry, linesRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM journal_entries WHERE id = ? AND company_id = ?')
      .bind(id, company_id).first<{
        id: number; description: string; entry_date: string; is_posted: number; ref_type: string
      }>(),
    c.env.DB.prepare(
      'SELECT account_code, debit, credit, description, center_code, season_id, field_id FROM journal_entry_lines WHERE entry_id = ?'
    ).bind(id).all<{
      account_code: string; debit: number; credit: number
      description: string | null; center_code: number | null; season_id: number | null; field_id: number | null
    }>(),
  ])

  if (!entry) return c.json({ success: false, error: 'القيد غير موجود' }, 404)
  if (!entry.is_posted) return c.json({ success: false, error: 'لا يمكن عكس قيد غير مرحّل' }, 400)

  // Check not already reversed
  const alreadyReversed = await c.env.DB.prepare(
    "SELECT id FROM journal_entries WHERE company_id = ? AND ref_type = 'reversal' AND ref_id = ?"
  ).bind(company_id, id).first()
  if (alreadyReversed) {
    return c.json({ success: false, error: 'هذا القيد تم عكسه مسبقاً' }, 409)
  }

  const today = new Date().toISOString().slice(0, 10)
  const periodId = await getOpenPeriod(c.env.DB, company_id, today)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${today}` }, 400)
  }

  const lines = linesRes.results
  if (!lines.length) return c.json({ success: false, error: 'القيد لا يحتوي على سطور' }, 400)

  const reversalEntryId = await postAutoEntry(c.env.DB, {
    company_id,
    entry_date:  today,
    description: `عكس القيد: ${entry.description}`,
    ref_type:    'reversal',
    ref_id:      id,
    created_by:  userId,
    lines: lines.map(l => ({
      account_code: l.account_code,
      debit:        l.credit,
      credit:       l.debit,
      description:  l.description ?? undefined,
      center_code:  l.center_code ?? undefined,
      season_id:    l.season_id  ?? undefined,
      field_id:     l.field_id   ?? undefined,
    })),
  })

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'journal_entries',
    new_value: { reversal_of: id, reversal_entry_id: reversalEntryId },
  })

  return c.json({ success: true, data: { reversal_entry_id: reversalEntryId } }, 201)
})

// GET /api/gl/integrity-check — 6 data quality checks for this company
gl.get('/integrity-check', async (c) => {
  const { company_id } = getUser(c)

  const REQUIRED_MAPPINGS = [
    'cash', 'inventory', 'accounts_payable', 'revenue_default',
    'expense_default', 'purchases', 'wages', 'cogs', 'wages_payable',
  ]

  const [unbalancedRow, negStockRow, draftTxRow, staleWoRow, mappedRow, oldPoRow, harvestIntRow, harvestMappingsRow] =
    await Promise.all([
      // 1. GL entries where debit ≠ credit
      c.env.DB.prepare(`
        SELECT COUNT(*) AS n FROM (
          SELECT je.id FROM journal_entries je
          JOIN journal_entry_lines jel ON jel.entry_id = je.id
          WHERE je.company_id = ?
          GROUP BY je.id
          HAVING ABS(ROUND(SUM(jel.debit), 2) - ROUND(SUM(jel.credit), 2)) > 0.01
        )
      `).bind(company_id).first<{ n: number }>(),

      // 2. Items with negative running balance
      c.env.DB.prepare(`
        SELECT COUNT(DISTINCT im.item_code) AS n
        FROM inventory_movements im
        WHERE im.company_id = ?
          AND im.balance_qty IS NOT NULL AND im.balance_qty < 0
          AND im.id = (
            SELECT MAX(id) FROM inventory_movements im2
            WHERE im2.item_code = im.item_code AND im2.company_id = im.company_id
          )
      `).bind(company_id).first<{ n: number }>(),

      // 3. Cash transactions still in draft (unposted)
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM cash_transactions WHERE company_id = ? AND status = 'draft'`
      ).bind(company_id).first<{ n: number }>(),

      // 4. Work orders open for > 60 days
      c.env.DB.prepare(`
        SELECT COUNT(*) AS n FROM work_orders
        WHERE company_id = ? AND status IN ('pending', 'in_progress')
          AND julianday('now') - julianday(created_at) > 60
      `).bind(company_id).first<{ n: number }>(),

      // 5. Required GL mapping keys present
      c.env.DB.prepare(`
        SELECT COUNT(*) AS n FROM gl_account_mappings
        WHERE company_id = ? AND mapping_key IN (${REQUIRED_MAPPINGS.map(() => '?').join(',')})
      `).bind(company_id, ...REQUIRED_MAPPINGS).first<{ n: number }>(),

      // 6. Purchase orders in sent/partial state for > 90 days
      c.env.DB.prepare(`
        SELECT COUNT(*) AS n FROM purchase_orders
        WHERE company_id = ? AND status IN ('sent', 'partial')
          AND julianday('now') - julianday(created_at) > 90
      `).bind(company_id).first<{ n: number }>(),

      // 7a. Is harvest GL integration enabled?
      c.env.DB.prepare(
        `SELECT is_enabled FROM gl_integration_settings WHERE company_id = ? AND module_key = 'harvest'`
      ).bind(company_id).first<{ is_enabled: number }>(),

      // 7b. How many of the 3 harvest mapping keys are configured?
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM gl_account_mappings
         WHERE company_id = ? AND mapping_key IN ('harvest_revenue','harvest_cogs','receivable_default')`
      ).bind(company_id).first<{ n: number }>(),
    ])

  const missingMappings  = REQUIRED_MAPPINGS.length - (mappedRow?.n ?? 0)
  const harvestEnabled   = (harvestIntRow?.is_enabled ?? 0) === 1
  const harvestMissing   = 3 - (harvestMappingsRow?.n ?? 0)

  const checks = [
    {
      key: 'unbalanced_entries',
      label: 'قيود دفتر الأستاذ متوازنة',
      description: 'كل قيد يجب أن يكون مجموع المدين = مجموع الدائن تماماً',
      count: unbalancedRow?.n ?? 0,
      ok: (unbalancedRow?.n ?? 0) === 0,
      blocker: true,
      action_url: '/gl/entries',
    },
    {
      key: 'negative_stock',
      label: 'لا يوجد رصيد مخزون سالب',
      description: 'أصناف وصل رصيدها لأقل من صفر — يدل على صرف بدون استلام',
      count: negStockRow?.n ?? 0,
      ok: (negStockRow?.n ?? 0) === 0,
      blocker: true,
      action_url: '/inventory',
    },
    {
      key: 'draft_transactions',
      label: 'لا توجد معاملات نقدية معلقة',
      description: 'معاملات في مسودة لم تُرحَّل بعد — لا تظهر في رصيد الخزينة',
      count: draftTxRow?.n ?? 0,
      ok: (draftTxRow?.n ?? 0) === 0,
      blocker: false,
      action_url: '/treasury',
    },
    {
      key: 'stale_work_orders',
      label: 'لا توجد أوامر شغل متوقفة (> 60 يوم)',
      description: 'أوامر شغل مفتوحة تجاوزت 60 يوماً بدون إتمام أو إلغاء',
      count: staleWoRow?.n ?? 0,
      ok: (staleWoRow?.n ?? 0) === 0,
      blocker: false,
      action_url: '/operations',
    },
    {
      key: 'gl_mappings',
      label: 'ربط الحسابات التلقائية مكتمل',
      description: `${REQUIRED_MAPPINGS.length} حسابات مطلوبة للترحيل التلقائي للقيود`,
      count: missingMappings,
      ok: missingMappings === 0,
      blocker: true,
      action_url: '/gl/mappings',
    },
    {
      key: 'old_purchase_orders',
      label: 'لا توجد أوامر شراء مفتوحة قديمة (> 90 يوم)',
      description: 'أوامر شراء مرسلة أو جزئية تجاوزت 90 يوماً بدون استكمال',
      count: oldPoRow?.n ?? 0,
      ok: (oldPoRow?.n ?? 0) === 0,
      blocker: false,
      action_url: '/treasury/purchase-orders',
    },
    {
      key: 'harvest_gl_mappings',
      label: 'ربط حسابات الحصاد',
      description: 'ثلاثة حسابات مطلوبة لترحيل الحصاد تلقائياً (إيراد + تكلفة + ذمم مدينة)',
      count: harvestEnabled ? harvestMissing : 0,
      ok: !harvestEnabled || harvestMissing === 0,
      blocker: false,
      action_url: '/gl/mappings',
    },
  ]

  const passing     = checks.filter(ch => ch.ok).length
  const score       = Math.round((passing / checks.length) * 100)
  const overall_ok  = passing === checks.length
  const has_blockers = checks.some(ch => !ch.ok && ch.blocker)

  return c.json({ success: true, data: { checks, overall_ok, has_blockers, score } })
})

// =============================================================================
// POSTING GROUPS CRUD
// =============================================================================

const PG_TABLES = {
  business:  'business_posting_groups',
  product:   'product_posting_groups',
  inventory: 'inventory_posting_groups',
} as const
type PgType = keyof typeof PG_TABLES

const CODE_RE = /^[A-Z0-9_-]{1,20}$/

// GET /api/gl/posting-groups/:type
gl.get('/posting-groups/:type', async (c) => {
  const type = c.req.param('type') as PgType
  if (!PG_TABLES[type]) return c.json({ success: false, error: 'Invalid type. Use: business | product | inventory' }, 400)
  const { company_id } = getUser(c)
  const table = PG_TABLES[type]
  const { results } = await c.env.DB
    .prepare(`SELECT code, name, description, is_active, created_at FROM ${table} WHERE company_id = ? ORDER BY code`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/gl/posting-groups/:type
gl.post('/posting-groups/:type', async (c) => {
  const type = c.req.param('type') as PgType
  if (!PG_TABLES[type]) return c.json({ success: false, error: 'Invalid type' }, 400)
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{ code: string; name: string; description?: string }>()

  if (!body.code || !CODE_RE.test(body.code.toUpperCase()))
    return c.json({ success: false, error: 'code must be 1–20 uppercase letters, digits, underscores or dashes' }, 422)
  if (!body.name?.trim())
    return c.json({ success: false, error: 'name is required' }, 422)

  const code = body.code.toUpperCase()
  const table = PG_TABLES[type]
  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND code = ?`)
    .bind(company_id, code).first()
  if (exists) return c.json({ success: false, error: `Code "${code}" already exists` }, 409)

  await c.env.DB
    .prepare(`INSERT INTO ${table} (company_id, code, name, description, is_active, created_at) VALUES (?,?,?,?,1,datetime('now'))`)
    .bind(company_id, code, body.name.trim(), body.description?.trim() ?? null).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: table, new_value: { code } })
  return c.json({ success: true, data: { code } }, 201)
})

// PATCH /api/gl/posting-groups/:type/:code
gl.patch('/posting-groups/:type/:code', async (c) => {
  const type = c.req.param('type') as PgType
  if (!PG_TABLES[type]) return c.json({ success: false, error: 'Invalid type' }, 400)
  const { company_id, sub: userId } = getUser(c)
  const code = c.req.param('code').toUpperCase()
  const table = PG_TABLES[type]

  const existing = await c.env.DB
    .prepare(`SELECT is_active FROM ${table} WHERE company_id = ? AND code = ?`)
    .bind(company_id, code).first<{ is_active: number }>()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  const body = await c.req.json<{ name?: string; description?: string; is_active?: boolean }>()

  // Prevent deactivating a group that is still referenced in posting setup
  if (body.is_active === false && existing.is_active === 1) {
    const setupTableGeneral = 'general_posting_setup'
    const setupTableInv     = 'inventory_posting_setup'
    const col = type === 'business' ? 'bus_posting_group_code'
              : type === 'product'  ? 'prod_posting_group_code'
              : 'inv_posting_group_code'
    const tbl = type === 'inventory' ? setupTableInv : setupTableGeneral
    const used = await c.env.DB
      .prepare(`SELECT 1 FROM ${tbl} WHERE company_id = ? AND ${col} = ? AND is_active = 1 LIMIT 1`)
      .bind(company_id, code).first()
    if (used) return c.json({ success: false, error: `Cannot deactivate: code "${code}" is still used in active posting setup rows.` }, 409)
  }

  const sets: string[] = []
  const vals: unknown[] = []
  if (body.name !== undefined)        { sets.push('name = ?');        vals.push(body.name.trim()) }
  if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description?.trim() ?? null) }
  if (body.is_active !== undefined)   { sets.push('is_active = ?');   vals.push(body.is_active ? 1 : 0) }
  if (!sets.length) return c.json({ success: false, error: 'Nothing to update' }, 422)
  vals.push(company_id, code)

  await c.env.DB
    .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE company_id = ? AND code = ?`)
    .bind(...vals).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: table, new_value: { code, ...body } })
  return c.json({ success: true })
})

// =============================================================================
// GENERAL POSTING SETUP
// =============================================================================

// GET /api/gl/posting-setup/general
gl.get('/posting-setup/general', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT id, bus_posting_group_code, prod_posting_group_code,
               sales_account, purchases_account, cogs_account,
               sales_returns_account, purch_returns_account, expense_account, is_active
              FROM general_posting_setup WHERE company_id = ?
              ORDER BY bus_posting_group_code NULLS LAST, prod_posting_group_code NULLS LAST`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/gl/posting-setup/general
gl.post('/posting-setup/general', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    bus_posting_group_code?: string | null
    prod_posting_group_code?: string | null
    sales_account?: string | null
    purchases_account?: string | null
    cogs_account?: string | null
    sales_returns_account?: string | null
    purch_returns_account?: string | null
    expense_account?: string | null
  }>()

  const bpg = body.bus_posting_group_code?.toUpperCase() ?? null
  const ppg = body.prod_posting_group_code?.toUpperCase() ?? null

  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM general_posting_setup WHERE company_id = ?
              AND (bus_posting_group_code IS ? OR (bus_posting_group_code IS NULL AND ? IS NULL))
              AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL)) LIMIT 1`)
    .bind(company_id, bpg, bpg, ppg, ppg).first()
  if (exists) return c.json({ success: false, error: `A setup row for BPG="${bpg ?? 'DEFAULT'}" × PPG="${ppg ?? 'DEFAULT'}" already exists.` }, 409)

  const { meta } = await c.env.DB
    .prepare(`INSERT INTO general_posting_setup
              (company_id, bus_posting_group_code, prod_posting_group_code,
               sales_account, purchases_account, cogs_account,
               sales_returns_account, purch_returns_account, expense_account, is_active, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,1,datetime('now'))`)
    .bind(company_id, bpg, ppg,
          body.sales_account ?? null, body.purchases_account ?? null, body.cogs_account ?? null,
          body.sales_returns_account ?? null, body.purch_returns_account ?? null, body.expense_account ?? null)
    .run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'general_posting_setup', new_value: { bpg, ppg } })
  clearPostingEngineCaches()
  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
})

// PATCH /api/gl/posting-setup/general/:id
gl.patch('/posting-setup/general/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const rowId = Number(c.req.param('id'))
  if (!rowId) return c.json({ success: false, error: 'Invalid id' }, 400)

  const existing = await c.env.DB
    .prepare('SELECT id FROM general_posting_setup WHERE id = ? AND company_id = ?')
    .bind(rowId, company_id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  const body = await c.req.json<{
    sales_account?: string | null; purchases_account?: string | null; cogs_account?: string | null
    sales_returns_account?: string | null; purch_returns_account?: string | null
    expense_account?: string | null; is_active?: boolean
  }>()

  const sets: string[] = []
  const vals: unknown[] = []
  const fields = ['sales_account','purchases_account','cogs_account','sales_returns_account','purch_returns_account','expense_account'] as const
  for (const f of fields) {
    if (f in body) { sets.push(`${f} = ?`); vals.push(body[f] ?? null) }
  }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0) }
  if (!sets.length) return c.json({ success: false, error: 'Nothing to update' }, 422)
  vals.push(rowId, company_id)

  await c.env.DB
    .prepare(`UPDATE general_posting_setup SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`)
    .bind(...vals).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'general_posting_setup', new_value: { id: rowId, ...body } })
  clearPostingEngineCaches()
  return c.json({ success: true })
})

// =============================================================================
// INVENTORY POSTING SETUP
// =============================================================================

// GET /api/gl/posting-setup/inventory
gl.get('/posting-setup/inventory', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT id, inv_posting_group_code, prod_posting_group_code, inventory_account, is_active
              FROM inventory_posting_setup WHERE company_id = ?
              ORDER BY inv_posting_group_code NULLS LAST, prod_posting_group_code NULLS LAST`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/gl/posting-setup/inventory
gl.post('/posting-setup/inventory', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    inv_posting_group_code?: string | null
    prod_posting_group_code?: string | null
    inventory_account?: string | null
  }>()

  const ipg = body.inv_posting_group_code?.toUpperCase() ?? null
  const ppg = body.prod_posting_group_code?.toUpperCase() ?? null

  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM inventory_posting_setup WHERE company_id = ?
              AND (inv_posting_group_code IS ? OR (inv_posting_group_code IS NULL AND ? IS NULL))
              AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL)) LIMIT 1`)
    .bind(company_id, ipg, ipg, ppg, ppg).first()
  if (exists) return c.json({ success: false, error: `A setup row for IPG="${ipg ?? 'DEFAULT'}" × PPG="${ppg ?? 'DEFAULT'}" already exists.` }, 409)

  const { meta } = await c.env.DB
    .prepare(`INSERT INTO inventory_posting_setup
              (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, is_active, created_at)
              VALUES (?,?,?,?,1,datetime('now'))`)
    .bind(company_id, ipg, ppg, body.inventory_account ?? null)
    .run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'inventory_posting_setup', new_value: { ipg, ppg } })
  clearPostingEngineCaches()
  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
})

// PATCH /api/gl/posting-setup/inventory/:id
gl.patch('/posting-setup/inventory/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const rowId = Number(c.req.param('id'))
  if (!rowId) return c.json({ success: false, error: 'Invalid id' }, 400)

  const existing = await c.env.DB
    .prepare('SELECT id FROM inventory_posting_setup WHERE id = ? AND company_id = ?')
    .bind(rowId, company_id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  const body = await c.req.json<{ inventory_account?: string | null; is_active?: boolean }>()
  const sets: string[] = []
  const vals: unknown[] = []
  if ('inventory_account' in body) { sets.push('inventory_account = ?'); vals.push(body.inventory_account ?? null) }
  if (body.is_active !== undefined) { sets.push('is_active = ?');        vals.push(body.is_active ? 1 : 0) }
  if (!sets.length) return c.json({ success: false, error: 'Nothing to update' }, 422)
  vals.push(rowId, company_id)

  await c.env.DB
    .prepare(`UPDATE inventory_posting_setup SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`)
    .bind(...vals).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'inventory_posting_setup', new_value: { id: rowId, ...body } })
  clearPostingEngineCaches()
  return c.json({ success: true })
})

// =============================================================================
// POSTING SETUP HEALTH
// =============================================================================

// GET /api/gl/posting-setup/health
gl.get('/posting-setup/health', async (c) => {
  const { company_id } = getUser(c)

  const [bpgRow, ppgRow, ipgRow, gpsRow, ipsRow,
         gpsNullRow, ipsNullRow,
         suppliersNoGroup, itemsNoGroup, warehousesNoGroup,
         gpsIncomplete, ipsIncomplete] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM business_posting_groups  WHERE company_id = ? AND is_active = 1').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM product_posting_groups   WHERE company_id = ? AND is_active = 1').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM inventory_posting_groups WHERE company_id = ? AND is_active = 1').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM general_posting_setup    WHERE company_id = ? AND is_active = 1').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM inventory_posting_setup  WHERE company_id = ? AND is_active = 1').bind(company_id).first<{n:number}>(),
    // Does catch-all (NULL/NULL) row exist?
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM general_posting_setup   WHERE company_id = ? AND bus_posting_group_code IS NULL AND prod_posting_group_code IS NULL AND is_active = 1').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM inventory_posting_setup WHERE company_id = ? AND inv_posting_group_code  IS NULL AND prod_posting_group_code IS NULL AND is_active = 1').bind(company_id).first<{n:number}>(),
    // Entities missing posting groups
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM suppliers  WHERE company_id = ? AND bus_posting_group_code IS NULL').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM items      WHERE company_id = ? AND prod_posting_group_code IS NULL').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM warehouses WHERE company_id = ? AND inv_posting_group_code  IS NULL').bind(company_id).first<{n:number}>(),
    // Setup rows missing critical accounts
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM general_posting_setup WHERE company_id = ? AND is_active = 1
      AND (sales_account IS NULL OR purchases_account IS NULL OR cogs_account IS NULL)`).bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM inventory_posting_setup WHERE company_id = ? AND is_active = 1 AND inventory_account IS NULL').bind(company_id).first<{n:number}>(),
  ])

  const hasCatchAllGeneral   = (gpsNullRow?.n  ?? 0) > 0
  const hasCatchAllInventory = (ipsNullRow?.n  ?? 0) > 0

  const issues: string[] = []
  if (!hasCatchAllGeneral)   issues.push('No catch-all General Posting Setup row (NULL/NULL). Unassigned entities will be blocked.')
  if (!hasCatchAllInventory) issues.push('No catch-all Inventory Posting Setup row (NULL/NULL). Unassigned warehouses/items will be blocked.')
  if ((gpsIncomplete?.n ?? 0) > 0) issues.push(`${gpsIncomplete!.n} General Posting Setup row(s) have missing accounts (sales/purchases/COGS).`)
  if ((ipsIncomplete?.n ?? 0) > 0) issues.push(`${ipsIncomplete!.n} Inventory Posting Setup row(s) have NULL inventory_account.`)

  const warnings: string[] = []
  if ((suppliersNoGroup?.n ?? 0) > 0)  warnings.push(`${suppliersNoGroup!.n} supplier(s) have no Business Posting Group.`)
  if ((itemsNoGroup?.n     ?? 0) > 0)  warnings.push(`${itemsNoGroup!.n} item(s) have no Product Posting Group.`)
  if ((warehousesNoGroup?.n ?? 0) > 0) warnings.push(`${warehousesNoGroup!.n} warehouse(s) have no Inventory Posting Group.`)

  return c.json({
    success: true,
    data: {
      groups: {
        business_posting_groups:  bpgRow?.n  ?? 0,
        product_posting_groups:   ppgRow?.n  ?? 0,
        inventory_posting_groups: ipgRow?.n  ?? 0,
      },
      setup: {
        general_rows:             gpsRow?.n  ?? 0,
        inventory_rows:           ipsRow?.n  ?? 0,
        has_catch_all_general:    hasCatchAllGeneral,
        has_catch_all_inventory:  hasCatchAllInventory,
      },
      entities: {
        suppliers_missing_group:  suppliersNoGroup?.n  ?? 0,
        items_missing_group:      itemsNoGroup?.n      ?? 0,
        warehouses_missing_group: warehousesNoGroup?.n ?? 0,
      },
      issues,
      warnings,
      is_ready: issues.length === 0,
    },
  })
})

// =============================================================================
// VALIDATE POSTING (dry-run resolve)
// =============================================================================

// POST /api/gl/posting-setup/validate
gl.post('/posting-setup/validate', async (c) => {
  const { company_id } = getUser(c)
  const body = await c.req.json<{
    type: 'inventory_in' | 'inventory_out' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
    bpg_code?: string | null
    ppg_code?: string | null
    ipg_code?: string | null
    ap_code?: string
    cash_code?: string
    receivable_code?: string
    amount?: number
  }>()

  const amt = body.amount ?? 1000  // dummy amount for validation

  let blueprint
  switch (body.type) {
    case 'inventory_in':
    case 'inventory_out':
      blueprint = await peResolveInventory(c.env.DB, company_id, body.ipg_code ?? null, body.ppg_code ?? null, amt, body.type === 'inventory_in')
      break
    case 'supplier_invoice':
      if (!body.ap_code) return c.json({ success: false, error: 'ap_code required for supplier_invoice' }, 422)
      blueprint = await peResolveSupplierInvoice(c.env.DB, company_id, body.bpg_code ?? null, body.ppg_code ?? null, body.ap_code, amt)
      break
    case 'supplier_payment':
      if (!body.ap_code || !body.cash_code) return c.json({ success: false, error: 'ap_code and cash_code required' }, 422)
      blueprint = await peResolveSupplierPayment(c.env.DB, company_id, body.ap_code, body.cash_code, amt)
      break
    case 'expense':
      if (!body.cash_code) return c.json({ success: false, error: 'cash_code required for expense' }, 422)
      blueprint = await peResolveExpense(c.env.DB, company_id, body.bpg_code ?? null, body.ppg_code ?? null, body.cash_code, amt)
      break
    case 'revenue':
      if (!body.receivable_code) return c.json({ success: false, error: 'receivable_code required for revenue' }, 422)
      blueprint = await peResolveSalesRevenue(c.env.DB, company_id, body.bpg_code ?? null, body.ppg_code ?? null, body.receivable_code, amt)
      break
    default:
      return c.json({ success: false, error: 'Invalid type. Use: inventory_in | inventory_out | supplier_invoice | supplier_payment | expense | revenue' }, 422)
  }

  return c.json({ success: true, data: blueprint })
})

export default gl
