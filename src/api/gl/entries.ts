import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'
import { FinanceCore } from '../../lib/finance_core'

const entries = new Hono<{ Bindings: Env }>()
entries.use('*', authMiddleware)
entries.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

// GET /api/gl/entries (with module-specific views support)
entries.get('/', async (c) => {
  const { company_id } = getUser(c)
  const page      = parsePositiveInt(c.req.query('page'), 1, 1, 100_000)
  const size      = parsePositiveInt(c.req.query('size'), 50, 1, 100)
  const offset    = (page - 1) * size
  const start     = c.req.query('start')
  const end       = c.req.query('end')
  const module    = c.req.query('module') // 'supplier' | 'inventory' | 'cash'
  const search    = c.req.query('search')

  // Determine source table/view based on module filter
  let sourceTable = 'journal_entries e'
  if (module === 'supplier') {
    sourceTable = 'vw_supplier_entries e'
  } else if (module === 'inventory') {
    sourceTable = 'vw_inventory_entries e'
  } else if (module === 'cash') {
    sourceTable = 'vw_cash_entries e'
  }

  let where = 'WHERE e.company_id = ?'
  const p: unknown[] = [company_id]
  if (start) { where += ' AND e.entry_date >= ?'; p.push(start) }
  if (end) { where += ' AND e.entry_date <= ?'; p.push(end) }

  if (search) {
    where += ' AND (e.description LIKE ? OR e.entry_number LIKE ? OR CAST(e.id AS TEXT) LIKE ?)'
    const s = `%${search}%`
    p.push(s, s, s)
  }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT e.*, fp.name AS period_name,
              (SELECT SUM(l.debit)  FROM journal_entry_lines l WHERE l.entry_id = e.id) AS total_debit,
              (SELECT SUM(l.credit) FROM journal_entry_lines l WHERE l.entry_id = e.id) AS total_credit,
              (SELECT rev.id FROM journal_entries rev
               WHERE rev.ref_type = 'reversal' AND rev.ref_id = e.id AND rev.company_id = e.company_id
               LIMIT 1) AS reversal_entry_id
       FROM ${sourceTable}
       LEFT JOIN financial_periods fp ON fp.id = e.period_id
       ${where}
       ORDER BY e.entry_date DESC, e.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...p, size, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${sourceTable} ${where}`)
      .bind(...p).first<{n:number}>(),
  ])

  const total = cnt?.n ?? 0
  return c.json({ success: true, data: rows.results, total, page, page_size: size, has_more: page * size < total })
})

// GET /api/gl/entries/:id
entries.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid entry id' }, 400)
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

// POST /api/gl/entries — BLOCKED
entries.post('/', async (c) => {
  return c.json({
    success: false,
    error: 'DIRECT_GL_WRITE_BLOCKED: الإدخال اليدوي المباشر للقيود تم تعطيله في وضع zero-legacy. استخدم مسارات أحداث الأعمال المعتمدة.',
  }, 410)
})

// GET /api/gl/entries/:id/trace
entries.get('/:id/trace', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid entry id' }, 400)
  const entry = await c.env.DB.prepare(
    `SELECT id, entry_number, entry_date, description, ref_type, ref_id,
            is_posted, posting_rule_trace, created_by, created_at
     FROM journal_entries WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first<{
    id: number; entry_number: string | null; entry_date: string
    description: string; ref_type: string; ref_id: number
    is_posted: number; posting_rule_trace: string | null
    created_by: number | null; created_at: string
  }>()
  if (!entry) return c.json({ success: false, error: 'القيد غير موجود' }, 404)

  let trace: unknown = null
  if (entry.posting_rule_trace) {
    try { trace = JSON.parse(entry.posting_rule_trace) } catch { trace = null }
  }

  const { results: lines } = await c.env.DB.prepare(
    `SELECT l.id, l.account_code, a.name AS account_name, a.account_type,
            l.debit, l.credit, l.description, l.rule_slot,
            l.center_code, l.season_id, l.field_id
     FROM journal_entry_lines l
     LEFT JOIN chart_of_accounts a ON a.code = l.account_code AND a.company_id = l.company_id
     WHERE l.entry_id = ? ORDER BY l.id`
  ).bind(id).all()

  let sourceEvent: unknown = null
  if (entry.ref_type === 'business_event' && entry.ref_id) {
    sourceEvent = await c.env.DB.prepare(
      `SELECT id, event_type, event_date, source_module, source_id, status, payload
       FROM business_events WHERE id = ? AND company_id = ?`
    ).bind(entry.ref_id, company_id).first()
  }

  let sourceDocument: unknown = null
  try {
    sourceDocument = await c.env.DB.prepare(
      `SELECT sd.id,
              sd.source_module,
              sd.source_id,
              sd.document_type,
              sd.event_id,
              sd.event_date,
              sd.status,
              sdl.link_type,
              sdl.journal_entry_id
       FROM source_document_links sdl
       JOIN source_documents sd
         ON sd.id = sdl.source_document_id
        AND sd.company_id = sdl.company_id
       WHERE sdl.company_id = ? AND sdl.journal_entry_id = ?
       ORDER BY sdl.id DESC
       LIMIT 1`
    ).bind(company_id, id).first()
  } catch (err) {
    // Ignore error if table doesn't exist
  }

  if (!sourceDocument && entry.ref_type === 'business_event' && entry.ref_id) {
    try {
      sourceDocument = await c.env.DB.prepare(
        `SELECT id, source_module, source_id, document_type, event_id, event_date, status
         FROM source_documents
         WHERE company_id = ? AND event_id = ?
         ORDER BY id DESC
         LIMIT 1`
      ).bind(company_id, entry.ref_id).first()
    } catch (err) {
      // Ignore error
    }
  }

  return c.json({
    success: true,
    data: {
      entry:        { ...entry, posting_rule_trace: undefined },
      lines,
      trace,
      source_event: sourceEvent,
      source_document: sourceDocument,
      has_trace:    trace !== null,
    },
  })
})

