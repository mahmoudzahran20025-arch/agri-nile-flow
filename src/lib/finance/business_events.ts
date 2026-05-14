import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { postAutoEntry } from '../gl'
import type { RuleTrace } from '../posting_engine'
import { normalizeIsoDate } from '../utils/date'

const OPERATION_KEY_BY_EVENT_TYPE: Record<string, string> = {
  supplier_invoice:     'SUPPLIER_INVOICE',
  supplier_payment:     'SUPPLIER_PAYMENT',
  sales_invoice:        'SALES_INVOICE',
  sale_receipt:         'SALE_RECEIPT',
  inventory_movement:   'INVENTORY_MOVEMENT',
  purchase_receipt:     'INVENTORY_IN',
  work_order_labor:     'PRODUCTION_CONSUMPTION',
  harvest_cost:         'PRODUCTION_OUTPUT',
  expense:              'CASH_EXPENSE',
  cash_transaction:     'CASH_EXPENSE',  // covers both receipt and payment directions
  revenue:              'SALE_RECEIPT',  // cash sales revenue → same matrix row as sale_receipt
  cash_receipt:         'CASH_INCOME',   // direct cash receipt (non-sales)
}

async function ensureDeterministicMatrixCoverage(
  db: D1Database,
  companyId: number,
  eventType: string,
): Promise<void> {
  const operationKey = OPERATION_KEY_BY_EVENT_TYPE[eventType]
  if (!operationKey) return

  try {
    const row = await db.prepare(
      `SELECT id
       FROM posting_operation_matrix
       WHERE company_id = ? AND operation_key = ? AND is_active = 1
       LIMIT 1`
    ).bind(companyId, operationKey).first<{ id: number }>()

    if (!row) {
      throw new Error(
        `POSTING_MATRIX_MISSING: event_type ${eventType} requires operation_key ${operationKey} in posting_operation_matrix.`
      )
    }
  } catch (error: any) {
    const msg = String(error?.message || error)
    if (msg.includes('no such table: posting_operation_matrix')) {
      throw new Error('POSTING_MATRIX_SCHEMA_MISSING: migration 0094_coa_governance_phase.sql must be applied.')
    }
    throw error
  }
}

export interface EventBackedPostOpts {
  company_id: number
  event_type: string
  source_module: string
  source_id: number
  event_date: string
  description: string
  created_by?: number
  payload: Record<string, unknown>
  trace?: RuleTrace | null
  lines: Array<{
    account_code: string
    debit: number
    credit: number
    description?: string
    center_code?: number
    season_id?: number
    field_id?: number
    rule_slot?: string
    source_ledger?: 'cash' | 'supplier' | 'inventory' | 'payroll' | 'manual' | 'adjustment' | 'harvest'
    source_record_id?: number | null
  }>
}

async function logPostingResolution(
  db: D1Database,
  opts: EventBackedPostOpts,
  result: 'resolved' | 'failed',
  eventId: number | null,
  journalEntryId: number | null,
  errorMessage?: string,
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO posting_rule_resolutions
       (company_id, rule_type, input_bpg, input_ppg, input_ipg, resolution_step, matched_rule_id,
        result, error_message, journal_entry_id, source_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opts.company_id,
      opts.trace?.rule_type ?? opts.event_type,
      opts.trace?.input_bpg ?? null,
      opts.trace?.input_ppg ?? null,
      opts.trace?.input_ipg ?? null,
      opts.trace?.resolution_step ?? null,
      opts.trace?.matched_rule_id ?? null,
      result,
      errorMessage ?? null,
      journalEntryId,
      eventId,
    ).run()
  } catch {
    // Non-blocking observability write
  }
}

