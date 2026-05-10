import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard, permissionGuard } from '../middleware/auth'
import { getOpenPeriod } from '../lib/gl'
import { logAudit } from '../lib/audit'
import { logFinancialWorkflowFailure } from '../lib/finance/workflow_policy'
import { FinanceCore } from '../lib/finance_core'
import { enforceDataQualityPolicy } from '../lib/data_quality'
import { resolveControlAccount } from '../lib/posting_engine'

const suppliers = new Hono<{ Bindings: Env }>()
suppliers.use('*', authMiddleware)

// Write operations (POST/PATCH) are finance-role-only.
// Read operations use DB-driven permissionGuard so any role with suppliers.read can view.
const financeOnly = roleGuard(['super_admin', 'company_admin', 'accountant'])

/**
 * Updates the running balance for a newly inserted supplier transaction and
 * propagates the delta forward to all rows with a later date/id.
 *
 * O(1) reads + O(K) updates where K = rows after the insertion point.
 * For backdated inserts (date < latest), falls back to full rebalance because
 * the cumulative balances of every subsequent row must shift.
 *
 * Call this AFTER the new row is already inserted with balance_no_checks = 0.
 */
async function updateSupplierRunningBalance(
  db: Env['DB'],
  companyId: number,
  supplierCode: number,
  newTxnId: number,
  newTxnDate: string,
) {
  // Only posted rows contribute to the running balance visible to users.
  // Draft rows have balance_no_checks = balance_with_checks = 0 until posted.
  const latestRow = await db.prepare(
    `SELECT transaction_date FROM supplier_transactions
     WHERE company_id = ? AND supplier_code = ? AND id != ? AND status = 'posted'
     ORDER BY transaction_date DESC, id DESC LIMIT 1`
  ).bind(companyId, supplierCode, newTxnId).first<{ transaction_date: string }>()

  const isBackdated = latestRow && latestRow.transaction_date > newTxnDate

  if (isBackdated) {
    return _fullRebalanceSupplierBalances(db, companyId, supplierCode)
  }

  const prevRow = await db.prepare(
    `SELECT balance_no_checks, balance_with_checks FROM supplier_transactions
     WHERE company_id = ? AND supplier_code = ? AND id < ? AND status = 'posted'
     ORDER BY transaction_date DESC, id DESC LIMIT 1`
  ).bind(companyId, supplierCode, newTxnId).first<{
    balance_no_checks: number
    balance_with_checks: number
  }>()

  const newRow = await db.prepare(
    `SELECT credit, debit, check_amount FROM supplier_transactions WHERE id = ? AND company_id = ?`
  ).bind(newTxnId, companyId).first<{ credit: number; debit: number; check_amount: number | null }>()

  if (!newRow) return

  const prevNoChecks   = prevRow?.balance_no_checks   ?? 0
  const prevWithChecks = prevRow?.balance_with_checks ?? 0
  const delta          = (newRow.credit ?? 0) - (newRow.debit ?? 0)
  const deltaCheck     = delta + (newRow.check_amount ?? 0)

  const newNoChecks   = prevNoChecks   + delta
  const newWithChecks = prevWithChecks + deltaCheck

  await db.prepare(
    `UPDATE supplier_transactions SET balance_no_checks = ?, balance_with_checks = ? WHERE id = ? AND company_id = ?`
  ).bind(newNoChecks, newWithChecks, newTxnId, companyId).run()

  if (Math.abs(delta) > 0 || Math.abs(deltaCheck) > 0) {
    await db.prepare(
      `UPDATE supplier_transactions
       SET balance_no_checks   = balance_no_checks   + ?,
           balance_with_checks = balance_with_checks + ?
       WHERE company_id = ? AND supplier_code = ? AND id > ? AND status = 'posted'`
    ).bind(delta, deltaCheck, companyId, supplierCode, newTxnId).run()
  }
}

/** Full rebalance — only posted rows, used for backdated inserts or delete operations. */
async function _fullRebalanceSupplierBalances(db: Env['DB'], companyId: number, supplierCode: number) {
  const { results: rows } = await db.prepare(
    `SELECT id, credit, debit, check_amount
     FROM supplier_transactions
     WHERE company_id = ? AND supplier_code = ? AND status = 'posted'
     ORDER BY transaction_date ASC, id ASC`
  ).bind(companyId, supplierCode).all<{
    id: number; credit: number | null; debit: number | null; check_amount: number | null
  }>()

  let runningNoChecks = 0
  let runningWithChecks = 0

  const updates = (rows ?? []).map((row) => {
    const credit   = row.credit    ?? 0
    const debit    = row.debit     ?? 0
    const checkAmt = row.check_amount ?? 0
    runningNoChecks   += credit - debit
    runningWithChecks += credit - debit + checkAmt
    return db.prepare(
      `UPDATE supplier_transactions SET balance_no_checks = ?, balance_with_checks = ? WHERE id = ? AND company_id = ?`
    ).bind(runningNoChecks, runningWithChecks, row.id, companyId)
  })

  if (updates.length) await db.batch(updates)
}

