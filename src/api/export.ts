import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { resolveMovementDirection } from '../lib/posting_engine'

const exportApi = new Hono<{ Bindings: Env }>()
exportApi.use('*', authMiddleware)

function csvRow(cols: unknown[]): string {
  return cols.map(v => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}

function csv(headers: string[], rows: unknown[][]): string {
  return [headers.join(','), ...rows.map(csvRow)].join('\r\n')
}

function csvResponse(filename: string, content: string) {
  return new Response(content, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.csv"`,
    },
  })
}

// GET /api/export/suppliers — all supplier balances
exportApi.get('/suppliers', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(`
    SELECT s.code, s.name, s.activity,
           COALESCE(SUM(t.credit),0) AS total_credit,
           COALESCE(SUM(t.debit),0)  AS total_debit,
           COALESCE(SUM(t.credit),0) - COALESCE(SUM(t.debit),0) AS balance
    FROM suppliers s
    LEFT JOIN supplier_transactions t ON t.supplier_code = s.code AND t.company_id = s.company_id
    WHERE s.company_id = ?
    GROUP BY s.code, s.name, s.activity
    ORDER BY s.code
  `).bind(company_id).all()

  const headers = ['الكود','المورد','النشاط','إجمالي الدائن','إجمالي المدين','الرصيد']
  const rows    = results.map((r: Record<string,unknown>) => [r.code, r.name, r.activity, r.total_credit, r.total_debit, r.balance])
  return csvResponse('الموردين', csv(headers, rows as unknown[][]))
})

// GET /api/export/supplier/:code/statement — full statement
exportApi.get('/supplier/:code/statement', async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))
  const { results } = await c.env.DB.prepare(`
    SELECT transaction_date, entry_type, document_type, document_number,
           expense_category, unit, quantity, unit_price, amount, credit, debit,
           balance_with_checks, notes
    FROM supplier_transactions
    WHERE company_id = ? AND supplier_code = ?
    ORDER BY transaction_date, id
  `).bind(company_id, code).all()

  const supplier = await c.env.DB
    .prepare('SELECT name FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id).first<{name:string}>()

  const headers = ['التاريخ','النوع','المستند','رقم المستند','الخدمة','الوحدة','الكمية','سعر الوحدة','القيمة','دائن','مدين','الرصيد','ملاحظات']
  const rows    = results.map((r: Record<string,unknown>) => [
    r.transaction_date, r.entry_type, r.document_type, r.document_number,
    r.expense_category, r.unit, r.quantity, r.unit_price, r.amount,
    r.credit, r.debit, r.balance_with_checks, r.notes
  ])
  return csvResponse(`كشف_حساب_${supplier?.name ?? code}`, csv(headers, rows as unknown[][]))
})

// GET /api/export/treasury — cash journal
exportApi.get('/treasury', async (c) => {
  const { company_id } = getUser(c)
  const year  = c.req.query('year')
  const month = c.req.query('month')

  let sql = `SELECT transaction_date, direction, document_number, recipient_name,
             narration, amount, debit, credit, running_balance, notes
             FROM cash_transactions WHERE company_id = ?`
  const params: unknown[] = [company_id]
  if (year)  { sql += ' AND year = ?';  params.push(Number(year)) }
  if (month) { sql += ' AND month = ?'; params.push(Number(month)) }
  sql += ' ORDER BY transaction_date, id'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const headers = ['التاريخ','الاتجاه','رقم المستند','المستلم','البيان','المبلغ','مدين','دائن','الرصيد','ملاحظات']
  const rows    = results.map((r: Record<string,unknown>) => [
    r.transaction_date, r.direction === 'د' ? 'وارد' : 'منصرف', r.document_number,
    r.recipient_name, r.narration, r.amount, r.debit, r.credit, r.running_balance, r.notes
  ])
  return csvResponse('دفتر_اليومية', csv(headers, rows as unknown[][]))
})

