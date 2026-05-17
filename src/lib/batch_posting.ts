import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

export type BatchPostJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface BatchPostItemInput {
  source_id: number
  payload?: string | Record<string, unknown>
}

export interface EnqueueBatchPostJobOpts {
  company_id: number
  event_type: string
  source_module?: string
  priority?: number
  payload?: Record<string, unknown>
  created_by?: number
  items: BatchPostItemInput[]
  notes?: string
}

export async function enqueueBatchPostJob(
  db: D1Database,
  opts: EnqueueBatchPostJobOpts,
): Promise<number> {
  if (!opts.items.length) {
    throw new Error('BATCH_JOB_EMPTY: at least one item is required')
  }

  const totalItems = opts.items.length
  const header = await db.prepare(
    `INSERT INTO batch_post_jobs
     (company_id, event_type, source_module, status, priority, total_items, payload, created_by, notes)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
  ).bind(
    opts.company_id,
    opts.event_type,
    opts.source_module ?? 'manual',
    opts.priority ?? 100,
    totalItems,
    opts.payload ? JSON.stringify(opts.payload) : null,
    opts.created_by ?? null,
    opts.notes ?? null,
  ).run()

  const jobId = Number(header.meta.last_row_id)
  const itemStmts: D1PreparedStatement[] = opts.items.map((it) => (
    db.prepare(
      `INSERT INTO batch_post_job_items
       (job_id, company_id, source_id, payload, status, attempts)
       VALUES (?, ?, ?, ?, 'pending', 0)`
    ).bind(jobId, opts.company_id, it.source_id, typeof it.payload === 'string' ? it.payload : JSON.stringify(it.payload ?? {}))
  ))

  if (itemStmts.length > 0) {
    await db.batch(itemStmts)
  }

  return jobId
}

export async function listBatchPostJobs(
  db: D1Database,
  company_id: number,
  page = 1,
  size = 50,
  status?: string,
) {
  const safePage = Math.max(1, page)
  const safeSize = Math.min(200, Math.max(1, size))
  const offset = (safePage - 1) * safeSize

  let where = 'WHERE company_id = ?'
  const binds: unknown[] = [company_id]

  if (status && status !== 'all') {
    where += ' AND status = ?'
    binds.push(status)
  }

  const [rows, total] = await Promise.all([
    db.prepare(
      `SELECT id, company_id, event_type, source_module, status, priority,
              total_items, processed_items, failed_items, retry_count,
              last_error, created_by, created_at, started_at, completed_at
       FROM batch_post_jobs
       ${where}
       ORDER BY priority ASC, id DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, safeSize, offset).all(),
    db.prepare(`SELECT COUNT(*) AS n FROM batch_post_jobs ${where}`)
      .bind(...binds).first<{ n: number }>(),
  ])

  return {
    data: rows.results,
    total: total?.n ?? 0,
    page: safePage,
    page_size: safeSize,
  }
}

// ALIAS for API
export const getPendingBatchPostJobs = listBatchPostJobs

export interface BatchPostJobRow {
  id: number
  company_id: number
  event_type: string
  source_module: string
  status: BatchPostJobStatus
  priority: number
  total_items: number
  processed_items: number
  failed_items: number
  retry_count: number
  payload: string | null
  last_error: string | null
  created_by: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export async function getBatchPostJob(
  db: D1Database,
  company_id: number,
  job_id: number,
): Promise<(BatchPostJobRow & { items: any[] }) | null> {
  const job = await db.prepare(
    `SELECT * FROM batch_post_jobs
     WHERE id = ? AND company_id = ?`
  ).bind(job_id, company_id).first<BatchPostJobRow>()

  if (!job) return null

  const items = await db.prepare(
    `SELECT * FROM batch_post_job_items
     WHERE job_id = ? AND company_id = ?
     ORDER BY id ASC`
  ).bind(job_id, company_id).all()

  return { ...job, items: items.results }
}

// ALIAS for API
export const getBatchPostJobStatus = getBatchPostJob

export async function updateBatchPostJobStatus(
  db: D1Database,
  job_id: number,
  status: string,
  company_id?: number,
  last_error?: string | null,
): Promise<void> {
  let where = 'WHERE id = ?'
  const binds: any[] = [status, last_error ?? null, status, status, job_id]
  if (company_id) {
    where += ' AND company_id = ?'
    binds.push(company_id)
  }

  await db.prepare(
    `UPDATE batch_post_jobs
     SET status = ?,
         last_error = ?,
         started_at = CASE WHEN ? = 'processing' THEN COALESCE(started_at, datetime('now')) ELSE started_at END,
         completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN datetime('now') ELSE completed_at END
     ${where}`
  ).bind(...binds).run()
}

export async function updateBatchPostJobItem(
  db: D1Database,
  item_id: number,
  updates: { status: string; journal_entry_id?: number; error_message?: string },
): Promise<void> {
  await db.prepare(
    `UPDATE batch_post_job_items
     SET status = ?,
         journal_entry_id = COALESCE(?, journal_entry_id),
         error_message = COALESCE(?, error_message),
         processed_at = datetime('now')
     WHERE id = ?`
  ).bind(updates.status, updates.journal_entry_id ?? null, updates.error_message ?? null, item_id).run()
}

export async function claimNextBatchPostJob(
  db: D1Database,
  job_id?: number,
  company_id?: number,
): Promise<any | null> {
  let row: any
  if (job_id) {
    row = await db.prepare('SELECT * FROM batch_post_jobs WHERE id = ? AND (company_id = ? OR ? IS NULL)').bind(job_id, company_id ?? null, company_id ?? null).first()
  } else {
    row = await db.prepare('SELECT * FROM batch_post_jobs WHERE status = \'pending\' AND (company_id = ? OR ? IS NULL) ORDER BY priority ASC, id ASC LIMIT 1').bind(company_id ?? null, company_id ?? null).first()
  }

  if (!row) return null

  await updateBatchPostJobStatus(db, row.id, 'processing', row.company_id)
  return row
}