async function createOwnedCapitalAsset(
  db: Env['DB'],
  opts: {
    companyId: number
    txnId: number
    supplierCode: number
    equipmentType: { id: number; name: string; asset_nature: string; default_life_months: number } | null
    transactionDate: string
    amount: number
    centerCode: number | null
    userId: number
  },
) {
  if (!opts.equipmentType || opts.equipmentType.asset_nature !== 'capital') return null

  const assetCode = `${opts.supplierCode}-${opts.txnId}-${Date.now()}`
  const lifeMonths = opts.equipmentType.default_life_months || 60

  const assetResult = await db.prepare(`
    INSERT INTO fixed_assets
    (company_id, asset_code, name, category, acquisition_date, cost, useful_life_months,
      depreciation_method, supplier_transaction_id, equipment_type_id, center_code, field_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    opts.companyId,
    assetCode,
    opts.equipmentType.name,
    'equipment',
    opts.transactionDate,
    opts.amount,
    lifeMonths,
    'straight_line',
    opts.txnId,
    opts.equipmentType.id,
    opts.centerCode,
    null,
    opts.userId,
  ).run()

  const assetId = assetResult.meta.last_row_id as number
  const acqDate = new Date(opts.transactionDate)
  const now = new Date()
  const monthlyDep = lifeMonths > 0 ? Math.round((opts.amount / lifeMonths) * 100) / 100 : 0

  const scheduleInserts: Array<ReturnType<typeof db.prepare>> = []
  for (let y = acqDate.getFullYear(); y <= now.getFullYear(); y++) {
    const startMonth = y === acqDate.getFullYear() ? acqDate.getMonth() + 1 : 1
    const endMonth = y === now.getFullYear() ? now.getMonth() + 1 : 12

    for (let m = startMonth; m <= endMonth; m++) {
      scheduleInserts.push(db.prepare(`
        INSERT INTO depreciation_schedules
        (company_id, asset_id, period_year, period_month, amount, status)
        VALUES (?,?,?,?,?,?)
      `).bind(opts.companyId, assetId, y, m, monthlyDep, 'pending'))
    }
  }
  if (scheduleInserts.length) {
    await db.batch(scheduleInserts)
  }

  return assetId
}

// GET /api/suppliers?page=1&size=50&q=search
suppliers.get('/', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const page   = Math.max(1, Number(c.req.query('page') ?? 1))
  const size   = Math.min(100, Number(c.req.query('size') ?? 50))
  const q      = c.req.query('q') ?? ''
  const offset = (page - 1) * size

  const where  = q ? 'AND (s.name LIKE ? OR CAST(s.code AS TEXT) LIKE ?)' : ''
  const params = q ? [company_id, `%${q}%`, `%${q}%`] : [company_id]

  const [rowsResult, countResult, draftMeta] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.code, s.name, s.activity, s.is_active,
              COALESCE(tx_agg.total_credit, 0) AS total_credit,
              COALESCE(tx_agg.total_debit, 0)  AS total_debit,
              COALESCE(last_tx.balance_no_checks, COALESCE(tx_agg.total_credit, 0) - COALESCE(tx_agg.total_debit, 0), 0)   AS current_balance,
              COALESCE(last_tx.balance_with_checks, COALESCE(tx_agg.total_credit, 0) - COALESCE(tx_agg.total_debit, 0), 0) AS current_balance_with_checks
       FROM suppliers s
       LEFT JOIN (
         SELECT supplier_code,
                COALESCE(SUM(CASE WHEN status = 'posted' THEN credit ELSE 0 END), 0) AS total_credit,
                COALESCE(SUM(CASE WHEN status = 'posted' THEN debit  ELSE 0 END), 0) AS total_debit
         FROM supplier_transactions
         WHERE company_id = ?
         GROUP BY supplier_code
       ) tx_agg ON tx_agg.supplier_code = s.code
       LEFT JOIN (
         SELECT supplier_code,
                balance_no_checks,
                balance_with_checks
         FROM supplier_transactions
         WHERE company_id = ?
           AND id = (
             SELECT MAX(id) FROM supplier_transactions st2
             WHERE st2.supplier_code = supplier_transactions.supplier_code
               AND st2.company_id = supplier_transactions.company_id
           )
       ) last_tx ON last_tx.supplier_code = s.code
       WHERE s.company_id = ? ${where}
       ORDER BY ABS(COALESCE(last_tx.balance_no_checks, 0)) DESC
       LIMIT ? OFFSET ?`
     ).bind(company_id, company_id, ...params, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM suppliers s WHERE s.company_id = ? ${where}`
    ).bind(...params).first<{ total: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS draft_count,
              COUNT(DISTINCT supplier_code) AS suppliers_with_drafts
       FROM supplier_transactions
       WHERE company_id = ? AND status = 'draft'`
    ).bind(company_id).first<{ draft_count: number; suppliers_with_drafts: number }>(),
  ])

  return c.json({
    success: true,
    data:     rowsResult.results,
    total:    countResult?.total ?? 0,
    page,
    page_size: size,
    has_more: offset + size < (countResult?.total ?? 0),
    meta: {
      draft_count:          draftMeta?.draft_count          ?? 0,
      suppliers_with_drafts: draftMeta?.suppliers_with_drafts ?? 0,
    },
  })
})

