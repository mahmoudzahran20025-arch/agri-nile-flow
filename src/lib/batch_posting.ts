import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

export type BatchPostJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface BatchPostItemInput {
  source_id: number
  payload?: Record<string, unknown>
}

export interface EnqueueBatchPostJobOpts {
  company_id: number
  event_type: string
  source_module: string
  priority?: number
  payload?: Record<string, unknown>
  created_by?: number
  items: BatchPostItemInput[]
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
     (company_id, event_type, source_module, status, priority, total_items, payload, created_by)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).bind(
    opts.company_id,
    opts.event_type,
    opts.source_module,
    opts.priority ?? 100,
    totalItems,
    opts.payload ? JSON.stringify(opts.payload) : null,
    opts.created_by ?? null,
  ).run()

  const jobId = Number(header.meta.last_row_id)
  const itemStmts: D1PreparedStatement[] = opts.items.map((it) => (
    db.prepare(
      `INSERT INTO batch_post_job_items
       (job_id, company_id, source_id, payload, status, attempts)
       VALUES (?, ?, ?, ?, 'pending', 0)`
    ).bind(jobId, opts.company_id, it.source_id, it.payload ? JSON.stringify(it.payload) : null)
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
  status?: BatchPostJobStatus,
) {
  const safePage = Math.max(1, page)
  const safeSize = Math.min(200, Math.max(1, size))
  const offset = (safePage - 1) * safeSize

  let where = 'WHERE company_id = ?'
  const binds: unknown[] = [company_id]

  if (status) {
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
): Promise<(BatchPostJobRow & { items: unknown[] }) | null> {
  const job = await db.prepare(
    `SELECT id, company_id, event_type, source_module, status, priority,
            total_items, processed_items, failed_items, retry_count,
            payload, last_error, created_by, created_at, started_at, completed_at
     FROM batch_post_jobs
     WHERE id = ? AND company_id = ?`
  ).bind(job_id, company_id).first<BatchPostJobRow>()

  if (!job) return null

  const items = await db.prepare(
    `SELECT id, source_id, status, attempts, journal_entry_id, error_message, created_at, processed_at
     FROM batch_post_job_items
     WHERE job_id = ? AND company_id = ?
     ORDER BY id ASC`
  ).bind(job_id, company_id).all()

  return { ...job, items: items.results }
}

export async function updateBatchPostJobStatus(
  db: D1Database,
  company_id: number,
  job_id: number,
  status: BatchPostJobStatus,
  last_error?: string | null,
): Promise<void> {
  await db.prepare(
    `UPDATE batch_post_jobs
     SET status = ?,
         last_error = ?,
         started_at = CASE WHEN ? = 'processing' THEN COALESCE(started_at, datetime('now')) ELSE started_at END,
         completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN datetime('now') ELSE completed_at END
     WHERE id = ? AND company_id = ?`
  ).bind(status, last_error ?? null, status, status, job_id, company_id).run()
}

export async function claimNextBatchPostJob(
  db: D1Database,
  company_id: number,
): Promise<number | null> {
  const next = await db.prepare(
    `SELECT id
     FROM batch_post_jobs
     WHERE company_id = ? AND status = 'pending'
     ORDER BY priority ASC, id ASC
     LIMIT 1`
  ).bind(company_id).first<{ id: number }>()

  if (!next?.id) return null

  await updateBatchPostJobStatus(db, company_id, next.id, 'processing', null)
  return next.id
}
