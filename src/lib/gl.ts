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
  source_link_id?:    number | null // NEW: for native traceability
  lines:              GLLine[]
  expected_minimum_lines?: number
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

async function validatePostingAccounts(
  db: D1Database,
  companyId: number,
  lines: GLLine[],
): Promise<void> {
  const accountCodes = Array.from(
    new Set(
      lines
        .map(l => (l.account_code ?? '').trim())
        .filter(Boolean),
    ),
  )

  if (accountCodes.length === 0) {
    throw new Error('GL_NO_ACCOUNT_LINES: No valid account codes were provided.')
  }

  const placeholders = accountCodes.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT code, is_active, is_header
     FROM chart_of_accounts
     WHERE company_id = ? AND code IN (${placeholders})`
  ).bind(companyId, ...accountCodes)
    .all<{ code: string; is_active: number; is_header: number }>()

  const byCode = new Map(results.map(r => [r.code, r]))

  for (const code of accountCodes) {
    const row = byCode.get(code)
    if (!row) {
      throw new Error(`GL_INVALID_ACCOUNT: account ${code} does not exist in chart_of_accounts.`)
    }
    if (row.is_active === 0) {
      throw new Error(`GL_INACTIVE_ACCOUNT: account ${code} is inactive.`)
    }
    if (row.is_header === 1) {
      throw new Error(`GL_HEADER_ACCOUNT_BLOCKED: account ${code} is a grouping/header account and cannot receive postings.`)
    }
  }
}

export async function postAutoEntry(db: D1Database, opts: PostEntryOpts): Promise<number | null> {
  const minimumLines = Math.max(2, Number(opts.expected_minimum_lines ?? 2))
  if (!Array.isArray(opts.lines) || opts.lines.length < minimumLines) {
    throw new Error(`GL_MIN_LINES: Journal entry requires at least ${minimumLines} lines.`)
  }

  const totalDebit  = Math.round(opts.lines.reduce((s, l) => s + (l.debit  ?? 0), 0) * 100) / 100
  const totalCredit = Math.round(opts.lines.reduce((s, l) => s + (l.credit ?? 0), 0) * 100) / 100
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('GL_UNBALANCED: The journal entry is unbalanced.')
  }

  const periodId = await getOpenPeriod(db, opts.company_id, opts.entry_date)
  if (!periodId) {
    throw new Error(`GL_CLOSED_PERIOD: No open financial period found for date ${opts.entry_date}.`)
  }

  await validatePostingAccounts(db, opts.company_id, opts.lines)

  try {
    let entryId: number | null = null

    // Stage 1: Persist header as draft. It is promoted to posted only after
    // line persistence + invariant checks pass.
    const entry = await db
      .prepare(`INSERT INTO journal_entries
                (company_id, period_id, entry_date, description, ref_type, ref_id, source_link_id, is_posted, created_by, posting_rule_trace)
                VALUES (?,?,?,?,?,?,?,0,?,?)`)
      .bind(opts.company_id, periodId, opts.entry_date, opts.description,
            opts.ref_type, opts.ref_id, opts.source_link_id ?? null, opts.created_by ?? null,
            opts.posting_rule_trace ?? null).run()

    entryId = Number(entry.meta.last_row_id)

    // Stage 2: Persist all lines (amounts rounded to 2dp to prevent float noise)
    const lineStmts = opts.lines.map(l => {
      const debit  = Math.round((l.debit  ?? 0) * 100) / 100
      const credit = Math.round((l.credit ?? 0) * 100) / 100
      return db.prepare(
        `INSERT INTO journal_entry_lines
         (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, field_id, rule_slot, source_ledger, source_record_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        entryId, opts.company_id, l.account_code,
        debit, credit, l.description ?? null, l.center_code ?? null,
        l.season_id ?? null, l.field_id ?? null, l.rule_slot ?? null,
        l.source_ledger ?? 'manual', l.source_record_id ?? null
      )
    })
    try {
      await db.batch(lineStmts)

      // Stage 3: Validate persisted entry before finalizing as posted.
      const persisted = await db.prepare(
        `SELECT COUNT(*) AS line_count,
                COALESCE(SUM(debit), 0) AS total_debit,
                COALESCE(SUM(credit), 0) AS total_credit
         FROM journal_entry_lines
         WHERE entry_id = ? AND company_id = ?`
      ).bind(entryId, opts.company_id).first<{
        line_count: number
        total_debit: number
        total_credit: number
      }>()

      const lineCount = Number(persisted?.line_count ?? 0)
      const persistedDebit = Number(persisted?.total_debit ?? 0)
      const persistedCredit = Number(persisted?.total_credit ?? 0)

      if (lineCount < minimumLines) {
        throw new Error(`GL_MIN_LINES: Persisted line_count=${lineCount} below minimum ${minimumLines}.`)
      }
      if (Math.abs(persistedDebit - persistedCredit) > 0.01) {
        throw new Error('GL_UNBALANCED_PERSISTED: Persisted journal lines are unbalanced.')
      }

      await db.prepare(
        `UPDATE journal_entries
         SET is_posted = 1
         WHERE id = ? AND company_id = ?`
      ).bind(entryId, opts.company_id).run()

      const orphanGuard = await db.prepare(
        `SELECT COUNT(*) AS n
         FROM journal_entries e
         LEFT JOIN journal_entry_lines l
           ON l.entry_id = e.id AND l.company_id = e.company_id
         WHERE e.id = ? AND e.company_id = ? AND e.is_posted = 1
         GROUP BY e.id
         HAVING COUNT(l.id) = 0`
      ).bind(entryId, opts.company_id).first<{ n: number }>()

      if (orphanGuard) {
        throw new Error('GL_ORPHAN_POSTED_GUARD: posted journal entry has zero lines.')
      }
    } catch (lineErr: any) {
      // Compensating cleanup: do not keep a header without a full, valid line set.
      if (entryId) {
        await db.prepare('DELETE FROM journal_entry_lines WHERE entry_id = ? AND company_id = ?')
          .bind(entryId, opts.company_id).run()
        await db.prepare('DELETE FROM journal_entries WHERE id = ? AND company_id = ?')
          .bind(entryId, opts.company_id).run()
      }
      throw lineErr
    }

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