// GET /api/suppliers/aging — 30/60/90+ day overdue analysis  (must be before /:code)
suppliers.get('/aging', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? new Date().toISOString().slice(0, 10)

  const { results } = await c.env.DB.prepare(
    `SELECT s.code, s.name, s.activity,
            COALESCE(last_tx.balance_no_checks, 0) AS total_balance,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-30 days') AND t.transaction_date <= ? THEN t.credit - t.debit ELSE 0 END), 0) AS current_0_30,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-60 days') AND t.transaction_date < date(?, '-30 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_31_60,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-90 days') AND t.transaction_date < date(?, '-60 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_61_90,
            COALESCE(SUM(CASE WHEN t.transaction_date < date(?, '-90 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_90_plus
     FROM suppliers s
     LEFT JOIN supplier_transactions t ON t.supplier_code = s.code AND t.company_id = s.company_id
                                          AND t.status = 'posted' AND t.transaction_date <= ?
     LEFT JOIN (
       SELECT supplier_code, balance_no_checks
       FROM supplier_transactions
       WHERE company_id = ? AND status = 'posted'
         AND id = (
           SELECT MAX(id) FROM supplier_transactions st2
           WHERE st2.supplier_code = supplier_transactions.supplier_code
             AND st2.company_id = supplier_transactions.company_id
             AND st2.status = 'posted'
             AND st2.transaction_date <= ?
         )
     ) last_tx ON last_tx.supplier_code = s.code
     WHERE s.company_id = ? AND s.is_active = 1
     GROUP BY s.code, s.name, s.activity, last_tx.balance_no_checks
     HAVING total_balance <> 0
     ORDER BY total_balance DESC
    `
  ).bind(
    asOf, asOf,
    asOf, asOf,
    asOf, asOf,
    asOf,
    company_id, asOf,
    company_id,
  ).all()

  const totals = (results as Record<string, number>[]).reduce(
    (acc, r) => ({
      total_balance: acc.total_balance + (r.total_balance ?? 0),
      current_0_30:  acc.current_0_30  + (r.current_0_30  ?? 0),
      aged_31_60:    acc.aged_31_60    + (r.aged_31_60    ?? 0),
      aged_61_90:    acc.aged_61_90    + (r.aged_61_90    ?? 0),
      aged_90_plus:  acc.aged_90_plus  + (r.aged_90_plus  ?? 0),
    }),
    { total_balance: 0, current_0_30: 0, aged_31_60: 0, aged_61_90: 0, aged_90_plus: 0 },
  )

  return c.json({ success: true, data: { suppliers: results, totals, as_of: asOf } })
})

// GET /api/suppliers/drafts — all draft transactions across all suppliers (must be before /:code)
suppliers.get('/drafts', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.supplier_code, t.transaction_date, t.entry_type,
            t.document_type, t.document_number, t.expense_category,
            t.amount, t.credit, t.debit, t.notes, t.season_id,
            t.center_code, t.financial_account_id, t.created_at,
            s.name AS supplier_name, s.activity AS supplier_activity
     FROM supplier_transactions t
     JOIN suppliers s ON s.code = t.supplier_code AND s.company_id = t.company_id
     WHERE t.company_id = ? AND t.status = 'draft'
     ORDER BY t.transaction_date DESC, t.id DESC`
  ).bind(company_id).all()

  return c.json({ success: true, data: results })
})

// GET /api/suppliers/:code/summary — Odoo-style smart-button aggregates
suppliers.get('/:code/summary', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))
  const apAccountCode = await resolveControlAccount(c.env.DB, company_id, 'accounts_payable')

  const [invoices, payments, glLedger] = await Promise.all([
    // All supplier transactions (invoices / credit notes)
    c.env.DB.prepare(`
      SELECT
        COUNT(*) AS total_count,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) AS draft_count,
        COUNT(CASE WHEN status = 'posted' THEN 1 END) AS posted_count,
        COALESCE(SUM(CASE WHEN status='posted' THEN credit ELSE 0 END), 0) AS total_credit,
        COALESCE(SUM(CASE WHEN status='posted' THEN debit  ELSE 0 END), 0) AS total_debit
      FROM supplier_transactions
      WHERE company_id = ? AND supplier_code = ?
    `).bind(company_id, code).first<{
      total_count: number; draft_count: number; posted_count: number
      total_credit: number; total_debit: number
    }>(),

    // Treasury payments to this supplier
    c.env.DB.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
      FROM cash_transactions
      WHERE company_id = ? AND supplier_code = ? AND direction = 'م' AND status = 'posted'
    `).bind(company_id, code).first<{ count: number; total: number }>(),

    // GL Ledger balance — only entries linked to this supplier's transactions
    c.env.DB.prepare(`
      SELECT
        COALESCE(SUM(l.debit), 0)  AS total_debit,
        COALESCE(SUM(l.credit), 0) AS total_credit
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id
      JOIN supplier_transactions st ON st.journal_entry_id = e.id AND st.company_id = e.company_id
      WHERE l.company_id = ? AND l.account_code = ? AND e.is_posted = 1
        AND st.supplier_code = ?
    `).bind(company_id, apAccountCode, code).first<{ total_debit: number; total_credit: number }>(),
  ])

  const openBalance = (invoices?.total_credit ?? 0) - (invoices?.total_debit ?? 0)

  return c.json({
    success: true,
    data: {
      invoices_count:  invoices?.total_count   ?? 0,
      draft_count:     invoices?.draft_count    ?? 0,
      posted_count:    invoices?.posted_count   ?? 0,
      total_credit:    invoices?.total_credit   ?? 0,
      total_debit:     invoices?.total_debit    ?? 0,
      open_balance:    openBalance,
      payments_count:  payments?.count          ?? 0,
      payments_total:  payments?.total          ?? 0,
      gl_debit:        glLedger?.total_debit    ?? 0,
      gl_credit:       glLedger?.total_credit   ?? 0,
    },
  })
})

