import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'

const accounts = new Hono<{ Bindings: Env }>()
accounts.use('*', authMiddleware)
accounts.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

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
    'SELECT code, is_header, is_active FROM chart_of_accounts WHERE company_id = ? AND code = ?'
  ).bind(company_id, parent_code).first<{ code: string; is_header: number; is_active: number }>()
  if (!parent) return `الحساب الأب (${parent_code}) غير موجود`
  if (parent.is_active !== 1) return `الحساب الأب (${parent_code}) غير نشط`
  if (parent.is_header !== 1) return `الحساب الأب (${parent_code}) يجب أن يكون حساباً رئيسياً (header)`

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

async function syncCoaClosure(db: Env['DB'], company_id: number): Promise<void> {
  try {
    await db.prepare('DELETE FROM coa_closure WHERE company_id = ?').bind(company_id).run()
    await db.prepare(
      `INSERT INTO coa_closure (company_id, ancestor_code, descendant_code, depth)
       WITH RECURSIVE closure(ancestor_code, descendant_code, depth) AS (
         SELECT code, code, 0
         FROM chart_of_accounts
         WHERE company_id = ?
         UNION ALL
         SELECT c.ancestor_code, child.code, c.depth + 1
         FROM closure c
         JOIN chart_of_accounts child
           ON child.company_id = ? AND child.parent_code = c.descendant_code
       )
       SELECT ?, ancestor_code, descendant_code, depth
       FROM closure`
    ).bind(company_id, company_id, company_id).run()
  } catch {
    // Closure table may not exist yet in some environments; keep API backward-compatible.
  }
}

// GET /api/gl/accounts
accounts.get('/', async (c) => {
  const { company_id } = getUser(c)
  const type       = c.req.query('type')
  const leafOnly   = c.req.query('leaf') === '1'
  let sql = 'SELECT * FROM chart_of_accounts WHERE company_id = ? AND is_active = 1'
  const p: unknown[] = [company_id]
  if (type)     { sql += ' AND account_type = ?'; p.push(type) }
  if (leafOnly) { sql += ' AND is_header = 0' }
  sql += ' ORDER BY code'
  const { results } = await c.env.DB.prepare(sql).bind(...p).all()
  return c.json({ success: true, data: results })
})

// GET /api/gl/accounts/usage-metadata
accounts.get('/usage-metadata', async (c) => {
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

// POST /api/gl/accounts
accounts.post('/', async (c) => {
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
    await syncCoaClosure(c.env.DB, company_id)
    return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
  } catch {
    return c.json({ success: false, error: 'الكود موجود مسبقاً' }, 409)
  }
})

// PATCH /api/gl/accounts/:code
accounts.patch('/:code', async (c) => {
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

  if (Object.prototype.hasOwnProperty.call(b, 'is_active') && Number(b.is_active) === 0) {
    const self = await c.env.DB.prepare(
      'SELECT is_header FROM chart_of_accounts WHERE company_id = ? AND code = ?'
    ).bind(company_id, code).first<{ is_header: number }>()
    if (self?.is_header === 1) {
      const activeChildren = await c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM chart_of_accounts WHERE company_id = ? AND parent_code = ? AND is_active = 1'
      ).bind(company_id, code).first<{ n: number }>()
      if ((activeChildren?.n ?? 0) > 0) {
        return c.json({
          success: false,
          error: `لا يمكن تعطيل الحساب الرئيسي ${code} لوجود ${activeChildren!.n} حسابات فرعية نشطة`,
        }, 409)
      }
    }
  }

  await c.env.DB.prepare(
    `UPDATE chart_of_accounts SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE code = ? AND company_id = ?`
  ).bind(...cols.map(f => b[f]), code, company_id).run()
  await syncCoaClosure(c.env.DB, company_id)
  return c.json({ success: true, data: null })
})

export default accounts
