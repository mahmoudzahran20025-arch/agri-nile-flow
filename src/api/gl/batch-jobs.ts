import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { getTodayIsoDate } from '../../lib/utils/date'
import { logAudit } from '../../lib/audit'
import { FinanceCore } from '../../lib/finance_core'
import {
  claimNextBatchPostJob,
  enqueueBatchPostJob,
  getBatchPostJob,
  listBatchPostJobs,
  updateBatchPostJobStatus,
} from '../../lib/batch_posting'

const batchJobs = new Hono<{ Bindings: Env }>()
batchJobs.use('*', authMiddleware)
batchJobs.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// POST /api/gl/batch-post/jobs
batchJobs.post('/batch-post/jobs', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    event_type: string
    source_module: string
    priority?: number
    payload?: Record<string, unknown>
    items: Array<{ source_id: number; payload?: Record<string, unknown> }>
  }>()

  if (!body.event_type?.trim() || !body.source_module?.trim()) {
    return c.json({ success: false, error: 'event_type and source_module are required' }, 400)
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ success: false, error: 'At least one batch item is required' }, 400)
  }
  if (body.items.length > 2000) {
    return c.json({ success: false, error: 'Batch size too large (max 2000 items)' }, 400)
  }

  const jobId = await enqueueBatchPostJob(c.env.DB, {
    company_id,
    event_type: body.event_type.trim(),
    source_module: body.source_module.trim(),
    priority: body.priority ?? 100,
    payload: body.payload,
    created_by: userId,
    items: body.items,
  })

  void logAudit(c.env.DB, {
    user_id: userId,
    company_id,
    action: 'CREATE',
    table_name: 'batch_post_jobs',
    record_id: jobId,
    new_value: { event_type: body.event_type, source_module: body.source_module, items: body.items.length },
  })

  return c.json({ success: true, data: { job_id: jobId } }, 201)
})

// GET /api/gl/batch-post/jobs
batchJobs.get('/batch-post/jobs', async (c) => {
  const { company_id } = getUser(c)
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const size = Math.min(200, Math.max(1, Number(c.req.query('size') ?? 50)))
  const statusQ = c.req.query('status') as 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | undefined

  const data = await listBatchPostJobs(c.env.DB, company_id, page, size, statusQ)
  return c.json({ success: true, ...data })
})

// GET /api/gl/batch-post/jobs/:id
batchJobs.get('/batch-post/jobs/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid job id' }, 400)

  const job = await getBatchPostJob(c.env.DB, company_id, id)
  if (!job) return c.json({ success: false, error: 'Batch job not found' }, 404)
  return c.json({ success: true, data: job })
})

// PATCH /api/gl/batch-post/jobs/:id/status
batchJobs.patch('/batch-post/jobs/:id/status', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'; last_error?: string | null }>()

  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid job id' }, 400)
  if (!body?.status) return c.json({ success: false, error: 'status is required' }, 400)

  await updateBatchPostJobStatus(c.env.DB, company_id, id, body.status, body.last_error ?? null)

  void logAudit(c.env.DB, {
    user_id: userId,
    company_id,
    action: 'UPDATE',
    table_name: 'batch_post_jobs',
    record_id: id,
    new_value: { status: body.status },
  })

  return c.json({ success: true, data: { id, status: body.status } })
})

// POST /api/gl/batch-post/jobs/claim-next
batchJobs.post('/batch-post/jobs/claim-next', async (c) => {
  const { company_id } = getUser(c)
  const id = await claimNextBatchPostJob(c.env.DB, company_id)
  if (!id) return c.json({ success: true, data: null })

  const job = await getBatchPostJob(c.env.DB, company_id, id)
  return c.json({ success: true, data: job })
})