// GET /api/suppliers/:code
suppliers.get('/:code', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))

  const supplier = await c.env.DB
    .prepare('SELECT * FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id).first()

  if (!supplier) return c.json({ success: false, error: 'المورد غير موجود' }, 404)
  return c.json({ success: true, data: supplier })
})

// POST /api/suppliers
suppliers.post('/', financeOnly, async (c) => {
  const { company_id } = getUser(c)
  const body = await c.req.json<{
    code: number; name: string; activity?: string; notes?: string
    phone?: string; email?: string; address?: string
    tax_number?: string; credit_limit?: number; payment_terms?: number
    supplier_type?: string; bus_posting_group_code?: string
  }>()

  if (!body.code || !body.name) {
    return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)
  }

  // BPG is required for proper GL posting — enforce at creation boundary
  if (!body.bus_posting_group_code?.trim()) {
    return c.json({
      success: false,
      error: 'bus_posting_group_code مطلوب لتمكين الترحيل المحاسبي الصحيح. القيم المتاحة: AGRI-OP, LABOR, LOCAL, IMPORT',
    }, 400)
  }

  // Validate BPG exists in posting_rules
  const bpgValid = await c.env.DB
    .prepare('SELECT 1 FROM posting_rules WHERE company_id = ? AND bus_posting_group_code = ? LIMIT 1')
    .bind(company_id, body.bus_posting_group_code).first()
  if (!bpgValid) {
    return c.json({ success: false, error: `مجموعة الترحيل "${body.bus_posting_group_code}" غير موجودة في قواعد الترحيل` }, 400)
  }

  // Basic email validation
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ success: false, error: 'صيغة البريد الإلكتروني غير صحيحة' }, 400)
  }

  const exists = await c.env.DB
    .prepare('SELECT 1 FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(body.code, company_id).first()

  if (exists) return c.json({ success: false, error: 'الكود مستخدم بالفعل' }, 409)

  await c.env.DB
    .prepare(`INSERT INTO suppliers
      (code, company_id, name, activity, notes, phone, email, address,
       tax_number, credit_limit, payment_terms, supplier_type, bus_posting_group_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      body.code, company_id, body.name,
      body.activity ?? null, body.notes ?? null,
      body.phone ?? null, body.email ?? null, body.address ?? null,
      body.tax_number ?? null, body.credit_limit ?? null,
      body.payment_terms ?? 30,
      body.supplier_type ?? 'supplier',
      body.bus_posting_group_code,
    ).run()

  return c.json({ success: true, data: { code: body.code } }, 201)
})

// PATCH /api/suppliers/:code
suppliers.patch('/:code', financeOnly, async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))
  const body = await c.req.json<{
    name?: string; activity?: string; notes?: string; is_active?: number
    phone?: string; email?: string; address?: string
    tax_number?: string; credit_limit?: number; payment_terms?: number
    supplier_type?: string; bus_posting_group_code?: string
  }>()

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ success: false, error: 'صيغة البريد الإلكتروني غير صحيحة' }, 400)
  }

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name      !== undefined) { fields.push('name = ?');      values.push(body.name) }
  if (body.activity  !== undefined) { fields.push('activity = ?');  values.push(body.activity) }
  if (body.notes     !== undefined) { fields.push('notes = ?');     values.push(body.notes) }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); values.push(body.is_active) }
  if (body.phone     !== undefined) { fields.push('phone = ?');     values.push(body.phone) }
  if (body.email     !== undefined) { fields.push('email = ?');     values.push(body.email) }
  if (body.address   !== undefined) { fields.push('address = ?');   values.push(body.address) }
  if (body.tax_number    !== undefined) { fields.push('tax_number = ?');    values.push(body.tax_number) }
  if (body.credit_limit  !== undefined) { fields.push('credit_limit = ?');  values.push(body.credit_limit) }
  if (body.payment_terms !== undefined) { fields.push('payment_terms = ?'); values.push(body.payment_terms) }
  if (body.supplier_type !== undefined) { fields.push('supplier_type = ?'); values.push(body.supplier_type) }
  if (body.bus_posting_group_code !== undefined) {
    // Prevent clearing BPG on update — once set it must remain valid
    if (!body.bus_posting_group_code?.trim()) {
      return c.json({ success: false, error: 'لا يمكن إزالة مجموعة الترحيل (bus_posting_group_code). لتغييرها أرسل قيمة جديدة صحيحة.' }, 400)
    }
    const bpgValid = await c.env.DB
      .prepare('SELECT 1 FROM posting_rules WHERE company_id = ? AND bus_posting_group_code = ? LIMIT 1')
      .bind(company_id, body.bus_posting_group_code).first()
    if (!bpgValid) {
      return c.json({ success: false, error: `مجموعة الترحيل "${body.bus_posting_group_code}" غير موجودة في قواعد الترحيل` }, 400)
    }
    fields.push('bus_posting_group_code = ?')
    values.push(body.bus_posting_group_code)
  }

  if (!fields.length) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  await c.env.DB
    .prepare(`UPDATE suppliers SET ${fields.join(', ')} WHERE code = ? AND company_id = ?`)
    .bind(...values, code, company_id).run()

  return c.json({ success: true, data: null })
})

// GET /api/suppliers/:code/statement?page=1&size=50&season_id=&month=
suppliers.get('/:code/statement', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const code     = Number(c.req.param('code'))
  const page     = Math.max(1, Number(c.req.query('page') ?? 1))
  const size     = Math.min(200, Number(c.req.query('size') ?? 100))
  const seasonId = c.req.query('season_id')
  const month    = c.req.query('month')
  const offset   = (page - 1) * size

  let where   = 'WHERE company_id = ? AND supplier_code = ?'
  const binds: unknown[] = [company_id, code]

  if (seasonId) { where += ' AND season_id = ?';  binds.push(seasonId) }
  if (month)    { where += ' AND month = ?';       binds.push(Number(month)) }

  const [rows, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, transaction_date, entry_type, document_type, document_number,
              expense_category, equipment, unit, quantity, unit_price, amount,
              credit, debit, check_amount, balance_no_checks, balance_with_checks,
              due_date, center_code, financial_account_id, equipment_type_id, equipment_usage_mode,
              notes, year, month, status, journal_entry_id
       FROM supplier_transactions
       ${where}
       ORDER BY transaction_date DESC, id DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),

    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM supplier_transactions ${where}`)
      .bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    success: true, data: rows.results,
    total: total?.n ?? 0, page, page_size: size,
    has_more: offset + size < (total?.n ?? 0),
  })
})

