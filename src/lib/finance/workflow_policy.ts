import type { D1Database } from '@cloudflare/workers-types'
import { logAudit } from '../audit'

type FinancialWorkflowModule = 'cash' | 'inventory' | 'suppliers' | 'gl'

export async function logFinancialWorkflowFailure(
  db: D1Database,
  opts: {
    company_id: number
    user_id?: number | null
    module: FinancialWorkflowModule
    stage: string
    table_name: string
    record_id?: number | null
    error: unknown
    context?: unknown
  },
): Promise<void> {
  const message = opts.error instanceof Error ? opts.error.message : String(opts.error)
  const stack = opts.error instanceof Error ? opts.error.stack : null

  try {
    await db.prepare(
      `INSERT INTO system_error_logs
       (company_id, user_id, endpoint, method, error_message, stack_trace, request_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opts.company_id,
      opts.user_id ?? null,
      `FINANCIAL_WORKFLOW:${opts.module}`,
      opts.stage,
      message,
      stack,
      opts.context != null ? JSON.stringify(opts.context) : null,
    ).run()
  } catch {
    // Preserve original failure path even if observability write fails.
  }

  if (opts.user_id != null) {
    await logAudit(db, {
      user_id: opts.user_id,
      company_id: opts.company_id,
      action: 'UPDATE',
      table_name: opts.table_name,
      record_id: opts.record_id ?? null,
      new_value: {
        financial_workflow: 'failed',
        module: opts.module,
        stage: opts.stage,
        error: message,
      },
      source: 'financial_workflow_policy',
    })
  }
}