// POST /api/gl/entries/:id/reverse
entries.post('/:id/reverse', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid entry id' }, 400)
  const body = await c.req.json<{ reason: string }>().catch(() => ({ reason: '' }))

  const reason = String(body.reason ?? '').trim() || 'عكس قيد'

  const original = await c.env.DB.prepare(
    `SELECT id, entry_date, description, ref_type, ref_id, is_posted, period_id
     FROM journal_entries WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first<{
    id: number; entry_date: string; description: string
    ref_type: string; ref_id: number; is_posted: number; period_id: number
  }>()
  if (!original) return c.json({ success: false, error: 'القيد غير موجود' }, 404)
  if (!original.is_posted) return c.json({ success: false, error: 'لا يمكن عكس قيد غير مرحَّل' }, 400)

  const alreadyReversed = await c.env.DB.prepare(
    `SELECT id FROM journal_entries
     WHERE company_id = ? AND ref_type = 'reversal' AND ref_id = ? LIMIT 1`
  ).bind(company_id, id).first()
  if (alreadyReversed) {
    return c.json({ success: false, error: 'تم عكس هذا القيد مسبقاً' }, 409)
  }

  const today = new Date().toISOString().slice(0, 10)
  const periodId = await c.env.DB.prepare(
    `SELECT id FROM financial_periods
     WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND is_closed = 0
     ORDER BY start_date DESC LIMIT 1`
  ).bind(company_id, today, today).first<{ id: number }>()
  if (!periodId) {
    return c.json({ success: false, error: 'لا توجد فترة مالية مفتوحة لليوم' }, 400)
  }

  const { results: originalLines } = await c.env.DB.prepare(
    `SELECT account_code, debit, credit, description, center_code, season_id, field_id, rule_slot
     FROM journal_entry_lines WHERE entry_id = ? ORDER BY id`
  ).bind(id).all<{
    account_code: string; debit: number; credit: number
    description: string | null; center_code: number | null
    season_id: number | null; field_id: number | null; rule_slot: string | null
  }>()

  if (!originalLines.length) {
    return c.json({ success: false, error: 'القيد الأصلي لا يحتوي على سطور' }, 400)
  }

  const revLines = originalLines.map(l => ({
    account_code: l.account_code,
    debit:        l.credit,
    credit:       l.debit,
    description:  `عكس: ${l.description ?? ''}`.trim(),
    center_code:  l.center_code  ?? undefined,
    season_id:    l.season_id    ?? undefined,
    field_id:     l.field_id     ?? undefined,
    rule_slot:    l.rule_slot    ?? undefined,
  }))

  const totalDr = revLines.reduce((s, l) => s + l.debit, 0)
  const totalCr = revLines.reduce((s, l) => s + l.credit, 0)
  if (Math.abs(totalDr - totalCr) > 0.01) {
    return c.json({ success: false, error: 'INTERNAL: القيد المعكوس غير متوازن' }, 500)
  }

  try {
    const revEntryId = await FinanceCore.postManualReversal(c.env.DB, {
      company_id,
      original_entry_id: id,
      date: today,
      reason,
      lines: revLines,
      created_by: userId
    })

    void logAudit(c.env.DB, {
      user_id: userId, company_id, action: 'REVERSE',
      table_name: 'journal_entries', record_id: id,
      new_value: { reversal_entry_id: revEntryId, reason },
    })

    return c.json({
      success: true,
      data: {
        reversal_entry_id: revEntryId,
        reversed_entry_id: id,
        lines_count:       revLines.length,
        total_debit:       totalDr,
        total_credit:      totalCr,
      },
    }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: `فشل إنشاء قيد العكس: ${err.message}` }, 500)
  }
})

// POST /api/gl/manual-entries
entries.post('/manual-entries', roleGuard(['super_admin', 'company_admin', 'accountant']), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    entry_date:  string
    description: string
    lines: Array<{
      account_code: string
      debit:        number
      credit:       number
      description?: string
      center_code?: number
      season_id?:   number
      field_id?:    number
    }>
  }>()

  if (!body.entry_date || !body.description?.trim() || !Array.isArray(body.lines) || body.lines.length < 2) {
    return c.json({ success: false, error: 'التاريخ والوصف وسطرين على الأقل مطلوبة' }, 400)
  }

  const totalDr = body.lines.reduce((s, l) => s + (l.debit ?? 0), 0)
  const totalCr = body.lines.reduce((s, l) => s + (l.credit ?? 0), 0)
  if (Math.abs(totalDr - totalCr) > 0.01) {
    return c.json({
      success: false,
      error: `القيد غير متوازن: مدين=${totalDr.toFixed(2)} ، دائن=${totalCr.toFixed(2)}`,
    }, 400)
  }

  const errors: string[] = []
  for (const line of body.lines) {
    if (line.debit === 0 && line.credit === 0) {
      errors.push(`السطر (${line.account_code}) المبلغ صفر`)
      continue
    }
    if (line.debit > 0 && line.credit > 0) {
      errors.push(`السطر (${line.account_code}) لا يمكن أن يكون له مدين ودائن في نفس الوقت`)
    }
    const acct = await c.env.DB.prepare(
      'SELECT is_active, is_header FROM chart_of_accounts WHERE code = ? AND company_id = ?'
    ).bind(line.account_code, company_id).first<{ is_active: number; is_header: number }>()
    if (!acct) errors.push(`الحساب (${line.account_code}) غير موجود`)
    else if (!acct.is_active) errors.push(`الحساب (${line.account_code}) غير نشط`)
    else if (acct.is_header) errors.push(`الحساب (${line.account_code}) حساب إجمالي لا يُرحَّل مباشرة`)
  }
  if (errors.length) return c.json({ success: false, errors }, 422)

  const periodId = await c.env.DB.prepare(
    `SELECT id FROM financial_periods
     WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND is_closed = 0
     ORDER BY start_date DESC LIMIT 1`
  ).bind(company_id, body.entry_date, body.entry_date).first<{ id: number }>()
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${body.entry_date}` }, 400)
  }

  try {
    const entryId = await FinanceCore.postManualEntry(c.env.DB, {
      company_id,
      date: body.entry_date,
      description: body.description,
      lines: body.lines.map(l => ({
        account_code: l.account_code,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        description: l.description ?? body.description,
        center_code: l.center_code,
        season_id: l.season_id,
        field_id: l.field_id,
        rule_slot: 'manual_line'
      })),
      created_by: userId
    })

    void logAudit(c.env.DB, {
      user_id: userId, company_id, action: 'CREATE',
      table_name: 'journal_entries', record_id: entryId!,
      new_value: { type: 'manual_entry', entry_id: entryId, lines: body.lines.length },
    })

    return c.json({
      success: true,
      data: { entry_id: entryId, total_debit: totalDr, total_credit: totalCr },
    }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: `فشل إنشاء القيد اليدوي: ${err.message}` }, 500)
  }
})

export default entries
