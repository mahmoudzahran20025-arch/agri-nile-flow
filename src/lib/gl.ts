import type { D1Database } from '@cloudflare/workers-types'

interface GLLine {
  account_code: string
  debit:        number
  credit:       number
  description?: string
  center_code?: number
  season_id?:   number
  field_id?:    number
  rule_slot?:   string   // which posting slot produced this line
  source_ledger?: 'cash' | 'supplier' | 'inventory' | 'payroll' | 'manual' | 'adjustment' | 'harvest'
  source_record_id?: number | null
}

interface PostEntryOpts {
  company_id:         number
  entry_date:         string
  description:        string
  ref_type:           string
  ref_id:             number
  lines:              GLLine[]
  created_by?:        number
  posting_rule_trace?: string   // JSON trace from posting engine
}

export async function isIntegrationEnabled(db: D1Database, company_id: number, module_key: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT is_enabled FROM gl_integration_settings WHERE company_id = ? AND module_key = ?')
    .bind(company_id, module_key).first<{ is_enabled: number }>()
  return row ? row.is_enabled === 1 : true; // Default to true for backward compatibility
}

export async function getOpenPeriod(db: D1Database, company_id: number, date: string): Promise<number | null> {
  const row = await db
    .prepare(`SELECT id FROM financial_periods
              WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND is_closed = 0
              ORDER BY start_date DESC LIMIT 1`)
    .bind(company_id, date, date).first<{ id: number }>()
  return row?.id ?? null
}

export async function postAutoEntry(db: D1Database, opts: PostEntryOpts): Promise<number | null> {
  const totalDebit  = opts.lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = opts.lines.reduce((s, l) => s + l.credit, 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('GL_UNBALANCED: The journal entry is unbalanced.')
  }

  const periodId = await getOpenPeriod(db, opts.company_id, opts.entry_date)
  if (!periodId) {
    throw new Error(`GL_CLOSED_PERIOD: No open financial period found for date ${opts.entry_date}.`)
  }

  try {

    // Step 1: Insert the header to get the entry ID
    const entry = await db
      .prepare(`INSERT INTO journal_entries
                (company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, created_by, posting_rule_trace)
                VALUES (?,?,?,?,?,?,1,?,?)`)
      .bind(opts.company_id, periodId, opts.entry_date, opts.description,
            opts.ref_type, opts.ref_id, opts.created_by ?? null,
            opts.posting_rule_trace ?? null).run()

    const entryId = entry.meta.last_row_id

    // Step 2: Insert ALL lines atomically using db.batch()
    const lineStmts = opts.lines.map(l =>
      db.prepare(
        `INSERT INTO journal_entry_lines
         (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, field_id, rule_slot, source_ledger, source_record_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        entryId, opts.company_id, l.account_code,
        l.debit, l.credit, l.description ?? null, l.center_code ?? null,
        l.season_id ?? null, l.field_id ?? null, l.rule_slot ?? null,
        l.source_ledger ?? 'manual', l.source_record_id ?? null
      )
    )
    await db.batch(lineStmts)

    return entryId
  } catch (e: any) {
    try {
      await db.prepare(`
        INSERT INTO system_error_logs 
        (company_id, user_id, endpoint, method, error_message, stack_trace, request_payload) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        opts.company_id, 
        opts.created_by ?? null, 
        'GL_ENGINE', 
        opts.ref_type, 
        e.message || String(e), 
        e.stack ?? null, 
        JSON.stringify({ ref_id: opts.ref_id, lines_count: opts.lines.length })
      ).run()
    } catch (logErr) {
      // Ignore error logging failure
    }
    throw new Error(`GL posting failed: ${e.message}`)
  }
}

// ── Auto-entry builders ────────────────────────────────────────
// NOTE: glCashTransaction, glSupplierTransaction, glSupplierInvoice,
//       glInventoryMovement, glWorkOrderLabor, glWagesPayment, 
//       glContractAdvance were removed — use FinanceCore equivalents.

