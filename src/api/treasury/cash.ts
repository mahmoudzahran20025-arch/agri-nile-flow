/**
 * treasury/cash.ts
 * =================
 * Cash transaction lifecycle:
 *
 *   GET   /transactions                — list with filters + running balance
 *   GET   /balance                     — net cash balance (optionally by account)
 *   POST  /transactions                — create (draft or direct-post)
 *   PATCH /transactions/:id/post       — approve and post a draft
 *   GET   /supplier-payments           — supplier payment history
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { FinanceCore } from '../../lib/finance_core'
import { logAudit } from '../../lib/audit'
import { enforceDataQualityPolicy } from '../../lib/data_quality'
import { isFutureIsoDate } from '../../lib/utils/date'
import { isKnownServiceTypeCode, hasTechnicalGovernanceTag } from '../../lib/utils/api_helpers'
import { zValidator } from '@hono/zod-validator'
import {
  userMsg,
  ensureActiveCenterCode,
  ensureActiveFinancialAccount,
  isSupplierAuthorizedForService,
  cashNeedsOperationalDimensions,
  transactionSchema,
} from './shared'

const cash = new Hono<{ Bindings: Env }>()
cash.use('*', authMiddleware)
cash.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// ── GET /transactions ─────────────────────────────────────────────────────────
cash.get('/transactions', async (c) => {
  const { company_id } = getUser(c)
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(200, Number(c.req.query('size') ?? 100))
  const direction = c.req.query('direction')
  const seasonId  = c.req.query('season_id')
  const status    = c.req.query('status')
  const month     = c.req.query('month')
  const year      = c.req.query('year')
  const search    = c.req.query('search')
  const accountId = c.req.query('account_id')
  const partnerId = c.req.query('partner_id')
  const supplierCode = c.req.query('supplier_code')
  const offset    = (page - 1) * size

  let filters = ''
  const filterBinds: unknown[] = []

  if (direction)    { filters += ' AND ct.direction = ?';             filterBinds.push(direction) }
  if (seasonId)     { filters += ' AND ct.season_id = ?';             filterBinds.push(seasonId) }
  if (status)       { filters += ' AND ct.status = ?';                filterBinds.push(status) }
  if (month)        { filters += ' AND ct.month = ?';                 filterBinds.push(Number(month)) }
  if (year)         { filters += ' AND ct.year = ?';                  filterBinds.push(Number(year)) }
  if (accountId)    { filters += ' AND ct.financial_account_id = ?';  filterBinds.push(Number(accountId)) }
  if (partnerId)    { filters += ' AND ct.partner_id = ?';            filterBinds.push(Number(partnerId)) }
  if (supplierCode) { filters += ' AND ct.supplier_code = ?';         filterBinds.push(Number(supplierCode)) }
  if (search) {
    filters += ' AND (ct.narration LIKE ? OR ct.recipient_name LIKE ? OR s.name LIKE ?)'
    const like = `%${search}%`
    filterBinds.push(like, like, like)
  }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `WITH ledger AS (
         SELECT ct0.id,
                CASE
                  WHEN ct0.status = 'posted' THEN
                    SUM(
                      CASE
                        WHEN ct0.status = 'posted' AND ct0.direction = 'د' THEN ct0.amount
                        WHEN ct0.status = 'posted' AND ct0.direction = 'م' THEN -ct0.amount
                        ELSE 0
                      END
                    ) OVER (
                      PARTITION BY COALESCE(ct0.financial_account_id, -1)
                      ORDER BY ct0.transaction_date ASC, ct0.id ASC
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    )
                  ELSE NULL
                END AS derived_running_balance
         FROM cash_transactions ct0
         WHERE ct0.company_id = ?
       )
       SELECT ct.id, ct.transaction_date, ct.direction, ct.document_number, ct.recipient_name,
              ct.narration, ct.amount, ct.debit, ct.credit,
              COALESCE(ct.running_balance, ledger.derived_running_balance) AS running_balance,
              ct.year, ct.month,
              ct.notes, ct.status, ct.field_id, ct.center_code, ct.season_id, ct.document_type,
              ct.financial_account_id, ct.partner_id, ct.journal_entry_id,
              ct.supplier_code, ct.expense_code,
              s.name  AS supplier_name,
              et.name AS expense_name
       FROM cash_transactions ct
       LEFT JOIN ledger         ON ledger.id = ct.id
       LEFT JOIN suppliers     s  ON s.code  = ct.supplier_code AND s.company_id = ct.company_id
       LEFT JOIN expense_types et ON et.code = ct.expense_code  AND et.company_id = ct.company_id AND et.is_deprecated = 0
       WHERE ct.company_id = ? ${filters}
       ORDER BY ct.transaction_date ASC, ct.id ASC LIMIT ? OFFSET ?`
    ).bind(company_id, company_id, ...filterBinds, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cash_transactions ct
       LEFT JOIN suppliers s ON s.code = ct.supplier_code AND s.company_id = ct.company_id
       WHERE ct.company_id = ? ${filters}`
    ).bind(company_id, ...filterBinds).first<{ n: number }>(),
  ])

  return c.json({
    success: true, data: rows.results,
    total: cnt?.n ?? 0, page, page_size: size,
    has_more: offset + size < (cnt?.n ?? 0),
  })
})

// ── GET /balance ──────────────────────────────────────────────────────────────
cash.get('/balance', async (c) => {
  const { company_id } = getUser(c)
  const accountId = c.req.query('account_id')

  let where = 'WHERE company_id = ? AND status = "posted"'
  const binds: unknown[] = [company_id]

  if (accountId) {
    where += ' AND financial_account_id = ?'
    binds.push(Number(accountId))
  }

  const row = await c.env.DB
    .prepare(`SELECT COALESCE(SUM(CASE WHEN direction = 'د' THEN amount ELSE -amount END), 0) AS balance
              FROM cash_transactions ${where}`)
    .bind(...binds).first<{ balance: number }>()

  return c.json({ success: true, data: { balance: row?.balance ?? 0 } })
})

// ── POST /transactions ────────────────────────────────────────────────────────
cash.post('/transactions', zValidator('json', transactionSchema), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = c.req.valid('json')
  const statementText  = (b.statement_text ?? b.narration ?? '').trim()
  const notesInternal  = (b.notes_internal ?? b.notes ?? '').trim() || null
  const serviceTypeCode = b.service_type_code?.trim() || null

  if (statementText.length < 3) {
    return c.json({ success: false, error: 'البيان يجب أن يكون 3 أحرف على الأقل' }, 422)
  }

  if (b.status === 'posted') {
    if (isFutureIsoDate(b.transaction_date)) {
      return c.json({ success: false, error: 'غير مسموح بترحيل حركة خزينة بتاريخ مستقبلي' }, 422)
    }

    const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'posted', module: 'treasury' })
    if (!gate.ok) {
      return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)
    }

    if (b.financial_account_id == null) {
      return c.json({ success: false, error: 'الحساب المالي مطلوب عند الترحيل' }, 422)
    }
    const validFinancialAccount = await ensureActiveFinancialAccount(c.env.DB, company_id, b.financial_account_id)
    if (!validFinancialAccount) {
      return c.json({ success: false, error: 'الحساب المالي غير صالح أو غير نشط أو غير مربوط بحساب GL ورقي' }, 422)
    }
    if (hasTechnicalGovernanceTag(statementText)) {
      return c.json({ success: false, error: 'غير مسموح باستخدام وسوم الحوكمة التقنية داخل البيان' }, 422)
    }
    if (hasTechnicalGovernanceTag(notesInternal)) {
      return c.json({ success: false, error: 'وسوم الحوكمة التقنية يجب أن تُسجل كـ flags وليس داخل الملاحظات' }, 422)
    }
    if (serviceTypeCode) {
      const knownServiceType = await isKnownServiceTypeCode(c.env.DB, company_id, serviceTypeCode)
      if (!knownServiceType) {
        return c.json({ success: false, error: 'service_type_code غير معروف أو غير نشط' }, 422)
      }
      if (b.supplier_code != null) {
        const authorized = await isSupplierAuthorizedForService(c.env.DB, company_id, b.supplier_code, serviceTypeCode)
        if (!authorized) {
          return c.json({ success: false, error: 'المورد غير مخول لهذا service_type_code' }, 422)
        }
      }
    }
    if (b.direction === 'م' && b.supplier_code != null && !serviceTypeCode) {
      return c.json({ success: false, error: 'service_type_code مطلوب عند سداد مورد مرحّل' }, 422)
    }
  }

  const requiresOperationalDimensions = b.status === 'posted' && cashNeedsOperationalDimensions(b)
  if (requiresOperationalDimensions && (b.season_id == null || b.center_code == null)) {
    return c.json({ success: false, error: 'الموسم ومركز التكلفة مطلوبان عند الترحيل' }, 422)
  }
  if (b.status === 'posted' && b.center_code != null) {
    const validCenter = await ensureActiveCenterCode(c.env.DB, company_id, b.center_code)
    if (!validCenter) {
      return c.json({ success: false, error: 'مركز التكلفة غير صالح أو غير نشط' }, 422)
    }
  }
  if (b.status === 'posted' && b.direction === 'م' && b.supplier_code == null && b.partner_id == null && b.expense_code == null) {
    return c.json({ success: false, error: 'بند المصروف مطلوب للصرف بدون مورد أو شريك' }, 422)
  }

  try {
    const { txnId, balance } = await FinanceCore.prepareCashMovement(c.env.DB, {
      company_id, userId,
      transaction_date: b.transaction_date,
      direction: b.direction,
      amount: b.amount,
      narration: statementText,
      statement_text: statementText,
      recipient_name: b.recipient_name,
      document_number: b.document_number,
      supplier_code: b.supplier_code,
      center_code: b.center_code,
      field_id: b.field_id,
      season_id: b.season_id,
      expense_code: b.expense_code,
      notes: notesInternal,
      notes_internal: notesInternal,
      service_type_code: serviceTypeCode,
      status: b.status,
      document_type: b.document_type,
      financial_account_id: b.financial_account_id,
      partner_id: b.partner_id,
    })

    return c.json({ success: true, data: { running_balance: balance, id: txnId } }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: userMsg(err) }, 400)
  }
})

// ── PATCH /transactions/:id/post ──────────────────────────────────────────────
cash.patch('/transactions/:id/post', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'posted', module: 'treasury' })
  if (!gate.ok) {
    return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)
  }

  const draft = await c.env.DB.prepare(
    `SELECT season_id, center_code, supplier_code, partner_id, expense_code, direction,
            financial_account_id, narration, notes, service_type_code, transaction_date
     FROM cash_transactions WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first<{
    season_id: number | null
    center_code: number | null
    supplier_code: number | null
    partner_id: number | null
    expense_code: string | null
    direction: 'د' | 'م'
    financial_account_id: number | null
    narration: string | null
    notes: string | null
    service_type_code: string | null
    transaction_date: string
  }>()

  if (!draft) return c.json({ success: false, error: 'الحركة غير موجودة' }, 404)
  if (draft.financial_account_id == null) {
    return c.json({ success: false, error: 'الحساب المالي مطلوب عند الترحيل' }, 422)
  }
  if (isFutureIsoDate(draft.transaction_date)) {
    return c.json({ success: false, error: 'غير مسموح بترحيل حركة خزينة بتاريخ مستقبلي' }, 422)
  }
  const validFinancialAccount = await ensureActiveFinancialAccount(c.env.DB, company_id, draft.financial_account_id)
  if (!validFinancialAccount) {
    return c.json({ success: false, error: 'الحساب المالي غير صالح أو غير نشط أو غير مربوط بحساب GL ورقي' }, 422)
  }
  if (!draft.narration || draft.narration.trim().length < 3) {
    return c.json({ success: false, error: 'البيان يجب أن يكون 3 أحرف على الأقل' }, 422)
  }
  if (hasTechnicalGovernanceTag(draft.narration)) {
    return c.json({ success: false, error: 'غير مسموح باستخدام وسوم الحوكمة التقنية داخل البيان' }, 422)
  }
  if (hasTechnicalGovernanceTag(draft.notes)) {
    return c.json({ success: false, error: 'وسوم الحوكمة التقنية يجب أن تُسجل كـ flags وليس داخل الملاحظات' }, 422)
  }
  if (draft.direction === 'م' && draft.supplier_code != null && (!draft.service_type_code || !draft.service_type_code.trim())) {
    return c.json({ success: false, error: 'service_type_code مطلوب عند سداد مورد مرحّل' }, 422)
  }
  if (draft.service_type_code && draft.supplier_code != null) {
    const knownServiceType = await isKnownServiceTypeCode(c.env.DB, company_id, draft.service_type_code)
    if (!knownServiceType) {
      return c.json({ success: false, error: 'service_type_code غير معروف أو غير نشط' }, 422)
    }
    const authorized = await isSupplierAuthorizedForService(c.env.DB, company_id, draft.supplier_code, draft.service_type_code)
    if (!authorized) {
      return c.json({ success: false, error: 'المورد غير مخول لهذا service_type_code' }, 422)
    }
  }
  if (cashNeedsOperationalDimensions(draft) && (draft.season_id == null || draft.center_code == null)) {
    return c.json({ success: false, error: 'الموسم ومركز التكلفة مطلوبان عند الترحيل' }, 422)
  }
  if (draft.center_code != null) {
    const validCenter = await ensureActiveCenterCode(c.env.DB, company_id, draft.center_code)
    if (!validCenter) {
      return c.json({ success: false, error: 'مركز التكلفة غير صالح أو غير نشط' }, 422)
    }
  }

  try {
    const result = await FinanceCore.postCashMovement(c.env.DB, company_id, id, userId)

    void logAudit(c.env.DB, {
      user_id: userId, company_id, action: 'UPDATE',
      table_name: 'cash_transactions', record_id: id,
      new_value: { status: 'posted' },
      source: 'governance_workflow',
    })

    return c.json({ success: true, data: result })
  } catch (err: any) {
    return c.json({ success: false, error: userMsg(err) }, 400)
  }
})

// ── GET /supplier-payments ────────────────────────────────────────────────────
cash.get('/supplier-payments', async (c) => {
  const { company_id } = getUser(c)
  const supplierCode = c.req.query('supplier_code')

  const { results } = await c.env.DB.prepare(
    `SELECT ct.transaction_date, ct.narration, ct.amount,
            s.name AS supplier_name, ct.supplier_code
     FROM cash_transactions ct
     LEFT JOIN suppliers s ON s.code = ct.supplier_code AND s.company_id = ct.company_id
     WHERE ct.company_id = ? AND ct.direction = 'م'
       AND ct.supplier_code ${supplierCode ? '= ?' : 'IS NOT NULL'}
     ORDER BY ct.transaction_date DESC LIMIT 200`
  ).bind(...(supplierCode ? [company_id, supplierCode] : [company_id])).all()

  return c.json({ success: true, data: results })
})

export default cash