// GET /api/export/inventory — warehouse balances
exportApi.get('/inventory', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(`
    SELECT im.warehouse, i.name AS item_name, i.unit,
           SUM(im.qty_in) AS total_in, SUM(im.qty_out) AS total_out,
           SUM(im.qty_in) - SUM(im.qty_out) AS balance_qty,
           SUM(im.value_in) - SUM(im.value_out) AS balance_value
    FROM inventory_movements im
    LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
    WHERE im.company_id = ?
    GROUP BY im.warehouse, im.item_code
    ORDER BY im.warehouse, i.name
  `).bind(company_id).all()

  const headers = ['المخزن','الصنف','الوحدة','إجمالي الوارد','إجمالي المنصرف','الرصيد','قيمة الرصيد']
  const rows    = results.map((r: Record<string,unknown>) => [
    r.warehouse, r.item_name, r.unit, r.total_in, r.total_out, r.balance_qty, r.balance_value
  ])
  return csvResponse('أرصدة_المخازن', csv(headers, rows as unknown[][]))
})

// GET /api/export/inventory/movements — movements log
exportApi.get('/inventory/movements', async (c) => {
  const { company_id } = getUser(c)
  const type = c.req.query('type')
  const warehouse = c.req.query('warehouse')
  const seasonId = c.req.query('season_id')
  const start = c.req.query('start')
  const end = c.req.query('end')

  const where: string[] = ['im.company_id = ?']
  const binds: unknown[] = [company_id]

  if (type) {
    where.push('im.movement_type = ?')
    binds.push(type)
  }
  if (warehouse) {
    where.push('im.warehouse = ?')
    binds.push(warehouse)
  }
  if (seasonId) {
    where.push('im.season_id = ?')
    binds.push(Number(seasonId))
  }
  if (start) {
    where.push('im.movement_date >= ?')
    binds.push(start)
  }
  if (end) {
    where.push('im.movement_date <= ?')
    binds.push(end)
  }

  const { results } = await c.env.DB.prepare(`
    SELECT im.movement_date, im.warehouse, im.movement_type, i.name AS item_name,
           i.unit, im.quantity, im.unit_price, im.qty_in, im.qty_out,
           im.balance_qty, im.balance_value, im.document_number, im.notes
    FROM inventory_movements im
    LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY im.movement_date, im.id
  `).bind(...binds).all()

  const headers = ['التاريخ','المخزن','النوع','الصنف','الوحدة','الكمية','سعر الوحدة','وارد','منصرف','رصيد كمية','رصيد قيمة','المستند','ملاحظات']
  const rows    = results.map((r: Record<string,unknown>) => [
    r.movement_date, r.warehouse, resolveMovementDirection(String(r.movement_type ?? '')) === 'IN' ? 'وارد' : 'منصرف',
    r.item_name, r.unit, r.quantity, r.unit_price, r.qty_in, r.qty_out,
    r.balance_qty, r.balance_value, r.document_number, r.notes
  ])
  return csvResponse('حركات_المخزون', csv(headers, rows as unknown[][]))
})

// GET /api/export/gl/trial-balance?start=&end=
exportApi.get('/gl/trial-balance', async (c) => {
  const { company_id } = getUser(c)
  const start = c.req.query('start')
  const end   = c.req.query('end')

  let entryWhere = 'e.is_posted = 1 AND e.company_id = ?'
  const p: unknown[] = [company_id, company_id]
  if (start) { entryWhere += ' AND e.entry_date >= ?'; p.push(start) }
  if (end)   { entryWhere += ' AND e.entry_date <= ?'; p.push(end) }

  const { results } = await c.env.DB.prepare(
    `SELECT a.code, a.name, a.account_type,
            COALESCE(SUM(l.debit),  0) AS total_debit,
            COALESCE(SUM(l.credit), 0) AS total_credit,
            CASE WHEN a.normal_balance = 'debit'
                 THEN COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)
                 ELSE COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0) END AS balance
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND ${entryWhere}
     WHERE a.company_id = ? AND a.is_active = 1
     GROUP BY a.code ORDER BY a.code`
  ).bind(...p).all()

  const TYPE_AR: Record<string,string> = { asset:'أصول', liability:'خصوم', equity:'حقوق ملكية', revenue:'إيرادات', expense:'مصروفات' }
  const headers = ['كود الحساب','اسم الحساب','النوع','مجموع المدين','مجموع الدائن','الرصيد']
  const rows    = (results as Record<string,unknown>[]).map(r => [
    r.code, r.name, TYPE_AR[r.account_type as string] ?? r.account_type,
    r.total_debit, r.total_credit, r.balance
  ])

  const bom     = '\uFEFF'
  const content = bom + csv(headers, rows as unknown[][])
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent('ميزان_المراجعة')}.csv"`,
    },
  })
})

