/**
 * treasury/equity.ts
 * ===================
 * Partner capital and current account management:
 *
 *   GET   /partners       — list all partners
 *   POST  /partners       — create partner (with optional initial capital GL entry)
 *   PATCH /partners/:id   — update partner name / capital / current account (with GL delta)
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { FinanceCore } from '../../lib/finance_core'
import { logAudit } from '../../lib/audit'
import { resolveControlAccount } from '../../lib/posting_engine'
import { getOpenPeriod } from '../../lib/gl'
import { getTodayIsoDate } from '../../lib/utils/date'
import { ensureActiveCenterCode } from './shared'

const equity = new Hono<{ Bindings: Env }>()
equity.use('*', authMiddleware)
equity.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// ── GET /partners ─────────────────────────────────────────────────────────────
equity.get('/partners', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM partners WHERE company_id = ? ORDER BY name')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// ── POST /partners ────────────────────────────────────────────────────────────
equity.post('/partners', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    name: string
    capital_paid?: number
    current_acct?: number
    transaction_date?: string
    season_id?: number
    center_code?: number
  }>()

  if (!b.name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)

  const capitalPaid = b.capital_paid ?? 0
  const currentAcct = b.current_acct ?? 0
  const txDate = b.transaction_date ?? getTodayIsoDate()

  if (capitalPaid > 0) {
    if (b.season_id == null || b.center_code == null) {
      return c.json({
        success: false,
        error: 'الموسم ومركز التكلفة مطلوبان عند إدخال رأس مال مرحّل',
      }, 422)
    }

    const validCenter = await ensureActiveCenterCode(c.env.DB, company_id, b.center_code)
    if (!validCenter) {
      return c.json({ success: false, error: 'مركز التكلفة غير صالح أو غير نشط' }, 422)
    }

    const periodId = await getOpenPeriod(c.env.DB, company_id, txDate)
    if (!periodId) {
      return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${txDate}` }, 400)
    }
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO partners (company_id, name, capital_paid, current_acct) VALUES (?,?,?,?)'
  ).bind(company_id, b.name.trim(), capitalPaid, currentAcct).run()

  const newId = result.meta.last_row_id as number

  if (capitalPaid > 0) {
    let equityCode: string | null = null
    let cashCode: string | null = null
    try {
      equityCode = await resolveControlAccount(c.env.DB, company_id, 'equity')
      cashCode   = await resolveControlAccount(c.env.DB, company_id, 'cash')
    } catch {
      // Control mapping not ready — partner created; GL skipped silently.
    }

    if (equityCode && cashCode) {
      await FinanceCore.prepareCashMovement(c.env.DB, {
        company_id, userId,
        transaction_date: txDate,
        direction: 'د',
        amount: capitalPaid,
        narration: `إضافة رأس مال شريك: ${b.name.trim()}`,
        season_id: b.season_id,
        center_code: b.center_code,
        status: 'posted',
        contraAccount: equityCode,
      })
    }
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'partners', record_id: newId,
    new_value: { name: b.name, capital_paid: capitalPaid },
  })

  return c.json({ success: true, data: { id: newId } }, 201)
})

// ── PATCH /partners/:id ───────────────────────────────────────────────────────
equity.patch('/partners/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<{
    name?: string
    capital_paid?: number
    current_acct?: number
    transaction_date?: string
  }>()

  const current = await c.env.DB
    .prepare('SELECT name, capital_paid, current_acct FROM partners WHERE id = ? AND company_id = ?')
    .bind(id, company_id)
    .first<{ name: string; capital_paid: number; current_acct: number }>()
  if (!current) return c.json({ success: false, error: 'الشريك غير موجود' }, 404)

  const fields: string[] = []
  const values: unknown[] = []
  if (b.name         !== undefined) { fields.push('name = ?');          values.push(b.name.trim()) }
  if (b.capital_paid !== undefined) { fields.push('capital_paid = ?');  values.push(b.capital_paid) }
  if (b.current_acct !== undefined) { fields.push('current_acct = ?');  values.push(b.current_acct) }

  if (!fields.length) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  await c.env.DB
    .prepare(`UPDATE partners SET ${fields.join(', ')} WHERE id = ? AND company_id = ?`)
    .bind(...values, id, company_id).run()

  const txDate = b.transaction_date ?? getTodayIsoDate()
  const partnerName = b.name?.trim() ?? current.name
  const hasCapitalDelta = b.capital_paid !== undefined && Math.abs(b.capital_paid - (current.capital_paid ?? 0)) > 0.01
  const hasCurrentDelta = b.current_acct !== undefined && Math.abs(b.current_acct - (current.current_acct ?? 0)) > 0.01

  if (hasCapitalDelta || hasCurrentDelta) {
    const periodId = await getOpenPeriod(c.env.DB, company_id, txDate)
    if (!periodId) {
      return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${txDate}` }, 400)
    }
  }

  if (b.capital_paid !== undefined) {
    const delta = b.capital_paid - (current.capital_paid ?? 0)
    if (Math.abs(delta) > 0.01) {
      const desc = delta > 0
        ? `زيادة رأس مال شريك: ${partnerName}`
        : `تخفيض رأس مال شريك: ${partnerName}`

      await FinanceCore.resolvePartnerCapital(c.env.DB, {
        company_id, ref_id: id, partner_id: id,
        amount: Math.abs(delta),
        direction: delta > 0 ? 'injection' : 'withdrawal',
        date: txDate, description: desc, created_by: userId,
      })
    }
  }

  if (b.current_acct !== undefined) {
    const delta = b.current_acct - (current.current_acct ?? 0)
    if (Math.abs(delta) > 0.01) {
      const desc = delta > 0
        ? `إيداع في حساب شريك جاري: ${partnerName}`
        : `سحب من حساب شريك جاري: ${partnerName}`

      await FinanceCore.resolvePartnerCurrent(c.env.DB, {
        company_id, ref_id: id, partner_id: id,
        amount: Math.abs(delta),
        direction: delta > 0 ? 'deposit' : 'withdrawal',
        date: txDate, description: desc, created_by: userId,
      })
    }
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'partners', record_id: id, new_value: b,
  })

  return c.json({ success: true, data: null })
})

export default equity
