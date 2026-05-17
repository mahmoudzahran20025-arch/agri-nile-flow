import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { getTodayIsoDate } from '../../lib/utils/date'
import { logAudit } from '../../lib/audit'
import { FinanceCore } from '../../lib/finance_core'
import {
  claimNextBatchPostJob,
  enqueueBatchPostJob,
  getBatchPostJobStatus,
  getPendingBatchPostJobs,
  updateBatchPostJobItem,
  updateBatchPostJobStatus,
} from '../../lib/batch_posting'

const batchJobs = new Hono<{ Bindings: Env }>()
batchJobs.use('*', authMiddleware)
batchJobs.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// POST /api/gl/batch-post/jobs
batchJobs.post('/batch-post/jobs', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{ event_type: string; notes?: string; items: any[] }>()

  if (!b.event_type || !Array.isArray(b.items) || b.items.length === 0) {
    return c.json({ success: false, error: 'نوع الحدث وبنود الدفعة مطلوبة' }, 400)
  }

  const jobId = await enqueueBatchPostJob(c.env.DB, {
    company_id,
    event_type: b.event_type,
    notes: b.notes,
    created_by: userId,
    items: b.items.map(item => ({
      source_id: item.id || item.ref_id,
      payload: JSON.stringify(item),
    })),
  })

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'batch_post_jobs', record_id: jobId,
    new_value: { event_type: b.event_type, items_count: b.items.length },
  })

  return c.json({ success: true, data: { job_id: jobId } }, 201)
})

// GET /api/gl/batch-post/jobs
batchJobs.get('/batch-post/jobs', async (c) => {
  const { company_id } = getUser(c)
  const status = c.req.query('status')
  const results = await getPendingBatchPostJobs(c.env.DB, company_id, undefined, undefined, status)
  return c.json({ success: true, data: results })
})

// GET /api/gl/batch-post/jobs/:id
batchJobs.get('/batch-post/jobs/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const status = await getBatchPostJobStatus(c.env.DB, id, company_id)
  if (!status) return c.json({ success: false, error: 'الدفعة غير موجودة' }, 404)
  return c.json({ success: true, data: status })
})

// POST /api/gl/batch-post/jobs/:id/run
// Sequential processing of batch items
batchJobs.post('/batch-post/jobs/:id/run', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const job = await claimNextBatchPostJob(c.env.DB, id, company_id)
  if (!job) return c.json({ success: false, error: 'الدفعة قيد التشغيل أو غير متاحة' }, 409)

  const items = await c.env.DB.prepare(
    'SELECT * FROM batch_post_job_items WHERE job_id = ? ORDER BY id ASC'
  ).bind(id).all()

  let successCount = 0
  let failCount = 0

  for (const item of items.results) {
    if (item.status === 'success') {
      successCount++
      continue
    }

    try {
      const payload = item.payload ? JSON.parse(item.payload as string) as Record<string, any> : {}
      const eventType = job.event_type as string

      let journalEntryId: number | null = null

      switch (eventType) {
        case 'inventory_movement': {
          journalEntryId = await FinanceCore.resolveInventoryMovement(c.env.DB, {
            company_id,
            ref_id: Number(item.source_id),
            item_code: Number(payload.item_code ?? 0),
            warehouse_id: Number(payload.warehouse_id ?? payload.warehouse ?? 0),
            movement_type: String(payload.movement_type ?? 'GRN'),
            quantity: Number(payload.quantity ?? payload.qty_in ?? payload.qty_out ?? 0),
            unit_price: Number(payload.unit_price ?? 0),
            date: String(payload.date ?? payload.movement_date ?? getTodayIsoDate()),
            item_name: String(payload.item_name ?? ''),
            created_by: userId,
          })
          break
        }

        case 'supplier_invoice': {
          journalEntryId = await FinanceCore.resolveSupplierInvoice(c.env.DB, {
            company_id,
            ref_id: Number(item.source_id),
            supplier_code: payload.supplier_code ? Number(payload.supplier_code) : null,
            amount: Number(payload.amount ?? payload.total_amount ?? 0),
            date: String(payload.date ?? payload.invoice_date ?? getTodayIsoDate()),
            description: String(payload.description ?? payload.notes ?? ''),
            created_by: userId,
          })
          break
        }

        case 'supplier_payment': {
          journalEntryId = await FinanceCore.resolveSupplierPayment(c.env.DB, {
            company_id,
            ref_id: Number(item.source_id),
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? payload.transaction_date ?? getTodayIsoDate()),
            description: String(payload.description ?? payload.narration ?? ''),
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
            ref_id: Number(item.source_id),
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
            center_code: payload.center_code ? Number(payload.center_code) : undefined,
            financial_account_id: payload.financial_account_id ? Number(payload.financial_account_id) : undefined,
          })
          break
        }

        case 'revenue': {
          journalEntryId = await FinanceCore.resolveSalesRevenue(c.env.DB, {
            company_id,
            ref_id: Number(item.source_id),
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
            financial_account_id: payload.financial_account_id ? Number(payload.financial_account_id) : undefined,
          })
          break
        }

        case 'payroll_run': {
          journalEntryId = await FinanceCore.resolvePayrollPosting(c.env.DB, {
            company_id,
            ref_id: Number(item.source_id),
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
          })
          break
        }

        case 'payroll_payment': {
          journalEntryId = await FinanceCore.resolvePayrollPayment(c.env.DB, {
            company_id,
            ref_id: Number(item.source_id),
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            financial_account_id: Number(payload.financial_account_id ?? 0),
            created_by: userId,
          })
          break
        }

        case 'work_order_labor': {
          journalEntryId = await FinanceCore.resolveWorkOrderLabor(c.env.DB, {
            company_id,
            ref_id: Number(item.source_id),
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

        case 'contract_advance': {
          journalEntryId = await FinanceCore.resolveContractAdvance(c.env.DB, {
            company_id,
            ref_id: Number(item.source_id),
            contract_id: Number(payload.contract_id ?? item.source_id),
            amount: Number(payload.amount ?? 0),
            date: String(payload.date ?? getTodayIsoDate()),
            description: String(payload.description ?? ''),
            created_by: userId,
          })
          break
        }

        default:
          throw new Error(`Unsupported event type: ${eventType}`)
      }

      await updateBatchPostJobItem(c.env.DB, Number(item.id), {
        status: 'success',
        journal_entry_id: journalEntryId || undefined,
      })
      successCount++
    } catch (err: any) {
      await updateBatchPostJobItem(c.env.DB, Number(item.id), {
        status: 'failed',
        error_message: err.message,
      })
      failCount++
    }
  }

  const finalStatus = failCount > 0 ? 'failed' : 'completed'
  await updateBatchPostJobStatus(c.env.DB, id, finalStatus)

  return c.json({ success: true, data: { success_count: successCount, fail_count: failCount, status: finalStatus } })
})

export default batchJobs
