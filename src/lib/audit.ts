import type { D1Database } from '@cloudflare/workers-types'

export async function logAudit(
  db: D1Database,
  opts: {
    user_id:    number
    company_id: number
    action:     'CREATE' | 'UPDATE' | 'DELETE' | 'CLOSE' | 'REOPEN' | 'LOGIN' | 'SWITCH'
    table_name: string
    record_id?: number | null
    old_value?: unknown
    new_value?: unknown
    source?:    string
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, old_value, new_value, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        opts.user_id,
        opts.company_id,
        opts.action,
        opts.table_name,
        opts.record_id ?? null,
        opts.old_value != null ? JSON.stringify(opts.old_value) : null,
        opts.new_value != null ? JSON.stringify(opts.new_value) : null,
        opts.source ?? 'web',
      )
      .run()
  } catch {
    // Audit failures must never break the main flow — swallow silently
  }
}