// POST /api/suppliers/:code/transactions
suppliers.post('/:code/transactions', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const b    = await c.req.json<{
    transaction_date: string; entry_type: string; document_type?: string
    document_number?: number; expense_category?: string; equipment_type_id?: number; equipment?: string
    unit?: string; quantity?: number; unit_price?: number; amount: number
    credit?: number; debit?: number; check_amount?: number; due_date?: string
    notes?: string; season_id?: number; center_code?: number; account_code?: number
    financial_account_id?: number; equipment_usage_mode?: 'owned' | 'rental'
    status?: 'draft' | 'posted'
  }>()

  if (!b.transaction_date || !b.entry_type || b.amount == null) {
    return c.json({ success: false, error: 'التاريخ ونوع القيد والمبلغ مطلوبة' }, 400)
  }

  const supplier = await c.env.DB
    .prepare('SELECT code, name, is_active FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id)
    .first<{ code: number; name: string; is_active: number }>()

  if (!supplier) {
    return c.json({ success: false, error: 'المورد غير موجود' }, 404)
  }
  if (!supplier.is_active) {
    return c.json({ success: false, error: 'المورد غير نشط ولا يمكن إضافة حركة جديدة' }, 409)
  }

  const status = b.status ?? 'posted'

  if (status === 'posted') {
    const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'posted', module: 'suppliers' })
    if (!gate.ok) {
      return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)
    }
  }

  if (status === 'posted' && (b.season_id == null || b.center_code == null)) {
    return c.json({ success: false, error: 'الموسم ومركز التكلفة مطلوبان عند الترحيل' }, 422)
  }

  if (status === 'posted' && b.entry_type === 'م' && b.financial_account_id == null) {
    return c.json({ success: false, error: 'حساب الخزينة / البنك مطلوب عند ترحيل سداد المورد' }, 422)
  }

  if (b.equipment_type_id && b.equipment_usage_mode == null) {
    return c.json({ success: false, error: 'يجب تحديد ما إذا كانت المعدة إيجارًا أم مملوكة للشركة' }, 422)
  }

  if (b.equipment_type_id && b.equipment_usage_mode === 'owned' && b.entry_type === 'د' && status !== 'posted') {
    return c.json({
      success: false,
      error: 'إدخال معدات رأسمالية يجب أن يكون مرحّلًا مباشرة لضمان إنشاء الأصل الثابت وربطه بالقيد'
    }, 422)
  }

  let equipmentType: { id: number; name: string; asset_nature: string; default_life_months: number } | null = null
  if (b.equipment_type_id) {
    equipmentType = await c.env.DB.prepare(
      'SELECT id, name, asset_nature, default_life_months FROM equipment_types WHERE id = ? AND company_id = ?'
    ).bind(b.equipment_type_id, company_id).first<{
      id: number; name: string; asset_nature: string; default_life_months: number
    }>()

    if (!equipmentType) {
      return c.json({ success: false, error: 'نوع المعدة غير موجود أو غير متاح لهذه الشركة' }, 422)
    }
  }

  if (status === 'posted') {
    const periodId = await getOpenPeriod(c.env.DB, company_id, b.transaction_date)
    if (!periodId) {
      return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.transaction_date}` }, 400)
    }
  }

  const credit = b.credit ?? (b.entry_type === 'د' ? b.amount : 0)
  const debit  = b.debit  ?? (b.entry_type === 'م' ? b.amount : 0)
  const checkAmt = b.check_amount ?? 0

  const date = new Date(b.transaction_date)
  const equipmentName = (b.equipment && b.equipment.trim()) || equipmentType?.name || null
  const normalizedExpenseCategory = b.expense_category?.trim() || null
  const notesWithMeta = b.notes?.trim() || null

  // Always INSERT as draft first — GL posting and cash mirror run before we commit to 'posted'.
  // This guarantees the running balance (which filters on posted) is never corrupted by a
  // mid-flight failure: if anything below throws, the row stays draft and balance is unaffected.
  const result = await c.env.DB.prepare(
    `INSERT INTO supplier_transactions
     (company_id, season_id, supplier_code, account_code, center_code, financial_account_id,
      transaction_date, entry_type, document_type, document_number,
      expense_category, equipment, equipment_type_id, equipment_usage_mode, amount,
      credit, debit, check_amount, balance_no_checks, balance_with_checks,
      due_date, notes, year, month, created_by_user_id, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id ?? null, code, b.account_code ?? null, b.center_code ?? null, b.financial_account_id ?? null,
    b.transaction_date, b.entry_type, b.document_type ?? null, b.document_number ?? null,
    normalizedExpenseCategory, equipmentName, b.equipment_type_id ?? null, b.equipment_usage_mode ?? null, b.amount,
    credit, debit, checkAmt, 0, 0,
    b.due_date ?? null, notesWithMeta,
    date.getFullYear(), date.getMonth() + 1, userId, 'draft'
  ).run()

  const txnId = result.meta.last_row_id

  if (status === 'posted') {
    let createdAssetId: number | null = null
    let glEntryId: number | null = null
    try {
      const supplierName = supplier.name

      if (b.entry_type === 'د') {
        if (b.equipment_usage_mode === 'owned') {
          createdAssetId = await createOwnedCapitalAsset(c.env.DB, {
            companyId: company_id,
            txnId,
            supplierCode: code,
            equipmentType,
            transactionDate: b.transaction_date,
            amount: b.amount,
            centerCode: b.center_code ?? null,
            userId,
          })
        }

        glEntryId = await FinanceCore.resolveSupplierInvoice(c.env.DB, {
          company_id,
          ref_id: txnId,
          amount: b.amount,
          date: b.transaction_date,
          description: `${b.expense_category ?? b.entry_type} — ${supplierName ?? code}`,
          created_by: userId,
          supplier_code: code
        })
      } else {
        glEntryId = await FinanceCore.resolveSupplierPayment(c.env.DB, {
          company_id,
          ref_id: txnId,
          amount: b.amount,
          date: b.transaction_date,
          description: `${b.expense_category ?? b.entry_type} — ${supplierName ?? code}`,
          created_by: userId,
          center_code: b.center_code ?? undefined,
          supplier_code: code,
          financial_account_id: b.financial_account_id ?? null,
        })

        // Cash mirror runs AFTER GL. If it fails, we reverse the GL entry so no partial state exists.
        try {
          await FinanceCore.recordCashMovement(c.env.DB, {
            company_id,
            userId,
            transaction_date: b.transaction_date,
            direction: 'م',
            amount: b.amount,
            financial_account_id: b.financial_account_id ?? null,
            narration: `${b.expense_category ? b.expense_category + ' — ' : ''}سداد مستحقات ${supplierName ?? code}`,
            supplier_code: code,
            season_id: b.season_id ?? null,
            center_code: b.center_code ?? null,
            document_type: b.document_type ?? null,
            document_number: b.document_number ?? null,
            notes: b.notes
              ? `${b.notes} | [MIRROR_SUPPLIER_PAYMENT]`
              : '[MIRROR_SUPPLIER_PAYMENT]',
            status: 'posted',
            skipSupplierMirror: true,
            skipGlPosting: true,
          })
        } catch (mirrorErr: unknown) {
          // Cash mirror failed after GL was written — void the GL entry to restore atomicity.
          if (glEntryId != null) {
            await c.env.DB.prepare(
              "UPDATE journal_entries SET is_posted = 0, status = 'voided' WHERE id = ? AND company_id = ?"
            ).bind(glEntryId, company_id).run()
          }
          throw mirrorErr
        }
      }

      // All operations succeeded — promote to posted and compute running balance.
      await c.env.DB.prepare(
        "UPDATE supplier_transactions SET status = 'posted' WHERE id = ? AND company_id = ?"
      ).bind(txnId, company_id).run()

      await updateSupplierRunningBalance(c.env.DB, company_id, code, txnId, b.transaction_date)
    } catch (e: unknown) {
      if (createdAssetId != null) {
        await c.env.DB.prepare('DELETE FROM depreciation_schedules WHERE asset_id = ? AND company_id = ?')
          .bind(createdAssetId, company_id).run()
        await c.env.DB.prepare('DELETE FROM fixed_assets WHERE id = ? AND company_id = ?')
          .bind(createdAssetId, company_id).run()
      }
      // Row remains as draft; running balance was never touched (draft rows are excluded).
      await logFinancialWorkflowFailure(c.env.DB, {
        company_id,
        user_id: userId,
        module: 'suppliers',
        stage: 'post_supplier_transaction',
        table_name: 'supplier_transactions',
        record_id: txnId,
        error: e,
        context: {
          supplier_code: code,
          amount: b.amount,
          entry_type: b.entry_type,
          financial_account_id: b.financial_account_id ?? null,
        },
      })
      const message = e instanceof Error ? e.message : 'خطأ غير معروف'
      return c.json({
        success: false,
        error: `تم حفظ الفاتورة كمسودة، لكن فشل إنشاء القيد المحاسبي: ${message}`
      }, 400)
    }
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'supplier_transactions', record_id: txnId,
    new_value: {
      entry_type: b.entry_type, supplier: code, amount: b.amount,
      date: b.transaction_date, doc: b.document_number, status,
      financial_account_id: b.financial_account_id ?? null,
      equipment_type_id: b.equipment_type_id ?? null,
      equipment_usage_mode: b.equipment_usage_mode ?? null,
    },
  })

  return c.json({ success: true, data: null }, 201)
})

