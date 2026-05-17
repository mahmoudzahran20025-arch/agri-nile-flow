/**
 * suppliers/payments.ts
 * ======================
 * AP settlement and aging-summary endpoints.
 *
 * entry_type convention (stored in DB):
 *   'د' = debit = invoice (liability created, supplier owed)
 *   'م' = credit = payment (liability settled, cash paid out)
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, permissionGuard } from '../../middleware/auth'
import { getTodayIsoDate } from '../../lib/utils/date'

const payments = new Hono<{ Bindings: Env }>()
payments.use('*', authMiddleware)

// ── POST /:code/match-payment ─────────────────────────────────────────────────
// Links a payment row to an open invoice row, updating is_matched on both.
// Supports full and partial matching. Partial: payment marked matched,
// invoice stays open (is_matched=0) with matched_payment_id pointing to the
// payment for traceability.
payments.post('/:code/match-payment', permissionGuard('suppliers', 'write'), async (c) => {
  const { company_id } = getUser(c)
  const supplierCode = Number(c.req.param('code'))
  const body = await c.req.json<{
    payment_id: number
    invoice_id?: number
    allow_partial?: boolean
  }>()

  if (!body.payment_id) {
    return c.json({ success: false, error: 'payment_id مطلوب' }, 400)
  }

  const payment = await c.env.DB.prepare(
    `SELECT id, debit, amount, is_matched
     FROM supplier_transactions
     WHERE id = ? AND company_id = ? AND supplier_code = ? AND entry_type = 'م'`
  ).bind(body.payment_id, company_id, supplierCode)
   .first<{ id: number; debit: number; amount: number; is_matched: number | null }>()

  if (!payment) return c.json({ success: false, error: 'سند الدفع غير موجود' }, 404)
  if (payment.is_matched) return c.json({ success: false, error: 'سند الدفع مُقابَل بالفعل' }, 409)

  const paymentAmount = payment.debit || payment.amount

  // Auto-select oldest open invoice if none specified
  let invoiceId = body.invoice_id
  if (!invoiceId) {
    const oldest = await c.env.DB.prepare(
      `SELECT id FROM supplier_transactions
       WHERE company_id = ? AND supplier_code = ? AND entry_type = 'د'
         AND (is_matched IS NULL OR is_matched = 0) AND credit > 0
         AND status = 'posted'
       ORDER BY due_date ASC, transaction_date ASC, id ASC LIMIT 1`
    ).bind(company_id, supplierCode).first<{ id: number }>()
    if (!oldest) return c.json({ success: false, error: 'لا توجد فواتير مفتوحة للمطابقة' }, 404)
    invoiceId = oldest.id
  }

  const invoice = await c.env.DB.prepare(
    `SELECT id, credit, amount, is_matched, due_date, transaction_date
     FROM supplier_transactions
     WHERE id = ? AND company_id = ? AND supplier_code = ? AND entry_type = 'د'`
  ).bind(invoiceId, company_id, supplierCode)
   .first<{ id: number; credit: number; amount: number; is_matched: number | null; due_date: string | null; transaction_date: string }>()

  if (!invoice) return c.json({ success: false, error: 'الفاتورة غير موجودة' }, 404)
  if (invoice.is_matched) return c.json({ success: false, error: 'الفاتورة مُقابَلة بالفعل' }, 409)

  const invoiceAmount = invoice.credit || invoice.amount

  if (paymentAmount < invoiceAmount && !body.allow_partial) {
    return c.json({
      success: false,
      error: 'مبلغ الدفع أقل من قيمة الفاتورة. هل تريد مطابقة جزئية؟',
      shortfall: invoiceAmount - paymentAmount,
      code: 'PARTIAL_MATCH_REQUIRED',
    }, 422)
  }

  const isFullMatch = paymentAmount >= invoiceAmount

  if (isFullMatch) {
    // Both sides fully matched
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE supplier_transactions
         SET is_matched = 1, matched_payment_id = ?
         WHERE id = ? AND company_id = ?`
      ).bind(body.payment_id, invoiceId, company_id),
      c.env.DB.prepare(
        `UPDATE supplier_transactions SET is_matched = 1
         WHERE id = ? AND company_id = ?`
      ).bind(body.payment_id, company_id),
    ])
  } else {
    // Partial: payment fully consumed, invoice partially covered
    // Link invoice → payment so partial coverage is traceable
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE supplier_transactions SET is_matched = 1
         WHERE id = ? AND company_id = ?`
      ).bind(body.payment_id, company_id),
      c.env.DB.prepare(
        `UPDATE supplier_transactions SET matched_payment_id = ?
         WHERE id = ? AND company_id = ?`
      ).bind(body.payment_id, invoiceId, company_id),
    ])
  }

  return c.json({
    success: true,
    data: {
      match_type: isFullMatch ? 'full' : 'partial',
      remaining_on_invoice: isFullMatch ? 0 : invoiceAmount - paymentAmount,
    },
  })
})

// ── POST /:code/unmatch-payment ───────────────────────────────────────────────
// Reverses a match — opens the invoice and the linked payment back.
payments.post('/:code/unmatch-payment', permissionGuard('suppliers', 'write'), async (c) => {
  const { company_id } = getUser(c)
  const supplierCode = Number(c.req.param('code'))
  const body = await c.req.json<{ invoice_id: number }>()

  if (!body.invoice_id) {
    return c.json({ success: false, error: 'invoice_id مطلوب' }, 400)
  }

  const invoice = await c.env.DB.prepare(
    `SELECT id, is_matched, matched_payment_id
     FROM supplier_transactions
     WHERE id = ? AND company_id = ? AND supplier_code = ? AND entry_type = 'د'`
  ).bind(body.invoice_id, company_id, supplierCode)
   .first<{ id: number; is_matched: number | null; matched_payment_id: number | null }>()

  if (!invoice) return c.json({ success: false, error: 'الفاتورة غير موجودة' }, 404)
  if (!invoice.is_matched && !invoice.matched_payment_id) {
    return c.json({ success: false, error: 'الفاتورة غير مقابَلة أصلاً' }, 409)
  }

  const stmts = [
    c.env.DB.prepare(
      `UPDATE supplier_transactions
       SET is_matched = 0, matched_payment_id = NULL
       WHERE id = ? AND company_id = ?`
    ).bind(body.invoice_id, company_id),
  ]

  if (invoice.matched_payment_id) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE supplier_transactions SET is_matched = 0
         WHERE id = ? AND company_id = ? AND supplier_code = ?`
      ).bind(invoice.matched_payment_id, company_id, supplierCode)
    )
  }

  await c.env.DB.batch(stmts)

  return c.json({ success: true })
})

// ── GET /aging-summary ────────────────────────────────────────────────────────
// Row-level AP aging — one row per open invoice.
// Fulfills the frontend APAgingRow[] contract used by APAgingPage.
payments.get('/aging-summary', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const today = getTodayIsoDate()

  const { results } = await c.env.DB.prepare(`
    SELECT
      st.id,
      st.document_number                                    AS invoice_number,
      st.transaction_date                                   AS invoice_date,
      st.supplier_code,
      s.name                                                AS supplier_name,
      st.due_date,
      st.credit                                             AS total_amount,
      COALESCE((
        SELECT SUM(p.debit)
        FROM supplier_transactions p
        WHERE p.matched_payment_id = st.id
          AND p.company_id = st.company_id
          AND p.entry_type = 'م'
          AND p.status = 'posted'
      ), 0)                                                 AS paid_amount,
      st.credit - COALESCE((
        SELECT SUM(p.debit)
        FROM supplier_transactions p
        WHERE p.matched_payment_id = st.id
          AND p.company_id = st.company_id
          AND p.entry_type = 'م'
          AND p.status = 'posted'
      ), 0)                                                 AS outstanding,
      COALESCE(CAST(
        julianday(?) - julianday(COALESCE(st.due_date, st.transaction_date))
      AS INTEGER), 0)                                       AS days_overdue,
      COALESCE(st.due_date_estimated, 0)                    AS due_date_estimated
    FROM supplier_transactions st
    LEFT JOIN suppliers s
      ON s.code = st.supplier_code AND s.company_id = st.company_id
    WHERE st.company_id = ?
      AND st.entry_type = 'د'
      AND (st.is_matched IS NULL OR st.is_matched = 0)
      AND st.status = 'posted'
    ORDER BY st.due_date ASC, st.transaction_date ASC
  `).bind(today, company_id).all()

  return c.json({ success: true, data: results })
})

// ── GET /ap-aging ─────────────────────────────────────────────────────────────
// Bucketed AP aging: current / 1-30 / 31-60 / 61-90 / 90+ days overdue.
// Returns per-supplier rows + company-level totals.
// Query param: supplier_code (optional, filter to one supplier)
payments.get('/ap-aging', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const today = getTodayIsoDate()
  const supplierCodeFilter = c.req.query('supplier_code')
    ? Number(c.req.query('supplier_code'))
    : null

  let whereExtra = ''
  const binds: unknown[] = [today, today, today, today, today, company_id]
  if (supplierCodeFilter) {
    whereExtra = ' AND st.supplier_code = ?'
    binds.push(supplierCodeFilter)
  }

  // Each open invoice bucketed by days overdue.
  // outstanding = invoice credit minus all matched payments against it.
  const { results } = await c.env.DB.prepare(`
    SELECT
      st.supplier_code,
      s.name                                                        AS supplier_name,
      COUNT(*)                                                      AS invoice_count,
      COALESCE(SUM(
        st.credit - COALESCE((
          SELECT SUM(p.debit)
          FROM supplier_transactions p
          WHERE p.matched_payment_id = st.id
            AND p.company_id = st.company_id
            AND p.entry_type = 'م'
            AND p.status = 'posted'
        ), 0)
      ), 0)                                                         AS total_outstanding,
      COALESCE(SUM(CASE
        WHEN julianday(?) - julianday(COALESCE(st.due_date, st.transaction_date)) <= 0
        THEN st.credit - COALESCE((
          SELECT SUM(p.debit) FROM supplier_transactions p
          WHERE p.matched_payment_id = st.id AND p.company_id = st.company_id
            AND p.entry_type = 'م' AND p.status = 'posted'
        ), 0) ELSE 0 END
      ), 0)                                                         AS bucket_current,
      COALESCE(SUM(CASE
        WHEN julianday(?) - julianday(COALESCE(st.due_date, st.transaction_date)) BETWEEN 1 AND 30
        THEN st.credit - COALESCE((
          SELECT SUM(p.debit) FROM supplier_transactions p
          WHERE p.matched_payment_id = st.id AND p.company_id = st.company_id
            AND p.entry_type = 'م' AND p.status = 'posted'
        ), 0) ELSE 0 END
      ), 0)                                                         AS bucket_1_30,
      COALESCE(SUM(CASE
        WHEN julianday(?) - julianday(COALESCE(st.due_date, st.transaction_date)) BETWEEN 31 AND 60
        THEN st.credit - COALESCE((
          SELECT SUM(p.debit) FROM supplier_transactions p
          WHERE p.matched_payment_id = st.id AND p.company_id = st.company_id
            AND p.entry_type = 'م' AND p.status = 'posted'
        ), 0) ELSE 0 END
      ), 0)                                                         AS bucket_31_60,
      COALESCE(SUM(CASE
        WHEN julianday(?) - julianday(COALESCE(st.due_date, st.transaction_date)) BETWEEN 61 AND 90
        THEN st.credit - COALESCE((
          SELECT SUM(p.debit) FROM supplier_transactions p
          WHERE p.matched_payment_id = st.id AND p.company_id = st.company_id
            AND p.entry_type = 'م' AND p.status = 'posted'
        ), 0) ELSE 0 END
      ), 0)                                                         AS bucket_61_90,
      COALESCE(SUM(CASE
        WHEN julianday(?) - julianday(COALESCE(st.due_date, st.transaction_date)) > 90
        THEN st.credit - COALESCE((
          SELECT SUM(p.debit) FROM supplier_transactions p
          WHERE p.matched_payment_id = st.id AND p.company_id = st.company_id
            AND p.entry_type = 'م' AND p.status = 'posted'
        ), 0) ELSE 0 END
      ), 0)                                                         AS bucket_90_plus
    FROM supplier_transactions st
    LEFT JOIN suppliers s
      ON s.code = st.supplier_code AND s.company_id = st.company_id
    WHERE st.company_id = ?
      AND st.entry_type = 'د'
      AND (st.is_matched IS NULL OR st.is_matched = 0)
      AND st.status = 'posted'
      ${whereExtra}
    GROUP BY st.supplier_code, s.name
    ORDER BY total_outstanding DESC
  `).bind(...binds).all<{
    supplier_code: number
    supplier_name: string | null
    invoice_count: number
    total_outstanding: number
    bucket_current: number
    bucket_1_30: number
    bucket_31_60: number
    bucket_61_90: number
    bucket_90_plus: number
  }>()

  const totals = results.reduce((acc, r) => ({
    invoice_count:     acc.invoice_count     + r.invoice_count,
    total_outstanding: acc.total_outstanding + r.total_outstanding,
    bucket_current:    acc.bucket_current    + r.bucket_current,
    bucket_1_30:       acc.bucket_1_30       + r.bucket_1_30,
    bucket_31_60:      acc.bucket_31_60      + r.bucket_31_60,
    bucket_61_90:      acc.bucket_61_90      + r.bucket_61_90,
    bucket_90_plus:    acc.bucket_90_plus    + r.bucket_90_plus,
  }), {
    invoice_count: 0, total_outstanding: 0,
    bucket_current: 0, bucket_1_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0,
  })

  return c.json({
    success: true,
    data: {
      as_of_date: today,
      supplier_count: results.length,
      totals,
      suppliers: results,
    },
  })
})

export default payments
