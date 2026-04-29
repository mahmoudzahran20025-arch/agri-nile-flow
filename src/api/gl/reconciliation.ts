import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'

const reconciliation = new Hono<{ Bindings: Env }>()
reconciliation.use('*', authMiddleware)
reconciliation.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// GET /api/gl/reconciliation/source-documents
reconciliation.get('/source-documents', async (c) => {
  const { company_id } = getUser(c)
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const size = Math.min(200, Math.max(1, Number(c.req.query('size') ?? 50)))
  const offset = (page - 1) * size
  const sourceModule = c.req.query('source_module')
  const status = c.req.query('status')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const mismatchOnly = c.req.query('mismatch_only') === '1'

  let where = 'WHERE sd.company_id = ?'
  const binds: unknown[] = [company_id]

  if (sourceModule) { where += ' AND sd.source_module = ?'; binds.push(sourceModule) }
  if (status) { where += ' AND sd.status = ?'; binds.push(status) }
  if (from) { where += ' AND sd.event_date >= ?'; binds.push(from) }
  if (to) { where += ' AND sd.event_date <= ?'; binds.push(to) }

  const mismatchClause = `(
    be.id IS NULL OR
    sdl.journal_entry_id IS NULL OR
    (be.journal_entry_id IS NOT NULL AND sdl.journal_entry_id IS NOT NULL AND be.journal_entry_id != sdl.journal_entry_id) OR
    (sd.status = 'posted' AND sdl.journal_entry_id IS NULL)
  )`
  if (mismatchOnly) where += ` AND ${mismatchClause}`

  const [rows, countRow, summaryRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT sd.id,
              sd.source_module,
              sd.source_id,
              sd.document_type,
              sd.event_id,
              sd.event_date,
              sd.status AS source_document_status,
              be.status AS business_event_status,
              be.journal_entry_id AS business_event_journal_entry_id,
              sdl.journal_entry_id AS linked_journal_entry_id,
              je.entry_date AS linked_entry_date,
              je.description AS linked_entry_description,
              CASE WHEN be.id IS NULL THEN 0 ELSE 1 END AS has_business_event,
              CASE WHEN sdl.journal_entry_id IS NULL THEN 0 ELSE 1 END AS has_journal_link,
              CASE
                WHEN be.id IS NULL THEN 'missing_business_event'
                WHEN sdl.journal_entry_id IS NULL THEN 'missing_journal_link'
                WHEN be.journal_entry_id IS NOT NULL AND sdl.journal_entry_id IS NOT NULL AND be.journal_entry_id != sdl.journal_entry_id THEN 'event_link_mismatch'
                WHEN sd.status = 'posted' AND sdl.journal_entry_id IS NULL THEN 'posted_without_journal'
                ELSE 'ok'
              END AS reconciliation_status
       FROM source_documents sd
       LEFT JOIN business_events be
         ON be.id = sd.event_id
        AND be.company_id = sd.company_id
       LEFT JOIN source_document_links sdl
         ON sdl.source_document_id = sd.id
        AND sdl.company_id = sd.company_id
        AND sdl.link_type = 'primary'
       LEFT JOIN journal_entries je
         ON je.id = sdl.journal_entry_id
        AND je.company_id = sd.company_id
       ${where}
       ORDER BY sd.event_date DESC, sd.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),

    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM source_documents sd ${where}`)
      .bind(...binds).first<{ n: number }>(),

    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN be.id IS NULL THEN 1 ELSE 0 END) AS missing_business_event,
         SUM(CASE WHEN sdl.journal_entry_id IS NULL THEN 1 ELSE 0 END) AS missing_journal_link,
         SUM(CASE WHEN be.journal_entry_id IS NOT NULL AND sdl.journal_entry_id IS NOT NULL AND be.journal_entry_id != sdl.journal_entry_id THEN 1 ELSE 0 END) AS event_link_mismatch,
         SUM(CASE WHEN sd.status = 'posted' AND sdl.journal_entry_id IS NULL THEN 1 ELSE 0 END) AS posted_without_journal,
         SUM(CASE WHEN be.id IS NOT NULL AND sdl.journal_entry_id IS NOT NULL AND (be.journal_entry_id IS NULL OR be.journal_entry_id = sdl.journal_entry_id) THEN 1 ELSE 0 END) AS fully_linked
       FROM source_documents sd
       LEFT JOIN business_events be
         ON be.id = sd.event_id
        AND be.company_id = sd.company_id
       LEFT JOIN source_document_links sdl
         ON sdl.source_document_id = sd.id
        AND sdl.company_id = sd.company_id
        AND sdl.link_type = 'primary'
       ${where}`
    ).bind(...binds).first<{
      total: number
      missing_business_event: number
      missing_journal_link: number
      event_link_mismatch: number
      posted_without_journal: number
      fully_linked: number
    }>(),
  ])

  return c.json({
    success: true,
    data: rows.results,
    total: countRow?.n ?? 0,
    page,
    page_size: size,
    summary: summaryRow ?? {
      total: 0,
      missing_business_event: 0,
      missing_journal_link: 0,
      event_link_mismatch: 0,
      posted_without_journal: 0,
      fully_linked: 0,
    },
  })
})

export default reconciliation