// GET /api/export/gl/income-statement?start=&end=
exportApi.get('/gl/income-statement', async (c) => {
  const { company_id } = getUser(c)
  const start = c.req.query('start')
  const end   = c.req.query('end')

  let entryWhere = 'e.is_posted = 1 AND e.company_id = ?'
  const p: unknown[] = [company_id, company_id]
  if (start) { entryWhere += ' AND e.entry_date >= ?'; p.push(start) }
  if (end)   { entryWhere += ' AND e.entry_date <= ?'; p.push(end) }

  const { results } = await c.env.DB.prepare(
    `SELECT a.code, a.name, a.account_type,
            CASE WHEN a.account_type = 'revenue'
                 THEN COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0)
                 ELSE COALESCE(SUM(l.debit),0)  - COALESCE(SUM(l.credit),0) END AS amount
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND ${entryWhere}
     WHERE a.company_id = ? AND a.account_type IN ('revenue','expense') AND a.is_active = 1 AND a.is_header = 0
     GROUP BY a.code ORDER BY a.account_type DESC, a.code`
  ).bind(...p).all()

  const headers = ['كود الحساب','اسم الحساب','النوع','القيمة']
  const rows    = (results as Record<string,unknown>[]).map(r => [
    r.code, r.name, r.account_type === 'revenue' ? 'إيراد' : 'مصروف', r.amount
  ])

  const bom     = '\uFEFF'
  const content = bom + csv(headers, rows as unknown[][])
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent('قائمة_الدخل')}.csv"`,
    },
  })
})

// GET /api/export/gl/ledger/:code?start=&end=
exportApi.get('/gl/ledger/:code', async (c) => {
  const { company_id } = getUser(c)
  const code  = c.req.param('code')
  const start = c.req.query('start')
  const end   = c.req.query('end')

  let where = 'WHERE l.account_code = ? AND l.company_id = ?'
  const p: unknown[] = [code, company_id]
  if (start) { where += ' AND e.entry_date >= ?'; p.push(start) }
  if (end)   { where += ' AND e.entry_date <= ?'; p.push(end) }

  const { results } = await c.env.DB.prepare(
    `SELECT e.entry_date, l.narration, e.description AS entry_desc, e.ref_type,
            l.debit, l.credit
     FROM journal_entry_lines l
     JOIN journal_entries e ON e.id = l.entry_id AND e.is_posted = 1
     ${where}
     ORDER BY e.entry_date, e.id, l.id`
  ).bind(...p).all()

  const REF: Record<string,string> = {
    cash_transaction:'خزينة', supplier_transaction:'مورد',
    inventory_movement:'مخزون', manual:'يدوي',
  }
  let running = 0
  const headers = ['التاريخ','البيان','المصدر','مدين','دائن','الرصيد']
  const rows    = (results as Record<string,unknown>[]).map(r => {
    running += (r.debit as number) - (r.credit as number)
    return [r.entry_date, r.narration || r.entry_desc, REF[r.ref_type as string] ?? '—', r.debit, r.credit, running]
  })

  const bom     = '\uFEFF'
  const content = bom + csv(headers, rows as unknown[][])
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`دفتر_أستاذ_${code}`)}.csv"`,
    },
  })
})

