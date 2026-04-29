import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { getOpenPeriod, postAutoEntry } from './gl'
import {
  resolveInventoryMovement  as peResolveInventory,
  resolveInventoryTransfer  as peResolveTransfer,
  resolvePurchaseReceipt    as peResolvePurchaseReceipt,
  resolveCashTransaction     as peResolveCash,
  resolveSupplierInvoice    as peResolveSupplierInvoice,
  resolveSupplierPayment    as peResolveSupplierPayment,
  resolveExpensePosting     as peResolveExpense,
  resolveSalesRevenue       as peResolveSalesRevenue,
  resolvePayrollPosting     as peResolvePayroll,
  resolveWorkOrderLabor      as peResolveWorkOrderLabor,
  resolveContractAdvance     as peResolveContractAdvance,
  resolveControlAccount,
} from './posting_engine'

interface CashMovementInput {
  company_id:       number
  userId:           number
  transaction_date: string
  direction:        'د' | 'م'
  amount:           number
  narration:        string
  recipient_name?:  string | null
  document_number?: number | null
  supplier_code?:   number | null
  center_code?:     number | null
  field_id?:        number | null
  expense_code?:    string | null
  season_id?:       number | null
  notes?:           string | null
  document_type?:   string | null
  unit?:            string | null
  quantity?:        number | null
  unit_price?:      number | null
  contraAccount?:   string | null
  partner_id?:           number | null
  financial_account_id?: number | null
  status?:          'draft' | 'posted'
  skipSupplierMirror?:   boolean
}

interface CashDraftRow {
  id: number
  transaction_date: string
  direction: 'د' | 'م'
  amount: number
  narration: string
  supplier_code: number | null
  center_code: number | null
  partner_id: number | null
  financial_account_id: number | null
  expense_code?: string | null
}

interface EventBackedPostOpts {
  company_id: number
  event_type: string
  source_module: string
  source_id: number
  event_date: string
  description: string
  created_by?: number
  payload: Record<string, unknown>
  trace?: import('./posting_engine').RuleTrace | null
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

  if (stmts.length > 0) {
    await db.batch(stmts)
  }
}

