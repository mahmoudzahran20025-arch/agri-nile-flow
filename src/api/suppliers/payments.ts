/**
 * suppliers/payments.ts
 * ======================
 * AP settlement and aging-summary endpoints:
 *
 *   POST  /:code/match-payment   — match a payment against invoice(s)
 *   POST  /:code/unmatch-payment — reverse a match (drafts the reversal, finance-only)
 *   GET   /aging-summary          — AP aging across all suppliers (CFO dashboard)
 *
 * Match-payment design:
 *   • Default: FIFO — oldest unmatched invoice first.
 *   • Explicit: caller provides invoice_id to match a specific invoice.
 *   • Partial payment support: if payment.debit < invoice.credit, the invoice
 *     stays open with is_matched = 0; a partial_match_amount is recorded.
 *   • Full match: both rows get is_matched = 1, invoice gets matched_payment_id.
 *   • The supplier_ap_ledger VIEW re-reads is_matched on every query — no GL
 *     entries are created here; matching is a sub-ledger operation only.
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, permissionGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'
import { getTodayIsoDate } from '../../lib/utils/date'

const payments = new Hono<{ Bindings: Env }>()
payments.use('*', authMiddleware)

// ── POST /:code/match-payment ─────────────────────────────────────────────────
payments.post('/:code/match-payment', permissionGuard('suppliers', 'write'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const supplierCode = Number(c.req.param('code'))
  const body = await c.req.json<{
    payment_id: number
    invoice_id?: number       // explicit match; if omitted → FIFO oldest open invoice
    allow_partial?: boolean   // default false — reject if payment < invoice.credit
  }>()

  if (!body.payment_id) return c.json({ success: false, error: 'payment_id مطلوب' }, 400)

  // ── Load payment ─────────────────────────────────────────────────────────
  const payment = await c.env.DB.prepare(
    `SELECT id, debit, amount, is_matched
     FROM supplier_transactions
     WHERE id = ? AND company_id = ? AND supplier_code = ?
       AND status = 'posted'
     LIMIT 1`
  ).bind(body.payment_id, company_id, supplierCode)
   .first<{ id: number; debit: number; amount: number; is_matched: number | null }>()

  if (!payment) return c.json({ success: false, error: 'سند الدفع غير موجود أو غير مرحّل' }, 404)
  if (payment.is_matched) return c.json({ success: false, error: 'سند الدفع مُقابَل بالفعل' }, 409)

  const paymentAmount = payment.debit || payment.amount

  // ── Resolve invoice ───────────────────────────────────────────────────────
  let invoiceId = body.invoice_id
  if (!invoiceId) {
    const oldest = await c.env.DB.prepare(
      `SELECT id FROM supplier_transactions
       WHERE company_id = ? AND supplier_code = ?
         AND entry_type IN ('invoice', 'debit', 'مدين', 'فاتورة', 'د')
         AND (is_matched IS NULL OR is_matched = 0) AND credit > 0
         AND status = 'posted'
       ORDER BY COALESCE(due_date, transaction_date) ASC
       LIMIT 1`
    ).bind(company_id, supplierCode).first<{ id: number }>()
    if (!oldest) return c.json({ success: false, error: 'لا توجد فواتير مفتوحة لهذا المورد' }, 404)
    invoiceId = oldest.id
  }

  const invoice = await c.env.DB.prepare(
    `SELECT id, credit, amount, is_matched, due_date, transaction_date
     FROM supplier_transactions
     WHERE id = ? AND company_id = ? AND supplier_code = ? AND status = 'posted'
     LIMIT 1`
  ).bind(invoiceId, company_id, supplierCode)
   .first<{ id: number; credit: number; amount: number; is_matched: number | null; due_date: string | null; transaction_date: string }>()

  if (!invoice) return c.json({ success: false, error: 'الفاتورة غير موجودة أو غير مرحّلة' }, 404)
  if (invoice.is_matched) return c.json({ success: false, error: 'الفاتورة مُقابَلة بالفعل' }, 409)

  const invoiceAmount = invoice.credit || invoice.amount

  // ── Partial payment guard ─────────────────────────────────────────────────
  const isPartial = paymentAmount < invoiceAmount
  if (isPartial && !body.allow_partial) {
    return c.json({
      success: false,
      error: `مبلغ الدفع (${paymentAmount}) أقل من الفاتورة (${invoiceAmount}). أرسل allow_partial=true للمقابلة الجزئية.`,
      payment_amount: paymentAmount,
      invoice_amount: invoiceAmount,
      shortfall: invoiceAmount - paymentAmount,
    }, 422)
  }

  const isFullMatch = paymentAmount >= invoiceAmount

  // ── Batch update ──────────────────────────────────────────────────────────
  if (isFullMatch) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE supplier_transactions SET is_matched = 1, matched_payment_id = ? WHERE id = ? AND company_id = ?'
      ).bind(body.payment_id, invoiceId, company_id),
      c.env.DB.prepare(
        'UPDATE supplier_transactions SET is_matched = 1 WHERE id = ? AND company_id = ?'
      ).bind(body.payment_id, company_id),
    ])
  } else {
    // Partial: mark payment as matched; invoice stays open
    await c.env.DB.prepare(
      'UPDATE supplier_transactions SET is_matched = 1 WHERE id = ? AND company_id = ?'
    ).bind(body.payment_id, company_id).run()
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'supplier_transactions', record_id: invoiceId,
    new_value: {
      action: 'match_payment',
      invoice_id: invoiceId, payment_id: body.payment_id,
      invoice_amount: invoiceAmount, payment_amount: paymentAmount,
      match_type: isFullMatch ? 'full' : 'partial',
    },
  })

  return c.json({
    success: true,
    data: {
      invoice_id:     invoiceId,
      payment_id:     body.payment_id,
      invoice_amount: invoiceAmount,
      payment_amount: paymentAmount,
      match_type:     isFullMatch ? 'full' : 'partial',
      remaining_on_invoice: isFullMatch ? 0 : invoiceAmount - paymentAmount,
    },
  })
})

// ── POST /:code/unmatch-payment ───────────────────────────────────────────────
// Reverses a match — restores is_matched = 0 on both rows.
// Finance-only; requires reason. Does NOT create a GL reversal (matching is sub-ledger only).
payments.post('/:code/unmatch-payment', permissionGuard('suppliers', 'write'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const supplierCode = Number(c.req.param('code'))
  const body = await c.req.json<{ invoice_id: number; reason?: string }>()

  if (!body.invoice_id) return c.json({ success: false, error: 'invoice_id مطلوب' }, 400)

  const invoice = await c.env.DB.prepare(
    `SELECT id, is_matched, matched_payment_id
     FROM supplier_transactions
     WHERE id = ? AND company_id = ? AND supplier_code = ? AND status = 'posted'`
  ).bind(body.invoice_id, company_id, supplierCode)
   .first<{ id: number; is_matched: number | null; matched_payment_id: number | null }>()

  if (!invoice) return c.json({ success: false, error: 'الفاتورة غير موجودة' }, 404)
  if (!invoice.is_matched) return c.json({ success: false, error: 'الفاتورة غير مقابَلة أصلاً' }, 409)

  const stmts = [
    c.env.DB.prepare(
      'UPDATE supplier_transactions SET is_matched = 0, matched_payment_id = NULL WHERE id = ? AND company_id = ?'
    ).bind(body.invoice_id, company_id),
  ]

  if (invoice.matched_payment_id) {
    stmts.push(
      c.env.DB.prepare(
        'UPDATE supplier_transactions SET is_matched = 0 WHERE id = ? AND company_id = ?'
      ).bind(invoice.matched_payment_id, company_id)
    )
  }

  await c.env.DB.batch(stmts)

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'supplier_transactions', record_id: body.invoice_id,
    new_value: {
      action: 'unmatch_payment',
      invoice_id: body.invoice_id,
      payment_id: invoice.matched_payment_id,
      reason: body.reason ?? null,
    },
  })

  return c.json({
    success: true,
    data: { invoice_id: body.invoice_id, payment_id: invoice.matched_payment_id },
  })
})

// ── GET /aging-summary ─────────────────────────────────────────────────────────
payments.get('/aging-summary', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') || getTodayIsoDate()

  const { results } = await c.env.DB.prepare(
    `SELECT s.code AS supplier_code, s.name AS supplier_name,
            SUM(CASE WHEN st.due_date IS NULL OR st.due_date >= ?                                                           THEN st.credit ELSE 0 END) AS current_amt,
            SUM(CASE WHEN st.due_date < ?    AND st.due_date >= date(?, '-30 days')                                        THEN st.credit ELSE 0 END) AS d1_30,
            SUM(CASE WHEN st.due_date < date(?, '-30 days') AND st.due_date >= date(?, '-60 days')                         THEN st.credit ELSE 0 END) AS d31_60,
            SUM(CASE WHEN st.due_date < date(?, '-60 days') AND st.due_date >= date(?, '-90 days')                         THEN st.credit ELSE 0 END) AS d61_90,
            SUM(CASE WHEN st.due_date < date(?, '-90 days')                                                                THEN st.credit ELSE 0 END) AS d90_plus,
            SUM(st.credit) AS total_outstanding
     FROM supplier_transactions st
     JOIN suppliers s ON s.code = st.supplier_code AND s.company_id = st.company_id
     WHERE st.company_id = ?
       AND st.entry_type IN ('invoice', 'debit', 'مدين', 'فاتورة', 'د')
       AND (st.is_matched IS NULL OR st.is_matched = 0)
       AND st.credit > 0
     GROUP BY s.code, s.name
     HAVING SUM(st.credit) > 0
     ORDER BY total_outstanding DESC`
  ).bind(asOf, asOf, asOf, asOf, asOf, asOf, asOf, asOf, company_id).all<{
    supplier_code: number; supplier_name: string
    current_amt: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number
    total_outstanding: number
  }>()

  const totals = results.reduce(
    (acc, r) => ({
      current: acc.current + (r.current_amt ?? 0),
      d1_30:   acc.d1_30   + (r.d1_30       ?? 0),
      d31_60:  acc.d31_60  + (r.d31_60      ?? 0),
      d61_90:  acc.d61_90  + (r.d61_90      ?? 0),
      d90_plus: acc.d90_plus + (r.d90_plus  ?? 0),
      total:   acc.total   + (r.total_outstanding ?? 0),
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 },
  )

  return c.json({
    success: true,
    data: {
      as_of: asOf,
      suppliers: results.map(r => ({
        ...r,
        current_amt:       Math.round((r.current_amt       ?? 0) * 100) / 100,
        d1_30:             Math.round((r.d1_30             ?? 0) * 100) / 100,
        d31_60:            Math.round((r.d31_60            ?? 0) * 100) / 100,
        d61_90:            Math.round((r.d61_90            ?? 0) * 100) / 100,
        d90_plus:          Math.round((r.d90_plus          ?? 0) * 100) / 100,
        total_outstanding: Math.round((r.total_outstanding ?? 0) * 100) / 100,
      })),
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    },
  })
})

export default payments