// POST /api/gl/batch-post/jobs/:id/process
batchJobs.post('/batch-post/jobs/:id/process', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid job id' }, 400)

  const body = await c.req.json<{ max_items?: number }>().catch(() => ({} as { max_items?: number }))
  const maxItems = Math.min(50, Math.max(1, Number(body.max_items ?? 10)))

  const job = await getBatchPostJob(c.env.DB, company_id, id)
  if (!job) return c.json({ success: false, error: 'Batch job not found' }, 404)
  if (job.status !== 'processing' && job.status !== 'pending') {
    return c.json({ success: false, error: `Job status is ${job.status}, cannot process` }, 409)
  }

  if (job.status === 'pending') {
    await updateBatchPostJobStatus(c.env.DB, company_id, id, 'processing', null)
  }

  const { results: pendingItems } = await c.env.DB.prepare(
    `SELECT id, source_id, payload, status, attempts
     FROM batch_post_job_items
     WHERE job_id = ? AND company_id = ? AND status = 'pending'
     ORDER BY id ASC
     LIMIT ?`
  ).bind(id, company_id, maxItems).all<{
    id: number
    source_id: number
    payload: string | null
    status: string
    attempts: number
  }>()

  if (!pendingItems || pendingItems.length === 0) {
    const { results: remaining } = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM batch_post_job_items
       WHERE job_id = ? AND company_id = ? AND status IN ('pending','processing')`
    ).bind(id, company_id).all<{ n: number }>()

    if ((remaining?.[0]?.n ?? 0) === 0) {
      const { results: failedItems } = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM batch_post_job_items
         WHERE job_id = ? AND company_id = ? AND status = 'failed'`
      ).bind(id, company_id).all<{ n: number }>()

      const finalStatus = (failedItems?.[0]?.n ?? 0) > 0 ? 'failed' : 'completed'
      await updateBatchPostJobStatus(c.env.DB, company_id, id, finalStatus, null)
    }

    return c.json({ success: true, data: { processed: 0, message: 'No pending items' } })
  }

  let processed = 0
  let failed = 0
  const errors: Array<{ item_id: number; error: string }> = []

  for (const item of pendingItems) {
    await c.env.DB.prepare(
      `UPDATE batch_post_job_items
       SET status = 'processing', attempts = attempts + 1
       WHERE id = ?`
    ).bind(item.id).run()

    try {
      const payload = item.payload ? JSON.parse(item.payload) as Record<string, unknown> : {}
      const eventType = job.event_type as string

      let journalEntryId: number | null = null

      switch (eventType) {
        case 'inventory_movement': {
          journalEntryId = await FinanceCore.resolveInventoryMovement(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            item_code: Number(payload.item_code ?? 0),
            warehouse: String(payload.warehouse ?? ''),
            movement_type: String(payload.movement_type ?? 'GRN'),
            value: Number(payload.value ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            item_name: String(payload.item_name ?? ''),
            created_by: userId,
          })
          break
        }

        case 'purchase_receipt': {
          throw new Error('Use resolvePurchaseReceipt for single-item purchase_receipt in batch')
        }

        case 'supplier_invoice': {
          journalEntryId = await FinanceCore.resolveSupplierInvoice(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            supplier_code: payload.supplier_code ? Number(payload.supplier_code) : null,
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
          })
          break
        }

        case 'supplier_payment': {
          journalEntryId = await FinanceCore.resolveSupplierPayment(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
            center_code: payload.center_code ? Number(payload.center_code) : undefined,
            supplier_code: payload.supplier_code ? Number(payload.supplier_code) : null,
            financial_account_id: payload.financial_account_id ? Number(payload.financial_account_id) : null,
          })
          break
        }

        case 'expense': {
          journalEntryId = await FinanceCore.resolveExpensePosting(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
            center_code: payload.center_code ? Number(payload.center_code) : undefined,
            expense_account: payload.expense_account ? String(payload.expense_account) : undefined,
          })
          break
        }

        case 'revenue':
        case 'harvest_revenue': {
          journalEntryId = await FinanceCore.resolveSalesRevenue(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
            center_code: payload.center_code ? Number(payload.center_code) : undefined,
            season_id: payload.season_id ? Number(payload.season_id) : undefined,
            field_id: payload.field_id ? Number(payload.field_id) : undefined,
          })
          break
        }

        case 'payroll_run': {
          journalEntryId = await FinanceCore.resolvePayrollPosting(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
            center_code: payload.center_code ? Number(payload.center_code) : undefined,
            season_id: payload.season_id ? Number(payload.season_id) : null,
            field_id: payload.field_id ? Number(payload.field_id) : null,
          })
          break
        }

        case 'payroll_payment': {
          journalEntryId = await FinanceCore.resolvePayrollPayment(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
          })
          break
        }

        case 'work_order_labor': {
          journalEntryId = await FinanceCore.resolveWorkOrderLabor(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
            center_code: payload.center_code ? Number(payload.center_code) : undefined,
            season_id: payload.season_id ? Number(payload.season_id) : null,
            field_id: payload.field_id ? Number(payload.field_id) : null,
          })
          break
        }

        case 'contract_advance': {
          journalEntryId = await FinanceCore.resolveContractAdvance(c.env.DB, {
            company_id,
            ref_id: item.source_id,
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
          })
          break
        }

        default: {
          throw new Error(`Unsupported batch event_type: ${eventType}`)
        }
      }

      await c.env.DB.prepare(
        `UPDATE batch_post_job_items
         SET status = 'completed', journal_entry_id = ?, processed_at = datetime('now'), error_message = NULL
         WHERE id = ?`
      ).bind(journalEntryId, item.id).run()
      processed++
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err)
      await c.env.DB.prepare(
        `UPDATE batch_post_job_items
         SET status = 'failed', error_message = ?, processed_at = datetime('now')
         WHERE id = ?`
      ).bind(errorMsg, item.id).run()
      failed++
      errors.push({ item_id: item.id, error: errorMsg })
    }
  }

  const { results: summary } = await c.env.DB.prepare(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) AS remaining
     FROM batch_post_job_items
     WHERE job_id = ? AND company_id = ?`
  ).bind(id, company_id).all<{
    total: number
    completed: number
    failed_count: number
    remaining: number
  }>()

  const s = summary?.[0]
  const totalItems = s?.total ?? 0
  const completedItems = s?.completed ?? 0
  const failedItems = s?.failed_count ?? 0
  const remainingItems = s?.remaining ?? 0

  let jobStatus: 'processing' | 'completed' | 'failed' = 'processing'
  if (remainingItems === 0) {
    jobStatus = failedItems > 0 ? 'failed' : 'completed'
  }

  const lastError = failedItems > 0 && remainingItems === 0
    ? `${failedItems} item(s) failed: ${errors.map(e => `[${e.item_id}] ${e.error}`).join('; ').slice(0, 500)}`
    : null

  await updateBatchPostJobStatus(c.env.DB, company_id, id, jobStatus, lastError)

  await c.env.DB.prepare(
    `UPDATE batch_post_jobs
     SET processed_items = ?, failed_items = ?
     WHERE id = ? AND company_id = ?`
  ).bind(completedItems, failedItems, id, company_id).run()

  return c.json({
    success: true,
    data: {
      job_id: id,
      processed_this_run: processed,
      failed_this_run: failed,
      total_items: totalItems,
      completed_items: completedItems,
      failed_items: failedItems,
      remaining_items: remainingItems,
      job_status: jobStatus,
      errors: errors.slice(0, 5),
    },
  })
})

export default batchJobs