async function postFromBusinessEvent(
  db: D1Database,
  opts: EventBackedPostOpts,
): Promise<number | null> {
  const eventPayload = JSON.stringify(opts.payload)
  let eventId: number | null = null

  // Idempotency key: (company_id, source_module, source_id, event_type)
  let existing = await db.prepare(
    `SELECT id, status, journal_entry_id
     FROM business_events
     WHERE company_id = ? AND source_module = ? AND source_id = ? AND event_type = ?
     LIMIT 1`
  ).bind(opts.company_id, opts.source_module, opts.source_id, opts.event_type)
    .first<{ id: number; status: string; journal_entry_id: number | null }>()

  if (existing?.status === 'posted' && existing.journal_entry_id) {
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
        opts.event_date,
        opts.source_module,
        opts.source_id,
        eventPayload,
        opts.created_by ?? null,
      ).run()
      eventId = Number(eventInsert.meta.last_row_id)
    } catch {
      // Race-safe retry path: another request inserted the same event key.
      existing = await db.prepare(
        `SELECT id, status, journal_entry_id
         FROM business_events
         WHERE company_id = ? AND source_module = ? AND source_id = ? AND event_type = ?
         LIMIT 1`
      ).bind(opts.company_id, opts.source_module, opts.source_id, opts.event_type)
        .first<{ id: number; status: string; journal_entry_id: number | null }>()
      if (!existing) {
        throw new Error('BUSINESS_EVENT_INSERT_FAILED: unable to create or load idempotent event row.')
      }
      if (existing.status === 'posted' && existing.journal_entry_id) {
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
      return existing.journal_entry_id
    }
    await db.prepare(
      `UPDATE business_events
       SET status = 'pending', error_message = NULL, payload = ?, event_date = ?, posted_by = ?, posted_at = NULL
       WHERE id = ? AND company_id = ?`
    ).bind(eventPayload, opts.event_date, opts.created_by ?? null, eventId, opts.company_id).run()
  }

  if (!eventId) {
    throw new Error('BUSINESS_EVENT_ID_MISSING: unable to determine event id before posting.')
  }

  try {
    const entryId = await postAutoEntry(db, {
      company_id:         opts.company_id,
      entry_date:         opts.event_date,
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

    await logPostingResolution(db, opts, 'resolved', eventId, entryId ?? null)

    return entryId
  } catch (error: any) {
    await db.prepare(
      `UPDATE business_events
       SET status = 'error', error_message = ?
       WHERE id = ? AND company_id = ?`
    ).bind(error?.message ?? String(error), eventId, opts.company_id).run()
    await logPostingResolution(db, opts, 'failed', eventId, null, error?.message ?? String(error))
    throw error
  }
}

export const FinanceCore = {

  async prepareCashMovement(
    db: D1Database,
    opts: CashMovementInput,
  ) {
    const status    = opts.status ?? 'posted'
    const isPosted  = status === 'posted'
    const batchKey  = `cash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const stmts: D1PreparedStatement[] = []

    let periodId: number | null = null
    let newBalance: number | null = null
    let delta = 0

    if (isPosted) {
      periodId = await getOpenPeriod(db, opts.company_id, opts.transaction_date)
      if (!periodId) throw new Error(`PERIOD_CLOSED: No open period for ${opts.transaction_date}`)

      // FIX: Calculate balance BEFORE building the INSERT so it binds the correct value
      // Calculate balance for this SPECIFIC account
      const lastRow = await db
        .prepare(`SELECT running_balance FROM cash_transactions
                  WHERE company_id = ? AND financial_account_id = ? 
                    AND transaction_date <= ? AND status = 'posted'
                  ORDER BY transaction_date DESC, id DESC LIMIT 1`)
        .bind(opts.company_id, opts.financial_account_id, opts.transaction_date).first<{ running_balance: number }>()

      const prevBalance = lastRow?.running_balance ?? 0
      delta      = opts.direction === 'د' ? opts.amount : -opts.amount
      newBalance = prevBalance + delta

      // FIX: NULL-guard — existing rows with local_id IS NULL must also be propagated
      // Only affect running_balance of the SAME account
      stmts.push(db.prepare(
        `UPDATE cash_transactions SET running_balance = running_balance + ?
         WHERE company_id = ? AND financial_account_id = ? AND status = 'posted'
           AND (transaction_date > ? OR (transaction_date = ? AND (local_id IS NULL OR local_id != ?)))`
      ).bind(delta, opts.company_id, opts.financial_account_id, opts.transaction_date, opts.transaction_date, batchKey))
    }

    // Insert cash transaction with correct running_balance
    stmts.push(db.prepare(
      `INSERT INTO cash_transactions
       (company_id, season_id, supplier_code, partner_id, financial_account_id, transaction_date,
        direction, document_number, recipient_name, narration, amount,
        debit, credit, running_balance, year, month, created_by_user_id, status, center_code, field_id, expense_code, local_id,
        document_type, notes, unit, quantity, unit_price)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      opts.company_id, opts.season_id ?? null, opts.supplier_code ?? null, opts.partner_id ?? null, opts.financial_account_id ?? null,
      opts.transaction_date, opts.direction, opts.document_number ?? null,
      opts.recipient_name ?? null, opts.narration, opts.amount,
      opts.direction === 'م' ? opts.amount : 0,
      opts.direction === 'د' ? opts.amount : 0,
      newBalance,
      new Date(opts.transaction_date).getFullYear(), new Date(opts.transaction_date).getMonth() + 1,
      opts.userId, status, opts.center_code ?? null, opts.field_id ?? null, opts.expense_code ?? null, batchKey,
      opts.document_type ?? null, opts.notes ?? null, opts.unit ?? null, opts.quantity ?? null, opts.unit_price ?? null
    ))

    if (isPosted) {
      // Determine which GL account to use for "Cash" side
      let cashAccCode = ''
      if (opts.financial_account_id) {
        const accInfo = await db.prepare("SELECT gl_account_code FROM bank_accounts WHERE id = ?").bind(opts.financial_account_id).first<{ gl_account_code: string }>()
        cashAccCode = accInfo?.gl_account_code || ''
      }

      if (!cashAccCode) {
        const resolvedControl = await resolveControlAccount(db, opts.company_id, 'cash')
        cashAccCode = resolvedControl || ''
      }

      let contraAcc = opts.contraAccount
      if (!contraAcc) {
        if (opts.expense_code) {
          const et = await db.prepare("SELECT gl_account_code FROM expense_types WHERE code = ? AND company_id = ?").bind(opts.expense_code, opts.company_id).first<{gl_account_code: string}>()
          if (et?.gl_account_code) contraAcc = et.gl_account_code
        }
        if (!contraAcc) {
          const key = opts.partner_id
            ? 'partner_current_account'
            : opts.supplier_code
            ? 'accounts_payable'
            : (opts.direction === 'د' ? 'revenue_default' : 'expense_default')
          const resolvedContra = await resolveControlAccount(db, opts.company_id, key)
          contraAcc = resolvedContra || ''
        }
      }

      if (opts.supplier_code && !opts.skipSupplierMirror) {
        const supKey = `st_${batchKey}`
        stmts.push(db.prepare(
          `INSERT INTO supplier_transactions
           (company_id, season_id, supplier_code, transaction_date, entry_type, document_type,
            notes, amount, credit, debit, status, created_by_user_id, local_id, center_code)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          opts.company_id, opts.season_id ?? null, opts.supplier_code,
          opts.transaction_date, opts.direction, 'cash_payment',
          opts.narration, opts.amount,
          opts.direction === 'د' ? opts.amount : 0,
          opts.direction === 'م' ? opts.amount : 0,
          status, opts.userId, supKey, opts.center_code ?? null
        ))
      }
    } else {
      // Draft supplier mirror
      if (opts.supplier_code && !opts.skipSupplierMirror) {
        const supKey = `st_${batchKey}`
        stmts.push(db.prepare(
          `INSERT INTO supplier_transactions
           (company_id, season_id, supplier_code, transaction_date, entry_type, document_type,
            notes, amount, credit, debit, status, created_by_user_id, local_id, center_code)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          opts.company_id, opts.season_id ?? null, opts.supplier_code,
          opts.transaction_date, opts.direction, 'cash_payment',
          opts.narration, opts.amount,
          opts.direction === 'د' ? opts.amount : 0,
          opts.direction === 'م' ? opts.amount : 0,
          'draft', opts.userId, supKey, opts.center_code ?? null
        ))
      }
    }

    return { stmts, batchKey, newBalance }
  },

  async recordCashMovement(db: D1Database, opts: CashMovementInput) {
    const { stmts, batchKey, newBalance } = await this.prepareCashMovement(db, opts)
    await db.batch(stmts)
    const txn = await db
      .prepare('SELECT id FROM cash_transactions WHERE local_id = ?')
      .bind(batchKey).first<{ id: number }>()

    let glId: number | null = null
    if (opts.status === 'posted' && txn?.id) {
      glId = await this.resolveCashLedger(db, {
        company_id: opts.company_id,
        ref_id: txn.id,
        amount: opts.amount,
        direction: opts.direction,
        date: opts.transaction_date,
        narration: opts.narration,
        financial_account_id: opts.financial_account_id,
        contraAccount: opts.contraAccount,
        expense_code: opts.expense_code,
        supplier_code: opts.supplier_code,
        partner_id: opts.partner_id,
        center_code: opts.center_code,
        created_by: opts.userId
      })
      if (glId) {
        await db.prepare('UPDATE cash_transactions SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
          .bind(glId, txn.id, opts.company_id).run()
        await db.prepare('UPDATE supplier_transactions SET journal_entry_id = ? WHERE local_id = ? AND company_id = ?')
          .bind(glId, `st_${batchKey}`, opts.company_id).run()
      }
    }

    return { txnId: txn?.id, balance: newBalance, glId }
  },

  async postCashMovement(db: D1Database, company_id: number, txnId: number, userId: number) {
    const txn = await db.prepare(
      `SELECT id, transaction_date, direction, amount, narration, supplier_code, partner_id, financial_account_id, center_code
       FROM cash_transactions WHERE id = ? AND company_id = ? AND status = 'draft'`
    ).bind(txnId, company_id).first<CashDraftRow>()

    if (!txn) throw new Error('DRAFT_NOT_FOUND: Transaction not found or already posted')

    const periodId = await getOpenPeriod(db, company_id, txn.transaction_date)
    if (!periodId) throw new Error(`PERIOD_CLOSED: No open period for ${txn.transaction_date}`)

    const lastRow = await db
      .prepare(`SELECT running_balance FROM cash_transactions
                WHERE company_id = ? AND financial_account_id = ? 
                  AND transaction_date <= ? AND status = 'posted'
                ORDER BY transaction_date DESC, id DESC LIMIT 1`)
      .bind(company_id, txn.financial_account_id, txn.transaction_date).first<{ running_balance: number }>()

    const prevBalance = lastRow?.running_balance ?? 0
    const delta       = txn.direction === 'د' ? txn.amount : -txn.amount
    const newBalance  = prevBalance + delta

    const stmts: D1PreparedStatement[] = []

    stmts.push(db.prepare(
      `UPDATE cash_transactions SET status = 'posted', running_balance = ? WHERE id = ?`
    ).bind(newBalance, txnId))

    // FIX: use id > ? (not local_id) — existing rows have local_id = NULL
    // Also use 'IS' for financial_account_id to handle NULL correctly in comparison
    stmts.push(db.prepare(
      `UPDATE cash_transactions SET running_balance = running_balance + ?
       WHERE company_id = ? AND (financial_account_id IS ?) AND status = 'posted'
         AND (transaction_date > ? OR (transaction_date = ? AND id > ?))`
    ).bind(delta, company_id, txn.financial_account_id, txn.transaction_date, txn.transaction_date, txnId))

    if (txn.supplier_code) {
      stmts.push(db.prepare(
        `UPDATE supplier_transactions SET status = 'posted'
         WHERE local_id = (SELECT 'st_' || local_id FROM cash_transactions WHERE id = ?)`
      ).bind(txnId))
    }

    await db.batch(stmts)

    const glId = await this.resolveCashLedger(db, {
      company_id,
      ref_id: txnId,
      amount: txn.amount,
      direction: txn.direction,
      date: txn.transaction_date,
      narration: txn.narration,
      financial_account_id: txn.financial_account_id,
      supplier_code: txn.supplier_code,
      partner_id: txn.partner_id,
      center_code: txn.center_code,
      created_by: userId
    })

    if (glId) {
      await db.prepare('UPDATE cash_transactions SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(glId, txnId, company_id).run()
      await db.prepare(
        `UPDATE supplier_transactions
         SET journal_entry_id = ?
         WHERE local_id = (SELECT 'st_' || local_id FROM cash_transactions WHERE id = ? AND company_id = ?)`
      ).bind(glId, txnId, company_id).run()
    }

    return glId
  },

  /**
   * resolveWorkOrderLabor
   * Post production labor cost via posting_engine.
   */
  async resolveWorkOrderLabor(
    db: D1Database,
    opts: {
      company_id:   number
      ref_id:       number
      amount:       number
      date:         string
      description:  string
      created_by?:  number
      center_code?: number
      season_id?:   number | null
      field_id?:    number | null
    }
  ): Promise<number | null> {
    const [cogsCode, payableCode] = await Promise.all([
      resolveControlAccount(db, opts.company_id, 'cogs'),
      resolveControlAccount(db, opts.company_id, 'wages_payable'),
    ])
    if (!cogsCode)    throw new Error('GL_MAPPING_MISSING: حساب التكلفة (cogs) غير مربوط.')
    if (!payableCode) throw new Error('GL_MAPPING_MISSING: حساب الأجور المستحقة (wages_payable) غير مربوط.')

    const blueprint = await peResolveWorkOrderLabor(
      db, opts.company_id,
      cogsCode, payableCode,
      opts.amount, opts.description,
      { 
        center_code: opts.center_code ?? undefined,
        season_id:   opts.season_id   ?? undefined,
        field_id:    opts.field_id    ?? undefined
      }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'work_order_labor',
      source_module: 'operations',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: { ...opts },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'payroll',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * resolveContractAdvance
   * DR Cash / CR Deferred Revenue
   */
  async resolveContractAdvance(
    db: D1Database,
    opts: {
      company_id:   number
      ref_id:       number
      amount:       number
      date:         string
      description:  string
      created_by?:  number
    }
  ): Promise<number | null> {
    const [cashCode, deferredCode] = await Promise.all([
      resolveControlAccount(db, opts.company_id, 'cash'),
      resolveControlAccount(db, opts.company_id, 'deferred_revenue'),
    ])
    if (!cashCode) throw new Error('GL_MAPPING_MISSING: حساب الخزينة (cash) غير مربوط.')
    
    // Fallback to accounts_receivable/payable if deferred_revenue is missing?
    // Usually contract advances are liabilities, so fallback to AP is safer than nothing.
    const finalDeferred = deferredCode || await resolveControlAccount(db, opts.company_id, 'accounts_payable')
    if (!finalDeferred) throw new Error('GL_MAPPING_MISSING: حساب الإيرادات المقدمة (deferred_revenue) غير مربوط.')

    const blueprint = await peResolveContractAdvance(
      db, opts.company_id,
      cashCode, finalDeferred,
      opts.amount, opts.description
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'contract_advance',
      source_module: 'sales',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: { ...opts },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'adjustment',
        source_record_id: opts.ref_id,
      })),
    })
  },

  async processPOReceipt(
    db: D1Database,
    opts: {
      company_id:     number
      userId:         number
      po_id:          number
      received_date:  string
      supplier_code?: number
      items: Array<{
        po_item_id:   number
        item_code:    number
        item_name:    string
        qty_received: number
        unit_price:   number
        warehouse:    string
      }>
    }
  ) {
    const periodId = await getOpenPeriod(db, opts.company_id, opts.received_date)
    if (!periodId) throw new Error(`PERIOD_CLOSED: No open period for ${opts.received_date}`)

    const apAccCode = await resolveControlAccount(db, opts.company_id, 'accounts_payable')
    if (!apAccCode) throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')

    const stmts: D1PreparedStatement[] = []
    const batchKey = `po_rcv_${Date.now()}`
    let totalValue = 0

    // FIX: Track running balances per item+warehouse WITHIN this batch
    // so that multiple items of the same SKU in one PO don't use the same starting balance
    const runningBal = new Map<string, { qty: number; val: number }>()

    for (let i = 0; i < opts.items.length; i++) {
      const item  = opts.items[i]
      const bwKey = `${item.item_code}:${item.warehouse}`

      let prevQty: number
      let prevVal: number

      if (runningBal.has(bwKey)) {
        const cur = runningBal.get(bwKey)!
        prevQty = cur.qty
        prevVal = cur.val
      } else {
        const lastBal = await db.prepare(
          `SELECT balance_qty, balance_value FROM inventory_movements
           WHERE company_id = ? AND item_code = ? AND warehouse = ?
           ORDER BY movement_date DESC, id DESC LIMIT 1`
        ).bind(opts.company_id, item.item_code, item.warehouse).first<{ balance_qty: number; balance_value: number }>()
        prevQty = lastBal?.balance_qty ?? 0
        prevVal = lastBal?.balance_value ?? 0
      }

      const valIn    = item.qty_received * item.unit_price
      const newQty   = prevQty + item.qty_received
      const newVal   = prevVal + valIn
      totalValue    += valIn
      const localId  = `${batchKey}_itm_${i}`

      runningBal.set(bwKey, { qty: newQty, val: newVal })

      stmts.push(db.prepare(
        `INSERT INTO inventory_movements
         (company_id, item_code, movement_date, warehouse, movement_type, quantity, unit_price,
          qty_in, qty_out, balance_qty, value_in, value_out, balance_value, notes, created_by_user_id, local_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(opts.company_id, item.item_code, opts.received_date, item.warehouse, 'اضافة',
        item.qty_received, item.unit_price, item.qty_received, 0, newQty, valIn, 0, newVal,
        `استلام PO #${opts.po_id}`, opts.userId, localId))

      stmts.push(db.prepare(
        `UPDATE purchase_order_items SET qty_received = qty_received + ? WHERE id = ?`
      ).bind(item.qty_received, item.po_item_id))
    }

    // Supplier statement
    if (opts.supplier_code && totalValue > 0) {
      stmts.push(db.prepare(
        `INSERT INTO supplier_transactions
         (company_id, supplier_code, transaction_date, entry_type, document_type, document_number,
          notes, amount, credit, debit, status, created_by_user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(opts.company_id, opts.supplier_code, opts.received_date, 'د', 'purchase_order', opts.po_id,
        `فاتورة استلام طلب شراء #${opts.po_id}`, totalValue, totalValue, 0, 'posted', opts.userId))
    }

    // Update PO status
    stmts.push(db.prepare(`
      UPDATE purchase_orders
      SET status = CASE
        WHEN (SELECT MIN(qty_ordered - qty_received) FROM purchase_order_items WHERE po_id = ?) <= 0
          THEN 'received' ELSE 'partial' END,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(opts.po_id, opts.po_id))

    await db.batch(stmts)

    // GL Posting via Unified Engine
    const { results: inserted } = await db.prepare(
      `SELECT id, item_code, local_id FROM inventory_movements
       WHERE company_id = ? AND local_id LIKE ? ORDER BY id ASC`
    ).bind(opts.company_id, `${batchKey}_itm_%`).all<{ id: number; item_code: number; local_id: string }>()

    for (const ins of inserted) {
      const idx = Number(ins.local_id.split('_')[3])
      const item = opts.items[idx]
      await this.resolvePurchaseReceipt(db, {
        company_id: opts.company_id,
        ref_id: ins.id,
        item_code: ins.item_code,
        warehouse: item.warehouse,
        amount: item.qty_received * item.unit_price,
        date: opts.received_date,
        item_name: item.item_name,
        created_by: opts.userId
      })
    }

    return { success: true, movements: opts.items.length, status: 'partial' }
  },

  /**
   * Posts GL entries for Harvest (Revenue and COGS).
   * USES 'CANCEL-AND-REPOST' PATTERN for maximum reliability over 'Delta' logic.
   */
  async postHarvestLedger(
    db: D1Database,
    opts: {
      company_id: number
      userId: number
      harvest_id: number
      harvest_date: string
      crop_name: string
      field_name: string
      center_code?: number | null
      total_revenue: number
      total_actual_cost: number
      season_id?: number | null
      field_id: number
    },
  ): Promise<{ revenue_entry_id: number | null; cost_entry_id: number | null }> {
    const harvestModule = await db.prepare(
      'SELECT is_enabled FROM gl_integration_settings WHERE company_id = ? AND module_key = ?'
    ).bind(opts.company_id, 'harvest').first<{ is_enabled: number }>()
    if (harvestModule && harvestModule.is_enabled !== 1) {
      return { revenue_entry_id: null, cost_entry_id: null }
    }

    const periodId = await getOpenPeriod(db, opts.company_id, opts.harvest_date)
    if (!periodId) {
      throw new Error(`PERIOD_CLOSED: لا توجد فترة مالية مفتوحة للتاريخ ${opts.harvest_date}`)
    }

    // 1. VOID PREVIOUS ENTRIES linked to this harvest_id to prevent duplication
    // We use DELETE here because 'journal_entries' schema lacks a 'status' column and uses ON DELETE CASCADE for lines.
    await db.prepare(
      "DELETE FROM journal_entries WHERE company_id = ? AND ref_type IN ('harvest_revenue', 'harvest_cogs') AND ref_id = ?"
    ).bind(opts.company_id, opts.harvest_id).run()

    const receivableCode = await resolveControlAccount(db, opts.company_id, 'receivable_default')

    let revenueEntryId: number | null = null
    let costEntryId: number | null = null

    // 3. Post Revenue (DR Cash/AR, CR Revenue)
    if (opts.total_revenue > 0) {
      const receivableAcc = receivableCode
      if (!receivableAcc) throw new Error('GL_MAPPING_MISSING: يجب تحديد حساب (العملاء/الصندوق) في الإعدادات أولاً.')
      const revBlueprint = await peResolveSalesRevenue(
        db, opts.company_id, null, null,
        receivableAcc,
        opts.total_revenue,
        `إيراد حصاد ${opts.crop_name}`,
        { center_code: opts.center_code ?? undefined, season_id: opts.season_id ?? undefined, field_id: opts.field_id }
      )
      if (revBlueprint.isBlocked) {
        throw new Error(`POSTING_ENGINE_BLOCKED: ${revBlueprint.validationErrors.join('; ')}`)
      }
      revenueEntryId = await postFromBusinessEvent(db, {
        company_id: opts.company_id,
        event_type: 'harvest_revenue',
        source_module: 'harvest',
        source_id: opts.harvest_id,
        event_date: opts.harvest_date,
        description: `إيراد حصاد: ${opts.crop_name} - ${opts.field_name}`,
        created_by: opts.userId,
        payload: {
          harvest_id: opts.harvest_id,
          crop_name: opts.crop_name,
          field_name: opts.field_name,
          total_revenue: opts.total_revenue,
        },
        lines: revBlueprint.lines,
      })
    }

    // 4. Post COGS (DR Expense/COGS, CR Inventory)
    if (opts.total_actual_cost > 0) {
      const cogsBlueprint = await peResolveInventory(
        db, opts.company_id, null, null,
        opts.total_actual_cost, false,
        `تكلفة حصاد ${opts.crop_name}`,
        { center_code: opts.center_code ?? undefined, season_id: opts.season_id ?? undefined, field_id: opts.field_id }
      )
      if (cogsBlueprint.isBlocked) {
        throw new Error(`POSTING_ENGINE_BLOCKED: ${cogsBlueprint.validationErrors.join('; ')}`)
      }
      costEntryId = await postFromBusinessEvent(db, {
        company_id: opts.company_id,
        event_type: 'harvest_cogs',
        source_module: 'harvest',
        source_id: opts.harvest_id,
        event_date: opts.harvest_date,
        description: `تكلفة حصاد: ${opts.crop_name} - ${opts.field_name}`,
        created_by: opts.userId,
        payload: {
          harvest_id: opts.harvest_id,
          crop_name: opts.crop_name,
          field_name: opts.field_name,
          total_actual_cost: opts.total_actual_cost,
        },
        lines: cogsBlueprint.lines,
      })
    }

    return { revenue_entry_id: revenueEntryId, cost_entry_id: costEntryId }
  },

  // ============================================================================
  // POSTING ENGINE BRIDGE FUNCTIONS
  // All routes now use posting_engine.ts with posting-group cascade lookup.
  // posting_rules is the single source of truth for control and setup resolution.
  // ============================================================================

  /**
   * resolveInventoryMovement
   * Inventory stock movement GL poster via posting_engine.
   */
  async resolveInventoryMovement(
    db: D1Database,
    opts: {
      company_id:      number
      ref_id:          number
      item_code:       number
      warehouse:       string
      movement_type:   string   // 'اضافة' | 'صرف'
      value:           number
      date:            string
      item_name:       string
      created_by?:     number
      center_code?:    number
      supplier_code?:  number | null
      payment_method?: 'cash' | 'credit'
      work_order_id?:  number
    }
  ): Promise<number | null> {
    const [itemRow, whRow] = await Promise.all([
      db.prepare('SELECT prod_posting_group_code FROM items WHERE code = ? AND company_id = ?')
        .bind(opts.item_code, opts.company_id).first<{ prod_posting_group_code: string | null }>(),
      db.prepare('SELECT inv_posting_group_code FROM warehouses WHERE name = ? AND company_id = ?')
        .bind(opts.warehouse, opts.company_id).first<{ inv_posting_group_code: string | null }>(),
    ])
    const isIncrease = opts.movement_type === 'اضافة'
    
    // Resolve blueprint
    const blueprint = await peResolveInventory(
      db, opts.company_id,
      whRow?.inv_posting_group_code  ?? null,
      itemRow?.prod_posting_group_code ?? null,
      opts.value, isIncrease, opts.item_name,
      { center_code: opts.center_code }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }

    // ENFORCE TWO-LEG CONTRACT: For receipts ('اضافة'), always credit Accounts Payable
    // even if the posting engine suggests 'purchases_account', to ensure supplier parity.
    if (isIncrease) {
      const apCode = await resolveControlAccount(db, opts.company_id, 'accounts_payable')
      if (!apCode) throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')
      
      blueprint.lines.forEach(line => {
        if (line.credit > 0 && line.rule_slot === 'purchases_account') {
          line.account_code = apCode
          line.rule_slot = 'accounts_payable'
        }
      })
    }

    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'inventory_movement',
      source_module: 'inventory',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.item_name,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: {
        item_code: opts.item_code,
        warehouse: opts.warehouse,
        movement_type: opts.movement_type,
        value: opts.value,
        supplier_code: opts.supplier_code ?? null,
        payment_method: opts.payment_method ?? 'credit'
      },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'inventory',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * resolveInventoryTransfer
   * Inventory stock transfer GL poster via posting_engine.
   */
  async resolveInventoryTransfer(
    db: D1Database,
    opts: {
      company_id:     number
      ref_id:         number
      item_code:      number
      from_warehouse: string
      to_warehouse:   string
      value:          number
      date:           string
      item_name:      string
      created_by?:    number
    }
  ): Promise<number | null> {
    const [itemRow, srcWh, dstWh] = await Promise.all([
      db.prepare('SELECT prod_posting_group_code FROM items WHERE code = ? AND company_id = ?')
        .bind(opts.item_code, opts.company_id).first<{ prod_posting_group_code: string | null }>(),
      db.prepare('SELECT inv_posting_group_code FROM warehouses WHERE name = ? AND company_id = ?')
        .bind(opts.from_warehouse, opts.company_id).first<{ inv_posting_group_code: string | null }>(),
      db.prepare('SELECT inv_posting_group_code FROM warehouses WHERE name = ? AND company_id = ?')
        .bind(opts.to_warehouse, opts.company_id).first<{ inv_posting_group_code: string | null }>(),
    ])

    const blueprint = await peResolveTransfer(
      db, opts.company_id,
      srcWh?.inv_posting_group_code ?? null,
      dstWh?.inv_posting_group_code ?? null,
      itemRow?.prod_posting_group_code ?? null,
      opts.value, opts.item_name
    )

    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }

    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'inventory_transfer',
      source_module: 'inventory',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: `تحويل مخزني: ${opts.item_name} (${opts.from_warehouse} → ${opts.to_warehouse})`,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: {
        item_code: opts.item_code,
        from_warehouse: opts.from_warehouse,
        to_warehouse: opts.to_warehouse,
        value: opts.value,
      },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'inventory',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * resolveCashLedger
   * Treasury GL poster via posting_engine.
   */
  async resolveCashLedger(
    db: D1Database,
    opts: {
      company_id:     number
      ref_id:         number
      amount:         number
      direction:      'د' | 'م'
      date:           string
      narration:      string
      financial_account_id?: number | null
      contraAccount?: string | null
      expense_code?:  string | null
      supplier_code?: number | null
      partner_id?:    number | null
      center_code?:   number | null
      created_by?:    number
    }
  ): Promise<number | null> {
    let cashAccCode = ''
    if (opts.financial_account_id) {
      const accInfo = await db.prepare("SELECT gl_account_code FROM bank_accounts WHERE id = ?")
        .bind(opts.financial_account_id).first<{ gl_account_code: string }>()
      cashAccCode = accInfo?.gl_account_code || ''
    }
    if (!cashAccCode) {
      const resolvedCash = await resolveControlAccount(db, opts.company_id, 'cash')
      cashAccCode = resolvedCash || ''
    }

    let contraAcc = opts.contraAccount
    if (!contraAcc) {
      if (opts.expense_code) {
        const et = await db.prepare("SELECT gl_account_code FROM expense_types WHERE code = ? AND company_id = ?")
          .bind(opts.expense_code, opts.company_id).first<{gl_account_code: string}>()
        if (et?.gl_account_code) contraAcc = et.gl_account_code
      }
      if (!contraAcc) {
        const key = opts.partner_id
          ? 'partner_current_account'
          : opts.supplier_code
          ? 'accounts_payable'
          : (opts.direction === 'د' ? 'revenue_default' : 'expense_default')
        contraAcc = await resolveControlAccount(db, opts.company_id, key)
      }
    }

    if (!cashAccCode) throw new Error('GL_MAPPING_MISSING: حساب الخزينة غير مربوط.')
    if (!contraAcc) throw new Error('GL_MAPPING_MISSING: حساب المقابل غير مربوط.')

    const blueprint = await peResolveCash(
      db, opts.company_id,
      cashAccCode, contraAcc,
      opts.amount, opts.direction === 'د',
      opts.narration,
      { center_code: opts.center_code ?? undefined }
    )

    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }

    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'cash_transaction',
      source_module: 'treasury',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.narration,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: { direction: opts.direction, amount: opts.amount },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'cash',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * postManualEntry
   * Direct manual GL entry via business_event.
   */
  async postManualEntry(
    db: D1Database,
    opts: {
      company_id: number
      date:       string
      description: string
      lines:      EventBackedPostOpts['lines']
      created_by?: number
    }
  ): Promise<number | null> {
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'manual_entry',
      source_module: 'gl',
      source_id: 0,
      event_date: opts.date,
      description: opts.description,
      payload: { lines_count: opts.lines.length },
      lines: opts.lines,
      created_by: opts.created_by,
      trace: { rule_type: 'manual_entry' } as any
    })
  },

  /**
   * postManualReversal
   * Reverses an existing entry via business_event.
   */
  async postManualReversal(
    db: D1Database,
    opts: {
      company_id: number
      original_entry_id: number
      date:       string
      reason:     string
      lines:      EventBackedPostOpts['lines']
      created_by?: number
    }
  ): Promise<number | null> {
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'manual_reversal',
      source_module: 'gl',
      source_id: opts.original_entry_id,
      event_date: opts.date,
      description: `عكس القيد #${opts.original_entry_id}: ${opts.reason}`,
      payload: { original_entry_id: opts.original_entry_id, reason: opts.reason },
      lines: opts.lines,
      created_by: opts.created_by,
      trace: { rule_type: 'manual_reversal', original_entry_id: opts.original_entry_id } as any
    })
  },

  /**
   * resolvePurchaseReceipt
   * PO receipt GL poster via posting_engine.
   */
  async resolvePurchaseReceipt(
    db: D1Database,
    opts: {
      company_id:     number
      ref_id:         number
      item_code:      number
      warehouse:      string
      amount:         number
      date:           string
      item_name:      string
      created_by?:    number
    }
  ): Promise<number | null> {
    const [itemRow, whRow, apCode] = await Promise.all([
      db.prepare('SELECT prod_posting_group_code FROM items WHERE code = ? AND company_id = ?')
        .bind(opts.item_code, opts.company_id).first<{ prod_posting_group_code: string | null }>(),
      db.prepare('SELECT inv_posting_group_code FROM warehouses WHERE name = ? AND company_id = ?')
        .bind(opts.warehouse, opts.company_id).first<{ inv_posting_group_code: string | null }>(),
      resolveControlAccount(db, opts.company_id, 'accounts_payable'),
    ])

    if (!apCode) throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')

    const blueprint = await peResolvePurchaseReceipt(
      db, opts.company_id,
      whRow?.inv_posting_group_code ?? null,
      itemRow?.prod_posting_group_code ?? null,
      apCode, opts.amount, opts.item_name
    )

    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }

    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'purchase_receipt',
      source_module: 'inventory',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: `استلام طلب شراء: ${opts.item_name} (مخزن: ${opts.warehouse})`,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: {
        item_code: opts.item_code,
        warehouse: opts.warehouse,
        amount: opts.amount,
      },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'inventory',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * resolveSupplierInvoice
   * Supplier invoice GL poster via posting_engine.
   */
  async resolveSupplierInvoice(
    db: D1Database,
    opts: {
      company_id:    number
      ref_id:        number
      supplier_code?: number | null
      amount:        number
      date:          string
      description:   string
      created_by?:   number
    }
  ): Promise<number | null> {
    const supplierRow = opts.supplier_code == null
      ? null
      : await db
        .prepare('SELECT bus_posting_group_code FROM suppliers WHERE code = ? AND company_id = ?')
        .bind(opts.supplier_code, opts.company_id)
        .first<{ bus_posting_group_code: string | null }>()
    const apCode = await resolveControlAccount(db, opts.company_id, 'accounts_payable')
    if (!apCode) {
      throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')
    }
    const blueprint = await peResolveSupplierInvoice(
      db, opts.company_id,
      supplierRow?.bus_posting_group_code ?? null,
      null,
      apCode,
      opts.amount, opts.description
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'supplier_invoice',
      source_module: 'suppliers',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: {
        supplier_code: opts.supplier_code ?? null,
        amount: opts.amount,
      },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'supplier',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * resolveSupplierPayment
   * Supplier cash payment GL poster via posting_engine.
   */
  async resolveSupplierPayment(
    db: D1Database,
    opts: {
      company_id:    number
      ref_id:        number
      amount:        number
      date:          string
      description:   string
      created_by?:   number
      center_code?:  number
      supplier_code?: number | null
      financial_account_id?: number | null
    }
  ): Promise<number | null> {
    const [apCode, cashCode] = await Promise.all([
      resolveControlAccount(db, opts.company_id, 'accounts_payable'),
      resolveControlAccount(db, opts.company_id, 'cash'),
    ])
    if (!apCode)   throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')
    if (!cashCode) throw new Error('GL_MAPPING_MISSING: حساب الخزينة (cash) غير مربوط.')

    const blueprint = await peResolveSupplierPayment(
      db, opts.company_id,
      apCode, cashCode,
      opts.amount, opts.description,
      { center_code: opts.center_code }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    
    // 1. Post to GL
    const entryId = await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'supplier_payment',
      source_module: 'suppliers',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: {
        supplier_code: opts.supplier_code ?? null,
        amount: opts.amount,
      },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'supplier',
        source_record_id: opts.ref_id,
      })),
    })

    // 2. Maintain Treasury Parity (Sync)
    try {
      const { stmts, batchKey } = await this.prepareCashMovement(db, {
        company_id: opts.company_id,
        userId: opts.created_by ?? 0,
        transaction_date: opts.date,
        direction: 'م',
        amount: opts.amount,
        narration: opts.description,
        supplier_code: opts.supplier_code,
        center_code: opts.center_code,
        financial_account_id: opts.financial_account_id,
        status: 'posted',
        skipSupplierMirror: true // Already handled by the caller (suppliers module)
      })
      await db.batch(stmts)
      if (entryId) {
        await db.prepare('UPDATE cash_transactions SET journal_entry_id = ? WHERE local_id = ? AND company_id = ?')
          .bind(entryId, batchKey, opts.company_id).run()
      }
    } catch (err: any) {
      console.error('TREASURY_SYNC_FAILED in resolveSupplierPayment:', err.message)
      // We don't throw here to avoid rolling back GL if treasury sync fails, 
      // but in a strict system we might want to.
    }

    return entryId
  },

  /**
   * resolveExpensePosting
   * General expense GL poster via posting_engine.
   */
  async resolveExpensePosting(
    db: D1Database,
    opts: {
      company_id:      number
      ref_id:          number
      amount:          number
      date:            string
      description:     string
      created_by?:     number
      center_code?:    number
      expense_account?: string   // direct override, bypasses mapping lookup
    }
  ): Promise<number | null> {
    const cashCode = await resolveControlAccount(db, opts.company_id, 'cash')
    if (!cashCode) throw new Error('GL_MAPPING_MISSING: حساب الخزينة (cash) غير مربوط.')

    const blueprint = await peResolveExpense(
      db, opts.company_id, null, null,
      cashCode, opts.amount,
      opts.expense_account,
      opts.description,
      { center_code: opts.center_code }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'expense',
      source_module: 'treasury',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: {
        amount: opts.amount,
        expense_account: opts.expense_account ?? null,
      },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'cash',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * resolveSalesRevenue
   * Sales / harvest revenue GL poster via posting_engine.
   */
  async resolveSalesRevenue(
    db: D1Database,
    opts: {
      company_id:   number
      ref_id:       number
      amount:       number
      date:         string
      description:  string
      created_by?:  number
      center_code?: number
      season_id?:   number
      field_id?:    number
    }
  ): Promise<number | null> {
    const receivableCode = await resolveControlAccount(db, opts.company_id, 'receivable_default')
    if (!receivableCode) throw new Error('GL_MAPPING_MISSING: حساب المدينين (receivable_default) غير مربوط.')

    const blueprint = await peResolveSalesRevenue(
      db, opts.company_id, null, null,
      receivableCode, opts.amount,
      opts.description,
      { center_code: opts.center_code, season_id: opts.season_id, field_id: opts.field_id }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'revenue',
      source_module: 'sales',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: {
        amount: opts.amount,
        center_code: opts.center_code ?? null,
        season_id: opts.season_id ?? null,
        field_id: opts.field_id ?? null,
      },
      lines: blueprint.lines.map(l => ({
        ...l,
        source_ledger: 'harvest',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * resolvePayrollPosting
   * Payroll GL poster via posting_engine.
   */
  async resolvePayrollPosting(
    db: D1Database,
    opts: {
      company_id:  number
      ref_id:      number
      amount:      number
      date:        string
      description: string
      created_by?: number
      center_code?: number
      season_id?:   number | null
      field_id?:    number | null
    }
  ): Promise<number | null> {
    const [wagesCode, payableCode] = await Promise.all([
      resolveControlAccount(db, opts.company_id, 'wages'),
      resolveControlAccount(db, opts.company_id, 'wages_payable'),
    ])
    if (!wagesCode)   throw new Error('GL_MAPPING_MISSING: حساب الأجور (wages) غير مربوط.')
    if (!payableCode) throw new Error('GL_MAPPING_MISSING: حساب الأجور المستحقة (wages_payable) غير مربوط.')

    const blueprint = await peResolvePayroll(
      db, opts.company_id,
      wagesCode, payableCode,
      opts.amount, opts.description,
      { 
        center_code: opts.center_code ?? undefined,
        season_id:   opts.season_id   ?? undefined,
        field_id:    opts.field_id    ?? undefined
      }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'payroll_run',
      source_module: 'hr',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      created_by: opts.created_by,
      trace: blueprint.trace,
      payload: { ...opts },
      lines: blueprint.lines.map(l => ({
        ...l,
        center_code: l.center_code ?? opts.center_code ?? undefined,
        season_id:   l.season_id   ?? opts.season_id   ?? undefined,
        field_id:    l.field_id    ?? opts.field_id    ?? undefined,
        source_ledger: 'payroll',
        source_record_id: opts.ref_id,
      })),
    })
  },

  /**
   * resolvePayrollPayment
   * Salary disbursement: DR Wages Payable / CR Cash
   */
  async resolvePayrollPayment(
    db: D1Database,
    opts: {
      company_id:  number
      ref_id:      number
      amount:      number
      date:        string
      description: string
      created_by?: number
    }
  ): Promise<number | null> {
    const [payableCode, cashCode] = await Promise.all([
      resolveControlAccount(db, opts.company_id, 'wages_payable'),
      resolveControlAccount(db, opts.company_id, 'cash'),
    ])
    if (!payableCode) throw new Error('GL_MAPPING_MISSING: حساب الأجور المستحقة (wages_payable) غير مربوط.')
    if (!cashCode)    throw new Error('GL_MAPPING_MISSING: حساب الصندوق (cash) غير مربوط.')
    if (opts.amount <= 0) return null

    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'payroll_payment',
      source_module: 'hr',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      created_by: opts.created_by,
      payload: {
        amount: opts.amount,
      },
      lines: [
        { account_code: payableCode, debit: opts.amount, credit: 0,           description: opts.description, source_ledger: 'payroll', source_record_id: opts.ref_id },
        { account_code: cashCode,    debit: 0,           credit: opts.amount, description: opts.description, source_ledger: 'payroll', source_record_id: opts.ref_id },
      ],
    })
  },

  /**
   * resolvePartnerCapital
   * Partner capital injection/withdrawal: DR/CR Cash ↔ Equity
   */
  async resolvePartnerCapital(
    db: D1Database,
    opts: {
      company_id:  number
      ref_id:      number
      delta:       number   // positive = injection, negative = withdrawal
      date:        string
      description: string
      created_by?: number
    }
  ): Promise<number | null> {
    if (Math.abs(opts.delta) < 0.01) return null
    const [cashCode, equityCode] = await Promise.all([
      resolveControlAccount(db, opts.company_id, 'cash'),
      resolveControlAccount(db, opts.company_id, 'equity'),
    ])
    if (!cashCode)   throw new Error('GL_MAPPING_MISSING: حساب الصندوق (cash) غير مربوط.')
    if (!equityCode) throw new Error('GL_MAPPING_MISSING: حساب رأس المال (equity) غير مربوط.')
    const abs = Math.abs(opts.delta)
    const lines = opts.delta > 0
      ? [
          { account_code: cashCode,   debit: abs, credit: 0,   description: opts.description },
          { account_code: equityCode, debit: 0,   credit: abs, description: opts.description },
        ]
      : [
          { account_code: equityCode, debit: abs, credit: 0,   description: opts.description },
          { account_code: cashCode,   debit: 0,   credit: abs, description: opts.description },
        ]
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'partner_capital',
      source_module: 'treasury',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      payload: { delta: opts.delta },
      lines: lines.map(l => ({
        ...l,
        source_ledger: 'manual',
        source_record_id: opts.ref_id,
      })),
      created_by: opts.created_by,
    })
  },

  /**
   * resolvePartnerCurrent
   * Partner current account deposit/withdrawal: DR/CR Cash ↔ Partner Current Account
   */
  async resolvePartnerCurrent(
    db: D1Database,
    opts: {
      company_id:       number
      ref_id:           number
      delta:            number   // positive = deposit, negative = withdrawal
      date:             string
      description:      string
      created_by?:      number
    }
  ): Promise<number | null> {
    if (Math.abs(opts.delta) < 0.01) return null
    const [cashCode, currentCode, equityCode] = await Promise.all([
      resolveControlAccount(db, opts.company_id, 'cash'),
      resolveControlAccount(db, opts.company_id, 'partner_current_account').catch(() => null),
      resolveControlAccount(db, opts.company_id, 'equity').catch(() => null),
    ])
    if (!cashCode) throw new Error('GL_MAPPING_MISSING: حساب الصندوق (cash) غير مربوط.')
    const currentAcctCode = currentCode ?? equityCode
    if (!currentAcctCode) throw new Error('GL_MAPPING_MISSING: حساب الشريك الجاري (partner_current_acct) غير مربوط.')
    const abs = Math.abs(opts.delta)
    const lines = opts.delta > 0
      ? [
          { account_code: cashCode,        debit: abs, credit: 0,   description: opts.description },
          { account_code: currentAcctCode,       debit: 0,   credit: abs, description: opts.description },
        ]
      : [
          { account_code: currentAcctCode,       debit: abs, credit: 0,   description: opts.description },
          { account_code: cashCode,        debit: 0,   credit: abs, description: opts.description },
        ]
    return await postFromBusinessEvent(db, {
      company_id: opts.company_id,
      event_type: 'partner_current',
      source_module: 'treasury',
      source_id: opts.ref_id,
      event_date: opts.date,
      description: opts.description,
      payload: { delta: opts.delta },
      lines: lines.map(l => ({
        ...l,
        source_ledger: 'manual',
        source_record_id: opts.ref_id,
      })),
      created_by: opts.created_by,
    })
  },

  /**
   * carryForwardWIP
   * When closing a season, identify uncompleted crops and carry forward their costs.
   * Finds fields with work_tasks cost but no harvest_records, then:
   * 1. Creates wip_balances records
   * 2. Posts GL entry: DR WIP Asset / CR WIP Contra
   * Returns list of WIP entries created.
   */
  async carryForwardWIP(
    db: D1Database,
    opts: {
      company_id: number
      season_id: number
      user_id: number
    }
  ): Promise<Array<{ field_id: number; crop_name: string; cost_balance: number }>> {
    const wipAssetCode = await resolveControlAccount(db, opts.company_id, 'wip_asset')
    const wipContraCode = await resolveControlAccount(db, opts.company_id, 'wip_contra')
    if (!wipAssetCode) throw new Error('GL_MAPPING_MISSING: حساب WIP (wip_asset) غير مربوط.')
    if (!wipContraCode) throw new Error('GL_MAPPING_MISSING: حساب WIP مقابل (wip_contra) غير مربوط.')

    // Find unfinished crops: fields with work_tasks cost but no harvest_records
    const unfinishedCrops = await db.prepare(`
      SELECT
        f.id as field_id,
        f.name as field_name,
        COALESCE(f.current_crop, 'محصول') as crop_name,
        COALESCE(SUM(wt.quantity * wt.unit_cost), 0) as labor_cost,
        COALESCE(
          (SELECT SUM(amount) FROM cash_transactions ct
           WHERE ct.company_id = ? AND ct.season_id = ? AND ct.field_id = f.id),
          0
        ) as cash_cost
      FROM fields f
      LEFT JOIN work_orders wo ON wo.field_id = f.id AND wo.company_id = f.company_id AND wo.season_id = ?
      LEFT JOIN work_tasks wt ON wt.work_order_id = wo.id
      WHERE f.company_id = ? AND f.is_active = 1
      GROUP BY f.id
      HAVING (labor_cost > 0 OR cash_cost > 0)
        AND NOT EXISTS (
          SELECT 1 FROM harvest_records hr
          WHERE hr.field_id = f.id AND hr.season_id = ? AND hr.company_id = ?
        )
    `).bind(
      opts.company_id, opts.season_id, opts.season_id,
      opts.company_id,
      opts.season_id, opts.company_id
    ).all<{
      field_id: number
      field_name: string
      crop_name: string
      labor_cost: number
      cash_cost: number
    }>()

    const wipEntries: Array<{ field_id: number; crop_name: string; cost_balance: number }> = []

    if (!unfinishedCrops.results || unfinishedCrops.results.length === 0) {
      return wipEntries
    }

    let totalWipCost = 0
    const wipRecordStmts: ReturnType<typeof db.prepare>[] = []

    // Create wip_balances records for each unfinished crop
    for (const crop of unfinishedCrops.results) {
      const totalCost = crop.labor_cost + crop.cash_cost
      totalWipCost += totalCost

      wipRecordStmts.push(
        db.prepare(`
          INSERT INTO wip_balances (company_id, from_season_id, field_id, crop_name, cost_balance, created_by, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).bind(
          opts.company_id,
          opts.season_id,
          crop.field_id,
          crop.crop_name,
          totalCost,
          opts.user_id
        )
      )

      wipEntries.push({
        field_id: crop.field_id,
        crop_name: crop.crop_name,
        cost_balance: totalCost,
      })
    }

    // Batch insert WIP records
    if (wipRecordStmts.length > 0) {
      await db.batch(wipRecordStmts)
    }

    // If there's total WIP cost > 0, post GL entry
    if (totalWipCost > 0.01) {
      const glLines = [
        { account_code: wipAssetCode, debit: totalWipCost, credit: 0, description: `حمل WIP من موسم ${opts.season_id}`, source_ledger: 'manual' as const, source_record_id: opts.season_id },
        { account_code: wipContraCode, debit: 0, credit: totalWipCost, description: `حمل WIP من موسم ${opts.season_id}`, source_ledger: 'manual' as const, source_record_id: opts.season_id },
      ]

      const entryId = await postFromBusinessEvent(db, {
        company_id: opts.company_id,
        event_type: 'wip_carryforward',
        source_module: 'gl',
        source_id: opts.season_id,
        event_date: new Date().toISOString().slice(0, 10),
        description: `حمل WIP من الموسم ${opts.season_id}`,
        created_by: opts.user_id,
        payload: {
          season_id: opts.season_id,
          total_wip_cost: totalWipCost,
          rows_count: wipEntries.length,
        },
        lines: glLines,
      })

      // Link WIP records to the GL entry
      if (entryId) {
        await db.prepare(`
          UPDATE wip_balances
          SET journal_entry_id = ?, status = 'carried'
          WHERE company_id = ? AND from_season_id = ? AND status = 'pending'
        `).bind(entryId, opts.company_id, opts.season_id).run()
      }
    }

    return wipEntries
  },

  /**
   * postMonthlyDepreciation
   * Calculate and post depreciation for all active fixed assets for a given period.
   * Posts GL entry: DR Depreciation Expense / CR Accumulated Depreciation
   * Returns list of assets depreciated.
   */
  async postMonthlyDepreciation(
    db: D1Database,
    opts: {
      company_id: number
      period_year: number
      period_month: number
      user_id: number
    }
  ): Promise<Array<{ asset_id: number; asset_code: string; amount: number; journal_entry_id: number | null }>> {
    const expenseCode = await resolveControlAccount(db, opts.company_id, 'depreciation_expense')
    const accumulatedCode = await resolveControlAccount(db, opts.company_id, 'accumulated_depreciation')
    if (!expenseCode) throw new Error('GL_MAPPING_MISSING: حساب مصروف الاستهلاك (depreciation_expense) غير مربوط.')
    if (!accumulatedCode) throw new Error('GL_MAPPING_MISSING: حساب الاستهلاك المتراكم (accumulated_depreciation) غير مربوط.')

    const result: Array<{ asset_id: number; asset_code: string; amount: number; journal_entry_id: number | null }> = []

    // Get all active assets
    const assets = await db.prepare(`
      SELECT id, asset_code, cost, salvage_value, useful_life_months, depreciation_method, acquisition_date
      FROM fixed_assets
      WHERE company_id = ? AND is_active = 1
    `).bind(opts.company_id).all<{
      id: number
      asset_code: string
      cost: number
      salvage_value: number
      useful_life_months: number
      depreciation_method: string
      acquisition_date: string
    }>()

    if (!assets.results || assets.results.length === 0) {
      return result
    }

    let totalDepreciation = 0
    const updateStmts: ReturnType<typeof db.prepare>[] = []

    for (const asset of assets.results) {
      // Check if acquisition date is before or during the period
      const acqDate = new Date(asset.acquisition_date)
      const periodDate = new Date(`${opts.period_year}-${String(opts.period_month).padStart(2, '0')}-01`)
      if (acqDate > periodDate) {
        // Asset not yet acquired in this period, skip
        continue
      }

      // Check if schedule row already exists (idempotent)
      const existing = await db.prepare(`
        SELECT id, status FROM depreciation_schedules
        WHERE asset_id = ? AND period_year = ? AND period_month = ?
      `).bind(asset.id, opts.period_year, opts.period_month).first<{ id: number; status: string }>()

      if (existing && existing.status === 'posted') {
        // Already posted, skip
        continue
      }

      // Calculate depreciation based on method
      let monthlyAmount = 0
      if (asset.depreciation_method === 'straight_line') {
        monthlyAmount = (asset.cost - asset.salvage_value) / asset.useful_life_months
      } else if (asset.depreciation_method === 'declining_balance') {
        // Declining balance: book_value * (2 / useful_life_months)
        // For simplicity, use cost first month, then look up accumulated
        const accumulated = await db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total FROM depreciation_schedules
          WHERE asset_id = ? AND status = 'posted'
        `).bind(asset.id).first<{ total: number }>()
        const bookValue = asset.cost - (accumulated?.total ?? 0)
        monthlyAmount = Math.max(0, bookValue * (2 / asset.useful_life_months))
      }

      if (monthlyAmount < 0.01) {
        // Skip zero depreciation
        if (existing) {
          updateStmts.push(
            db.prepare(`
              UPDATE depreciation_schedules SET status = 'skipped' WHERE id = ?
            `).bind(existing.id)
          )
        }
        continue
      }

      totalDepreciation += monthlyAmount

      // Insert or update schedule entry
      if (existing) {
        updateStmts.push(
          db.prepare(`
            UPDATE depreciation_schedules SET amount = ?, status = 'pending' WHERE id = ?
          `).bind(monthlyAmount, existing.id)
        )
      } else {
        updateStmts.push(
          db.prepare(`
            INSERT INTO depreciation_schedules
            (company_id, asset_id, period_year, period_month, amount, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
          `).bind(opts.company_id, asset.id, opts.period_year, opts.period_month, monthlyAmount)
        )
      }

      result.push({ asset_id: asset.id, asset_code: asset.asset_code, amount: monthlyAmount, journal_entry_id: null })
    }

    // Batch update/insert schedule entries
    if (updateStmts.length > 0) {
      await db.batch(updateStmts)
    }

    // If total depreciation > 0, post GL entry
    if (totalDepreciation > 0.01) {
      const glLines = [
        { account_code: expenseCode, debit: totalDepreciation, credit: 0, description: `استهلاك الفترة ${opts.period_year}/${opts.period_month}`, source_ledger: 'manual' as const, source_record_id: 0 },
        { account_code: accumulatedCode, debit: 0, credit: totalDepreciation, description: `استهلاك الفترة ${opts.period_year}/${opts.period_month}`, source_ledger: 'manual' as const, source_record_id: 0 },
      ]

      const periodKey = opts.period_month * 10000 + opts.period_year
      const entryId = await postFromBusinessEvent(db, {
        company_id: opts.company_id,
        event_type: 'depreciation',
        source_module: 'gl',
        source_id: periodKey,
        event_date: `${opts.period_year}-${String(opts.period_month).padStart(2, '0')}-01`,
        description: `استهلاك شهري ${opts.period_year}/${opts.period_month}`,
        created_by: opts.user_id,
        payload: {
          period_year: opts.period_year,
          period_month: opts.period_month,
          total_depreciation: totalDepreciation,
          assets_count: result.length,
        },
        lines: glLines,
      })

      // Link schedule entries to GL entry
      if (entryId) {
        await db.prepare(`
          UPDATE depreciation_schedules
          SET journal_entry_id = ?, status = 'posted'
          WHERE company_id = ? AND period_year = ? AND period_month = ? AND status = 'pending'
        `).bind(entryId, opts.company_id, opts.period_year, opts.period_month).run()

        result.forEach(r => r.journal_entry_id = entryId)
      }
    }

    return result
  },
}
