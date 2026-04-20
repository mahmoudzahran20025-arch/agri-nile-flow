import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

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

function csvResponse(c: { body: (b: string, init: ResponseInit) => Response }, filename: string, content: string) {
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
  return csvResponse(c as never, 'الموردين', csv(headers, rows as unknown[][]))
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
  return csvResponse(c as never, `كشف_حساب_${supplier?.name ?? code}`, csv(headers, rows as unknown[][]))
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
  return csvResponse(c as never, 'دفتر_اليومية', csv(headers, rows as unknown[][]))
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
  return csvResponse(c as never, 'أرصدة_المخازن', csv(headers, rows as unknown[][]))
})

// GET /api/export/inventory/movements — movements log
exportApi.get('/inventory/movements', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(`
    SELECT im.movement_date, im.warehouse, im.movement_type, i.name AS item_name,
           i.unit, im.quantity, im.unit_price, im.qty_in, im.qty_out,
           im.balance_qty, im.balance_value, im.document_number, im.notes
    FROM inventory_movements im
    LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
    WHERE im.company_id = ?
    ORDER BY im.movement_date, im.id
  `).bind(company_id).all()

  const headers = ['التاريخ','المخزن','النوع','الصنف','الوحدة','الكمية','سعر الوحدة','وارد','منصرف','رصيد كمية','رصيد قيمة','المستند','ملاحظات']
  const rows    = results.map((r: Record<string,unknown>) => [
    r.movement_date, r.warehouse, r.movement_type === 'اضافة' ? 'وارد' : 'منصرف',
    r.item_name, r.unit, r.quantity, r.unit_price, r.qty_in, r.qty_out,
    r.balance_qty, r.balance_value, r.document_number, r.notes
  ])
  return csvResponse(c as never, 'حركات_المخزون', csv(headers, rows as unknown[][]))
})

export default exportApi