// GET /api/export/audit?start=&end=&table=&action=
exportApi.get('/audit', async (c) => {
  const { company_id, role } = getUser(c)
  if (!['super_admin', 'company_admin', 'accountant'].includes(role)) {
    return new Response('Forbidden', { status: 403 })
  }

  const start  = c.req.query('start')
  const end    = c.req.query('end')
  const table  = c.req.query('table')
  const action = c.req.query('action')

  let where = 'WHERE al.company_id = ?'
  const p: unknown[] = [company_id]
  if (table)  { where += ' AND al.table_name = ?'; p.push(table) }
  if (action) { where += ' AND al.action = ?';     p.push(action) }
  if (start)  { where += ' AND al.created_at >= ?'; p.push(start) }
  if (end)    { where += ' AND al.created_at <= ?'; p.push(end + ' 23:59:59') }

  const { results } = await c.env.DB.prepare(
    `SELECT al.created_at, u.full_name AS user_name, u.email AS user_email,
            al.action, al.table_name, al.record_id, al.new_value, al.source
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.created_at DESC LIMIT 5000`,
  ).bind(...p).all()

  const ACTION_AR: Record<string, string> = {
    CREATE: 'إنشاء', UPDATE: 'تعديل', DELETE: 'حذف',
    CLOSE: 'إغلاق', REOPEN: 'فتح', LOGIN: 'دخول', SWITCH: 'تبديل',
  }
  const TABLE_AR: Record<string, string> = {
    cash_transactions: 'الخزينة', journal_entries: 'القيود',
    financial_periods: 'الفترات', partners: 'الشركاء',
  }

  const headers = ['التاريخ والوقت', 'المستخدم', 'البريد الإلكتروني', 'الإجراء', 'الجدول', 'رقم السجل', 'التفاصيل', 'المصدر']
  const rows    = (results as Record<string, unknown>[]).map(r => [
    r.created_at,
    r.user_name,
    r.user_email,
    ACTION_AR[r.action as string] ?? r.action,
    TABLE_AR[r.table_name as string] ?? r.table_name,
    r.record_id,
    r.new_value,
    r.source,
  ])

  const bom     = '\uFEFF'
  const content = bom + csv(headers, rows as unknown[][])
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent('سجل_المراجعة')}.csv"`,
    },
  })
})

// GET /api/export/gl/balance-sheet?as_of=
exportApi.get('/gl/balance-sheet', async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? new Date().toISOString().slice(0, 10)

  const { results } = await c.env.DB.prepare(
    `SELECT a.code, a.name, a.account_type, a.is_header,
            CASE WHEN a.normal_balance = 'debit'
                 THEN COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)
                 ELSE COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0) END AS balance
     FROM chart_of_accounts a
     LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.is_posted = 1 AND e.entry_date <= ?
     WHERE a.company_id = ? AND a.account_type IN ('asset','liability','equity') AND a.is_active = 1
     GROUP BY a.code, a.name, a.account_type, a.normal_balance, a.is_header
     ORDER BY a.code`
  ).bind(asOf, company_id).all()

  const TYPE_AR: Record<string, string> = {
    asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية',
  }
  const headers = ['كود الحساب', 'اسم الحساب', 'التصنيف', 'نوع السطر', 'الرصيد']
  const rows    = (results as Record<string, unknown>[]).map(r => [
    r.code, r.name,
    TYPE_AR[r.account_type as string] ?? r.account_type,
    r.is_header ? 'رأس قسم' : 'حساب',
    r.is_header ? '' : r.balance,
  ])

  const bom     = '\uFEFF'
  const content = bom + csv(headers, rows as unknown[][])
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent('الميزانية_العمومية')}.csv"`,
    },
  })
})

export default exportApi