async function linkJournalEntryToSource(
  db: D1Database,
  opts: EventBackedPostOpts,
  entryId: number,
): Promise<void> {
  const stmts: D1PreparedStatement[] = []

  if (opts.event_type === 'inventory_movement' || opts.event_type === 'inventory_transfer' || opts.event_type === 'purchase_receipt') {
    stmts.push(
      db.prepare('UPDATE inventory_movements SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, opts.source_id, opts.company_id)
    )
  }

  if (opts.event_type === 'cash_transaction' || opts.event_type === 'expense' || opts.event_type === 'partner_capital' || opts.event_type === 'partner_current' || opts.event_type === 'contract_advance') {
    stmts.push(
      db.prepare('UPDATE cash_transactions SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, opts.source_id, opts.company_id)
    )
  }

  if (opts.event_type === 'supplier_invoice') {
    stmts.push(
      db.prepare('UPDATE supplier_transactions SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, opts.source_id, opts.company_id)
    )
    stmts.push(
      db.prepare('UPDATE supplier_invoices SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, opts.source_id, opts.company_id)
    )
  }

  if (opts.event_type === 'supplier_payment') {
    stmts.push(
      db.prepare('UPDATE supplier_transactions SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, opts.source_id, opts.company_id)
    )
  }

  if (opts.event_type === 'payroll_run') {
    stmts.push(
      db.prepare('UPDATE payroll_runs SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, opts.source_id, opts.company_id)
    )
  }

  if (opts.event_type === 'payroll_payment') {
    stmts.push(
      db.prepare('UPDATE payroll_runs SET payment_gl_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, opts.source_id, opts.company_id)
    )
  }

  if (opts.event_type === 'work_order_labor') {
    stmts.push(
      db.prepare('UPDATE work_tasks SET journal_entry_id = ? WHERE work_order_id = ? AND company_id = ?')
        .bind(entryId, opts.source_id, opts.company_id)
    )
  }

  if (opts.event_type === 'wip_carryforward') {
    stmts.push(
      db.prepare('UPDATE wip_balances SET journal_entry_id = ? WHERE company_id = ? AND from_season_id = ? AND status = ?')
        .bind(entryId, opts.company_id, opts.source_id, 'carried')
    )
  }

  if (opts.event_type === 'depreciation') {
    const periodYear  = opts.payload?.period_year  || opts.payload?.year
    const periodMonth = opts.payload?.period_month || opts.payload?.month
    const assetId     = opts.payload?.asset_id     ?? opts.source_id
    if (periodYear && periodMonth && assetId) {
      stmts.push(
        db.prepare('UPDATE depreciation_schedules SET journal_entry_id = ? WHERE company_id = ? AND asset_id = ? AND period_year = ? AND period_month = ?')
          .bind(entryId, opts.company_id, assetId, periodYear, periodMonth)
      )
    }
  }

  if (stmts.length > 0) {
    await db.batch(stmts)
  }
}

export async function syncSourceDocumentBridge(
  db: D1Database,
  opts: EventBackedPostOpts,
  eventId: number,
  journalEntryId: number | null,
  status: 'pending' | 'posted' | 'error',
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO source_documents
       (company_id, source_module, source_id, document_type, event_id, event_date, status, payload_snapshot, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_id, source_module, source_id, document_type)
       DO UPDATE SET
         event_id = excluded.event_id,
         event_date = excluded.event_date,
         status = excluded.status,
         payload_snapshot = excluded.payload_snapshot,
         updated_at = datetime('now')`
    ).bind(
      opts.company_id,
      opts.source_module,
      opts.source_id,
      opts.event_type,
      eventId,
      opts.event_date,
      status,
      JSON.stringify(opts.payload),
      opts.created_by ?? null,
    ).run()

    const doc = await db.prepare(
      `SELECT id FROM source_documents
       WHERE company_id = ? AND source_module = ? AND source_id = ? AND document_type = ?
       LIMIT 1`
    ).bind(opts.company_id, opts.source_module, opts.source_id, opts.event_type)
      .first<{ id: number }>()

    if (doc?.id && journalEntryId) {
      await db.prepare(
        `INSERT INTO source_document_links
         (company_id, source_document_id, journal_entry_id, link_type)
         VALUES (?, ?, ?, 'primary')
         ON CONFLICT(company_id, source_document_id, journal_entry_id, link_type)
         DO NOTHING`
      ).bind(opts.company_id, doc.id, journalEntryId).run()
    }
  } catch {
    // Non-blocking bridge write. Posting must not fail because of bridge metadata.
  }
}

export async function postFromBusinessEvent(
  db: D1Database,
  opts: EventBackedPostOpts,
): Promise<number | null> {
  const normalizedEventDate = normalizeIsoDate(opts.event_date)
  const eventPayload = JSON.stringify(opts.payload)
  let eventId: number | null = null

  await ensureDeterministicMatrixCoverage(db, opts.company_id, opts.event_type)

  // Reject posting into a locked GL period
  const lockedPeriod = await db.prepare(
    `SELECT id, name FROM financial_periods
     WHERE company_id = ? AND is_closed = 1
       AND start_date <= ? AND end_date >= ?
     LIMIT 1`
  ).bind(opts.company_id, normalizedEventDate, normalizedEventDate)
    .first<{ id: number; name: string }>()

  if (lockedPeriod) {
    throw new Error(
      `GL_PERIOD_LOCKED: الفترة المحاسبية "${lockedPeriod.name}" مغلقة. لا يمكن الترحيل في تاريخ ${opts.event_date}.`
    )
  }

  // Idempotency key: (company_id, source_module, source_id, event_type)
  let existing = await db.prepare(
    `SELECT id, status, journal_entry_id, payload
     FROM business_events
     WHERE company_id = ? AND source_module = ? AND source_id = ? AND event_type = ?
     LIMIT 1`
  ).bind(opts.company_id, opts.source_module, opts.source_id, opts.event_type)
    .first<{ id: number; status: string; journal_entry_id: number | null; payload?: string }>()

  if (existing?.status === 'posted' && existing.journal_entry_id) {
    await syncSourceDocumentBridge(db, opts, existing.id, existing.journal_entry_id, 'posted')
    return existing.journal_entry_id
  }

  if (!existing) {
    try {
      const eventInsert = await db.prepare(
        `INSERT INTO business_events (
          company_id,
          event_type,
          event_date,
          source_module,
          source_id,
          payload,
          status,
          posted_by,
          posted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`
      ).bind(
        opts.company_id,
        opts.event_type,
        normalizedEventDate,
        opts.source_module,
        opts.source_id,
        eventPayload,
        opts.created_by ?? null,
      ).run()
      eventId = Number(eventInsert.meta.last_row_id)
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      const isUniqueViolation = msg.includes('UNIQUE') || 
                                msg.includes('constraint failed') || 
                                msg.includes('2067') ||
                                msg.includes('already exists')
      
      if (!isUniqueViolation) {
        throw new Error(`BUSINESS_EVENT_INSERT_ERROR: ${msg}`)
      }
      
      existing = await db.prepare(
        `SELECT id, status, journal_entry_id, payload
         FROM business_events
         WHERE company_id = ? AND source_module = ? AND source_id = ? AND event_type = ?
         LIMIT 1`
      ).bind(opts.company_id, opts.source_module, opts.source_id, opts.event_type)
        .first<{ id: number; status: string; journal_entry_id: number | null; payload: string }>()
      
      if (!existing) {
        throw new Error('BUSINESS_EVENT_RACE_LOST: concurrent insert won but row not found')
      }
      
      if (existing.payload && existing.payload !== eventPayload) {
        console.warn(`BUSINESS_EVENT_PAYLOAD_MISMATCH: event ${existing.id} has different payload`)
      }
      
      if (existing.status === 'posted' && existing.journal_entry_id) {
        await syncSourceDocumentBridge(db, opts, existing.id, existing.journal_entry_id, 'posted')
        return existing.journal_entry_id
      }
      eventId = existing.id
    }
  } else {
    eventId = existing.id
    if (existing.journal_entry_id) {
      await db.prepare(
        `UPDATE business_events
         SET status = 'posted', posted_at = COALESCE(posted_at, datetime('now'))
         WHERE id = ? AND company_id = ?`
      ).bind(eventId, opts.company_id).run()
      await syncSourceDocumentBridge(db, opts, eventId, existing.journal_entry_id, 'posted')
      return existing.journal_entry_id
    }
    await db.prepare(
      `UPDATE business_events
       SET status = 'pending', error_message = NULL, payload = ?, event_date = ?, posted_by = ?, posted_at = NULL
       WHERE id = ? AND company_id = ?`
    ).bind(eventPayload, normalizedEventDate, opts.created_by ?? null, eventId, opts.company_id).run()
  }

  if (!eventId) {
    throw new Error('BUSINESS_EVENT_ID_MISSING: unable to determine event id before posting.')
  }

  await syncSourceDocumentBridge(db, opts, eventId, null, 'pending')

  try {
    const entryId = await postAutoEntry(db, {
      company_id:         opts.company_id,
      entry_date:         normalizedEventDate,
      description:        opts.description,
      ref_type:           'business_event',
      ref_id:             eventId,
      created_by:         opts.created_by,
      posting_rule_trace: opts.trace ? JSON.stringify(opts.trace) : undefined,
      lines:              opts.lines,
    })

    if (entryId) {
      await linkJournalEntryToSource(db, opts, entryId)
    }

    await db.prepare(
      `UPDATE business_events
       SET status = 'posted', journal_entry_id = ?, posted_at = datetime('now')
       WHERE id = ? AND company_id = ?`
    ).bind(entryId ?? null, eventId, opts.company_id).run()

    await syncSourceDocumentBridge(db, opts, eventId, entryId ?? null, 'posted')
    await logPostingResolution(db, opts, 'resolved', eventId, entryId ?? null)

    return entryId
  } catch (error: any) {
    await db.prepare(
      `UPDATE business_events
       SET status = 'error', error_message = ?
       WHERE id = ? AND company_id = ?`
    ).bind(error?.message ?? String(error), eventId, opts.company_id).run()
    await syncSourceDocumentBridge(db, opts, eventId, null, 'error')
    await logPostingResolution(db, opts, 'failed', eventId, null, error?.message ?? String(error))
    throw error
  }
}