// PATCH /api/suppliers/:code/transactions/:id/post — Approve and post a draft invoice
suppliers.patch('/:code/transactions/:id/post', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const id   = Number(c.req.param('id'))

  const supplier = await c.env.DB
    .prepare('SELECT code, name, is_active FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id)
    .first<{ code: number; name: string; is_active: number }>()

  if (!supplier) {
    return c.json({ success: false, error: 'المورد غير موجود' }, 404)
  }
  if (!supplier.is_active) {
    return c.json({ success: false, error: 'المورد غير نشط ولا يمكن ترحيل حركة جديدة' }, 409)
  }

  const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'posted', module: 'suppliers' })
  if (!gate.ok) {
    return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)
  }

  const txn = await c.env.DB
    .prepare(`SELECT id, supplier_code, entry_type, amount, transaction_date, expense_category,
                     center_code, account_code, season_id, document_type, document_number, notes,
                     financial_account_id, equipment_type_id, equipment_usage_mode
              FROM supplier_transactions
              WHERE id = ? AND company_id = ? AND supplier_code = ? AND status = 'draft'`)
    .bind(id, company_id, code).first<{
      id: number
      supplier_code: number
      entry_type: string
      amount: number
      transaction_date: string
      expense_category: string | null
      center_code: number | null
      account_code: string | null
      season_id: number | null
      document_type: string | null
      document_number: number | null
      notes: string | null
      financial_account_id: number | null
      equipment_type_id: number | null
      equipment_usage_mode: 'owned' | 'rental' | null
    }>()

  if (!txn) return c.json({ success: false, error: 'المسودة غير موجودة أو تم ترحيلها بالفعل' }, 404)

  if (txn.season_id == null || txn.center_code == null) {
    return c.json({ success: false, error: 'لا يمكن ترحيل المسودة بدون موسم ومركز تكلفة' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, txn.transaction_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${txn.transaction_date}` }, 400)
  }

  if (txn.entry_type === 'م' && txn.financial_account_id == null) {
    return c.json({ success: false, error: 'لا يمكن ترحيل مسودة سداد بدون تحديد حساب الخزينة / البنك' }, 422)
  }

  let txnEquipmentType: { id: number; name: string; asset_nature: string; default_life_months: number } | null = null
  if (txn.equipment_type_id) {
    if (txn.equipment_usage_mode == null) {
      return c.json({ success: false, error: 'لا يمكن ترحيل مسودة معدات بدون تحديد نوع الاستخدام (إيجار/مملوك)' }, 422)
    }

    txnEquipmentType = await c.env.DB
      .prepare('SELECT id, name, asset_nature, default_life_months FROM equipment_types WHERE id = ? AND company_id = ?')
      .bind(txn.equipment_type_id, company_id)
      .first<{ id: number; name: string; asset_nature: string; default_life_months: number }>()

    if (!txnEquipmentType) {
      return c.json({ success: false, error: 'نوع المعدة غير صالح لهذه الشركة' }, 422)
    }
  }

  let createdAssetId: number | null = null
  let glEntryId: number | null = null
  try {
    const supplierName = supplier.name

    if (txn.entry_type === 'د') {
      if (txn.equipment_usage_mode === 'owned') {
        createdAssetId = await createOwnedCapitalAsset(c.env.DB, {
          companyId: company_id,
          txnId: id,
          supplierCode: code,
          equipmentType: txnEquipmentType,
          transactionDate: txn.transaction_date,
          amount: txn.amount,
          centerCode: txn.center_code ?? null,
          userId,
        })
      }

      glEntryId = await FinanceCore.resolveSupplierInvoice(c.env.DB, {
        company_id,
        ref_id: id,
        amount: txn.amount,
        date: txn.transaction_date,
        description: `${txn.expense_category ?? txn.entry_type} — ${supplierName ?? code}`,
        created_by: userId,
        expense_category: txn.expense_category,
        supplier_code: code
      })
    } else {
      glEntryId = await FinanceCore.resolveSupplierPayment(c.env.DB, {
        company_id,
        ref_id: id,
        amount: txn.amount,
        date: txn.transaction_date,
        description: `${txn.expense_category ?? txn.entry_type} — ${supplierName ?? code}`,
        created_by: userId,
        center_code: txn.center_code ?? undefined,
        expense_category: txn.expense_category,
        supplier_code: code,
        financial_account_id: txn.financial_account_id ?? null,
      })

      // Cash mirror runs AFTER GL. If it fails, void the GL entry to restore atomicity.
      try {
        await FinanceCore.recordCashMovement(c.env.DB, {
          company_id,
          userId,
          transaction_date: txn.transaction_date,
          direction: 'م',
          amount: txn.amount,
          financial_account_id: txn.financial_account_id ?? null,
          narration: `${txn.expense_category ? txn.expense_category + ' — ' : ''}سداد مستحقات ${supplierName ?? code}`,
          supplier_code: code,
          season_id: txn.season_id ?? null,
          center_code: txn.center_code ?? null,
          document_type: txn.document_type ?? null,
          document_number: txn.document_number ?? null,
          notes: txn.notes
            ? `${txn.notes} | [MIRROR_SUPPLIER_PAYMENT]`
            : '[MIRROR_SUPPLIER_PAYMENT]',
          status: 'posted',
          skipSupplierMirror: true,
          skipGlPosting: true,
        })
      } catch (mirrorErr: unknown) {
        if (glEntryId != null) {
          await c.env.DB.prepare(
            "UPDATE journal_entries SET is_posted = 0, status = 'voided' WHERE id = ? AND company_id = ?"
          ).bind(glEntryId, company_id).run()
        }
        throw mirrorErr
      }
    }

    // All operations succeeded — promote to posted, then compute running balance.
    await c.env.DB
      .prepare("UPDATE supplier_transactions SET status = 'posted' WHERE id = ? AND company_id = ?")
      .bind(id, company_id).run()

    await updateSupplierRunningBalance(c.env.DB, company_id, code, id, txn.transaction_date)

    void logAudit(c.env.DB, {
      user_id: userId, company_id, action: 'UPDATE',
      table_name: 'supplier_transactions', record_id: id,
      new_value: { status: 'posted' },
      source: 'governance_workflow'
    })

    return c.json({ success: true, data: null })
  } catch (e: unknown) {
    if (createdAssetId != null) {
      await c.env.DB.prepare('DELETE FROM depreciation_schedules WHERE asset_id = ? AND company_id = ?')
        .bind(createdAssetId, company_id).run()
      await c.env.DB.prepare('DELETE FROM fixed_assets WHERE id = ? AND company_id = ?')
        .bind(createdAssetId, company_id).run()
    }
    // Draft row is untouched; running balance was never updated (it filters posted only).
    await logFinancialWorkflowFailure(c.env.DB, {
      company_id,
      user_id: userId,
      module: 'suppliers',
      stage: 'commit_supplier_draft',
      table_name: 'supplier_transactions',
      record_id: id,
      error: e,
      context: {
        supplier_code: code,
        entry_type: txn.entry_type,
        amount: txn.amount,
        financial_account_id: txn.financial_account_id ?? null,
      },
    })
    const message = e instanceof Error ? e.message : 'خطأ غير معروف'
    return c.json({ success: false, error: `فشل ترحيل الحركة: ${message}` }, 400)
  }
})

// DELETE /api/suppliers/:code/transactions/:id — Only drafts can be deleted
suppliers.delete('/:code/transactions/:id', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const id   = Number(c.req.param('id'))

  const txn = await c.env.DB
    .prepare(`SELECT id, amount, status FROM supplier_transactions
              WHERE id = ? AND company_id = ? AND supplier_code = ?`)
    .bind(id, company_id, code)
    .first<{ id: number; amount: number; status: string }>()

  if (!txn) return c.json({ success: false, error: 'الحركة غير موجودة' }, 404)
  if (txn.status !== 'draft') {
    return c.json({ success: false, error: 'لا يمكن حذف حركة مرحّلة — يجب أن تكون مسودة فقط' }, 409)
  }

  await c.env.DB
    .prepare('DELETE FROM supplier_transactions WHERE id = ? AND company_id = ?')
    .bind(id, company_id).run()

  await _fullRebalanceSupplierBalances(c.env.DB, company_id, code)

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'DELETE',
    table_name: 'supplier_transactions', record_id: id,
    new_value: { deleted_draft: true, supplier_code: code, amount: txn.amount },
  })

  return c.json({ success: true, data: null })
})

export default suppliers
