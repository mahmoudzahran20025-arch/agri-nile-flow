/**
 * src/api/gl/exchange-rates.ts
 *
 * Phase 2: Multi-Currency — Exchange Rates Endpoints
 *
 * Endpoints:
 *   GET  /api/gl/exchange-rates            — list active rates for company
 *   POST /api/gl/exchange-rates            — create/update a rate (company_admin+)
 *   GET  /api/gl/exchange-rates/convert    — convert amount between currencies
 *   GET  /api/gl/exchange-rates/:id        — get single rate
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { getTodayIsoDate } from '../../lib/utils/date'
import { logAudit } from '../../lib/audit'

const exchangeRates = new Hono<{ Bindings: Env }>()

exchangeRates.use('*', authMiddleware)
exchangeRates.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// ── GET /api/gl/exchange-rates ────────────────────────────────────────────────
// List all active exchange rates for this company (optionally filter by date)
exchangeRates.get('/', async (c) => {
  const { company_id } = getUser(c)
  const date         = c.req.query('date')   // YYYY-MM-DD filter, default today
  const from         = c.req.query('from')   // filter by from_currency
  const effectiveOn  = date ?? getTodayIsoDate()

  let query = `
    SELECT er.*
    FROM exchange_rates er
    WHERE er.company_id = ?
      AND er.effective_date <= ?
  `
  const params: (string | number)[] = [company_id, effectiveOn]

  if (from) {
    query += ' AND er.from_currency = ?'
    params.push(from.toUpperCase())
  }

  // Return the most recent rate for each (from_currency, to_currency) pair
  const fullQuery = `
    SELECT er.*
    FROM exchange_rates er
    INNER JOIN (
      SELECT from_currency, to_currency, MAX(effective_date) as max_date
      FROM exchange_rates
      WHERE company_id = ? AND effective_date <= ?
      ${from ? 'AND from_currency = ?' : ''}
      GROUP BY from_currency, to_currency
    ) latest
      ON er.from_currency = latest.from_currency
     AND er.to_currency   = latest.to_currency
     AND er.effective_date = latest.max_date
    WHERE er.company_id = ?
    ORDER BY er.from_currency ASC
  `

  const bindParams: (string | number)[] = from
    ? [company_id, effectiveOn, from.toUpperCase(), company_id]
    : [company_id, effectiveOn, company_id]

  const { results } = await c.env.DB.prepare(fullQuery).bind(...bindParams).all()

  return c.json({
    success: true,
    data: results,
    meta: { effective_on: effectiveOn, count: results.length },
  })
})

// ── GET /api/gl/exchange-rates/convert ───────────────────────────────────────
// Real-time conversion: ?from=USD&to=EGP&amount=100
// MUST be registered before /:id to avoid routing conflict
exchangeRates.get('/convert', async (c) => {
  const { company_id } = getUser(c)
  const from   = (c.req.query('from')   ?? '').toUpperCase()
  const to     = (c.req.query('to')     ?? '').toUpperCase()
  const amount = parseFloat(c.req.query('amount') ?? '0')
  const date   = c.req.query('date') ?? getTodayIsoDate()

  if (!from || !to)   return c.json({ success: false, error: 'من فضلك حدد العملة المصدر والهدف' }, 400)
  if (isNaN(amount))  return c.json({ success: false, error: 'المبلغ غير صحيح' }, 400)

  // Same currency — no conversion needed
  if (from === to) {
    return c.json({ success: true, data: { from, to, amount, converted: amount, rate: 1 } })
  }

  // Look up most recent rate on or before the requested date
  const row = await c.env.DB
    .prepare(`
      SELECT rate, effective_date, source
      FROM exchange_rates
      WHERE company_id = ? AND from_currency = ? AND to_currency = ?
        AND effective_date <= ?
      ORDER BY effective_date DESC
      LIMIT 1
    `)
    .bind(company_id, from, to, date)
    .first<{ rate: number; effective_date: string; source: string }>()

  if (!row) {
    return c.json({
      success: false,
      error: `لا يوجد سعر صرف للعملة ${from} إلى ${to} بتاريخ ${date}`,
    }, 404)
  }

  const converted = parseFloat((amount * row.rate).toFixed(6))

  return c.json({
    success: true,
    data: {
      from,
      to,
      amount,
      converted,
      rate: row.rate,
      effective_date: row.effective_date,
      source: row.source,
    },
  })
})

// ── GET /api/gl/exchange-rates/:id ───────────────────────────────────────────
exchangeRates.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = parseInt(c.req.param('id'))

  if (isNaN(id)) return c.json({ success: false, error: 'معرف غير صحيح' }, 400)

  const row = await c.env.DB
    .prepare('SELECT * FROM exchange_rates WHERE id = ? AND company_id = ?')
    .bind(id, company_id)
    .first()

  if (!row) return c.json({ success: false, error: 'سعر الصرف غير موجود' }, 404)

  return c.json({ success: true, data: row })
})

// ── POST /api/gl/exchange-rates ───────────────────────────────────────────────
// Create or update (upsert by from+to+date) an exchange rate
exchangeRates.post('/', roleGuard(['super_admin', 'company_admin']), async (c) => {
  const { sub: user_id, company_id } = getUser(c)

  let body: {
    from_currency: string
    to_currency:   string
    rate:          number
    effective_date?: string
    source?:       string
  }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ success: false, error: 'بيانات JSON غير صحيحة' }, 400)
  }

  const { from_currency, to_currency, rate, effective_date, source } = body

  if (!from_currency || !to_currency) {
    return c.json({ success: false, error: 'العملة المصدر والهدف مطلوبان' }, 400)
  }
  if (typeof rate !== 'number' || rate <= 0) {
    return c.json({ success: false, error: 'سعر الصرف يجب أن يكون رقماً موجباً' }, 400)
  }

  const from  = from_currency.toUpperCase()
  const to    = to_currency.toUpperCase()
  const eDate = effective_date ?? getTodayIsoDate()
  const src   = source ?? 'manual'

  // Check if rate already exists for this date — if yes, update it
  const existing = await c.env.DB
    .prepare(`
      SELECT id FROM exchange_rates
      WHERE company_id = ? AND from_currency = ? AND to_currency = ? AND effective_date = ?
    `)
    .bind(company_id, from, to, eDate)
    .first<{ id: number }>()

  if (existing) {
    await c.env.DB
      .prepare(`
        UPDATE exchange_rates
        SET rate = ?, source = ?, created_by = ?
        WHERE id = ?
      `)
      .bind(rate, src, user_id, existing.id)
      .run()

    await logAudit(c.env.DB, {
      user_id,
      company_id,
      action:      'UPDATE',
      table_name:  'exchange_rates',
      record_id:   existing.id,
      new_value:   { from, to, rate, effective_date: eDate },
    })

    return c.json({
      success: true,
      data: { id: existing.id, from, to, rate, effective_date: eDate, updated: true },
    })
  }

  // Insert new rate
  const result = await c.env.DB
    .prepare(`
      INSERT INTO exchange_rates (company_id, from_currency, to_currency, rate, effective_date, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(company_id, from, to, rate, eDate, src, user_id)
    .run()

  const newId = result.meta?.last_row_id

  await logAudit(c.env.DB, {
    user_id,
    company_id,
    action:     'CREATE',
    table_name: 'exchange_rates',
    record_id:  newId as number,
    new_value:  { from, to, rate, effective_date: eDate },
  })

  return c.json({
    success: true,
    data: { id: newId, from, to, rate, effective_date: eDate, updated: false },
  }, 201)
})

export default exchangeRates
