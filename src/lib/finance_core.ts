import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { getOpenPeriod, postAutoEntry } from './gl'
import {
  resolveInventoryMovement  as peResolveInventory,
  resolveSupplierInvoice    as peResolveSupplierInvoice,
  resolveSupplierPayment    as peResolveSupplierPayment,
  resolveExpensePosting     as peResolveExpense,
  resolveSalesRevenue       as peResolveSalesRevenue,
  resolvePayrollPosting     as peResolvePayroll,
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
  expense_code?:    number | null
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
        const cashMapping = await db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'").bind(opts.company_id).first<{ account_code: string }>()
        cashAccCode = cashMapping?.account_code || ''
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
          const mapping = await db
            .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = ?")
            .bind(opts.company_id, key).first<{ account_code: string }>()
          contraAcc = mapping?.account_code
        }
      }

      if (!cashAccCode) throw new Error('GL_MAPPING_MISSING: حساب الخزينة غير مربوط. أضفه من إعدادات الحسابات.')
      if (!contraAcc) {
        const missingKey = opts.partner_id ? 'partner_current_account' : (opts.supplier_code ? 'accounts_payable' : (opts.direction === 'د' ? 'revenue_default' : 'expense_default'))
        throw new Error(`GL_MAPPING_MISSING: حساب المقابل (${missingKey}) غير مربوط. أضفه من إعدادات الحسابات.`)
      }

      const jeKey = `je_${batchKey}`
      stmts.push(db.prepare(
        `INSERT INTO journal_entries (company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, created_by, local_id)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(opts.company_id, periodId, opts.transaction_date, opts.narration, 'cash_transaction', 0, 1, opts.userId, jeKey))

      stmts.push(db.prepare(
        `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code)
         VALUES ((SELECT id FROM journal_entries WHERE local_id = ?), ?, ?, ?, ?, ?, ?)`
      ).bind(jeKey, opts.company_id, cashAccCode,
        opts.direction === 'د' ? opts.amount : 0,
        opts.direction === 'م' ? opts.amount : 0,
        opts.narration, opts.center_code ?? null))

      stmts.push(db.prepare(
        `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code)
         VALUES ((SELECT id FROM journal_entries WHERE local_id = ?), ?, ?, ?, ?, ?, ?)`
      ).bind(jeKey, opts.company_id, contraAcc,
        opts.direction === 'م' ? opts.amount : 0,
        opts.direction === 'د' ? opts.amount : 0,
        opts.narration, opts.center_code ?? null))

      if (opts.supplier_code) {
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
      if (opts.supplier_code) {
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
    return { txnId: txn?.id, balance: newBalance }
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

    let cashAccCode = ''
    if (txn.financial_account_id) {
      const accInfo = await db.prepare("SELECT gl_account_code FROM bank_accounts WHERE id = ?").bind(txn.financial_account_id).first<{ gl_account_code: string }>()
      cashAccCode = accInfo?.gl_account_code || ''
    }
    if (!cashAccCode) {
      const cashMapping = await db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'").bind(company_id).first<{ account_code: string }>()
      cashAccCode = cashMapping?.account_code || ''
    }

    const contraKey = txn.partner_id
      ? 'partner_current_account'
      : txn.supplier_code
      ? 'accounts_payable'
      : (txn.direction === 'د' ? 'revenue_default' : 'expense_default')
    const mapping = await db
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = ?")
      .bind(company_id, contraKey).first<{ account_code: string }>()
    const contraAcc = mapping?.account_code

    if (!cashAccCode) throw new Error('GL_MAPPING_MISSING: حساب الخزينة غير مربوط. أضفه من إعدادات الحسابات.')
    if (!contraAcc)   throw new Error(`GL_MAPPING_MISSING: حساب المقابل (${contraKey}) غير مربوط. أضفه من إعدادات الحسابات.`)

    const jeKey = `je_post_${txnId}`

    stmts.push(db.prepare(
      `INSERT INTO journal_entries (company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, created_by, local_id)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, periodId, txn.transaction_date, txn.narration, 'cash_transaction', txnId, 1, userId, jeKey))

    stmts.push(db.prepare(
      `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code)
       VALUES ((SELECT id FROM journal_entries WHERE local_id = ?), ?, ?, ?, ?, ?, ?)`
    ).bind(jeKey, company_id, cashAccCode,
      txn.direction === 'د' ? txn.amount : 0,
      txn.direction === 'م' ? txn.amount : 0,
      txn.narration, txn.center_code))

    stmts.push(db.prepare(
      `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code)
       VALUES ((SELECT id FROM journal_entries WHERE local_id = ?), ?, ?, ?, ?, ?, ?)`
    ).bind(jeKey, company_id, contraAcc,
      txn.direction === 'م' ? txn.amount : 0,
      txn.direction === 'د' ? txn.amount : 0,
      txn.narration, txn.center_code))

    if (txn.supplier_code) {
      stmts.push(db.prepare(
        `UPDATE supplier_transactions SET status = 'posted'
         WHERE local_id = (SELECT 'st_' || local_id FROM cash_transactions WHERE id = ?)`
      ).bind(txnId))
    }

    await db.batch(stmts)
    return { success: true, balance: newBalance }
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

    const apAcc = await db
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'accounts_payable'")
      .bind(opts.company_id).first<{ account_code: string }>()

    if (!apAcc) throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')

    const probe = await peResolveInventory(db, opts.company_id, null, null, 1, true)
    if (probe.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED (PO receipt — inventory account): ${probe.validationErrors.join('; ')}`)
    }
    const resolvedInvAccCode = probe.lines[0].account_code

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
        // Use the in-batch running total for this SKU+warehouse
        const cur = runningBal.get(bwKey)!
        prevQty = cur.qty
        prevVal = cur.val
      } else {
        // First occurrence — read last committed row from DB
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

      // FIX: narration→notes in supplier_transactions; use correct running balances
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

      const jeKey = `je_${localId}`
      stmts.push(db.prepare(
        `INSERT INTO journal_entries (company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, created_by, local_id)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(opts.company_id, periodId, opts.received_date,
        `استلام مخزني: ${item.item_name} (PO #${opts.po_id})`, 'inventory_movement', 0, 1, opts.userId, jeKey))

      stmts.push(db.prepare(
        `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description)
         VALUES ((SELECT id FROM journal_entries WHERE local_id = ?), ?, ?, ?, ?, ?)`
      ).bind(jeKey, opts.company_id, resolvedInvAccCode, valIn, 0, item.item_name))

      stmts.push(db.prepare(
        `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description)
         VALUES ((SELECT id FROM journal_entries WHERE local_id = ?), ?, ?, ?, ?, ?)`
      ).bind(jeKey, opts.company_id, apAcc.account_code, 0, valIn, item.item_name))
    }

    // Supplier statement — FIX: narration→notes column
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

    // FIX: Return fields the caller actually destructures: { movements, status }
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

    const cashOrAr = await db.prepare(
      "SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'receivable_default'"
    ).bind(opts.company_id).first<{ account_code: string }>()

    let revenueEntryId: number | null = null
    let costEntryId: number | null = null

    // 3. Post Revenue (DR Cash/AR, CR Revenue)
    if (opts.total_revenue > 0) {
      const receivableAcc = cashOrAr?.account_code
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
      revenueEntryId = await postAutoEntry(db, {
        company_id: opts.company_id, entry_date: opts.harvest_date,
        description: `إيراد حصاد: ${opts.crop_name} - ${opts.field_name}`,
        ref_type: 'harvest_revenue', ref_id: opts.harvest_id,
        created_by: opts.userId, lines: revBlueprint.lines,
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
      costEntryId = await postAutoEntry(db, {
        company_id: opts.company_id, entry_date: opts.harvest_date,
        description: `تكلفة حصاد: ${opts.crop_name} - ${opts.field_name}`,
        ref_type: 'harvest_cogs', ref_id: opts.harvest_id,
        created_by: opts.userId, lines: cogsBlueprint.lines,
      })
    }

    return { revenue_entry_id: revenueEntryId, cost_entry_id: costEntryId }
  },

  // ============================================================================
  // POSTING ENGINE BRIDGE FUNCTIONS
  // All routes now use posting_engine.ts with posting-group cascade lookup.
  // gl_account_mappings is used only as a fallback data source (legacy compat).
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
    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.item_name,
      ref_type:    'inventory_movement',
      ref_id:      opts.ref_id,
      lines:       blueprint.lines,
      created_by:  opts.created_by,
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
    const apMapping = await db
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'accounts_payable'")
      .bind(opts.company_id).first<{ account_code: string }>()
    if (!apMapping?.account_code) {
      throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')
    }
    const blueprint = await peResolveSupplierInvoice(
      db, opts.company_id,
      supplierRow?.bus_posting_group_code ?? null,
      null,
      apMapping.account_code,
      opts.amount, opts.description
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.description,
      ref_type:    'supplier_invoice',
      ref_id:      opts.ref_id,
      lines:       blueprint.lines,
      created_by:  opts.created_by,
    })
  },

  /**
   * resolveSupplierPayment
   * Supplier cash payment GL poster via posting_engine.
   */
  async resolveSupplierPayment(
    db: D1Database,
    opts: {
      company_id:   number
      ref_id:       number
      amount:       number
      date:         string
      description:  string
      created_by?:  number
      center_code?: number
    }
  ): Promise<number | null> {
    const [apRow, cashRow] = await Promise.all([
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'accounts_payable'")
        .bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'")
        .bind(opts.company_id).first<{ account_code: string }>(),
    ])
    if (!apRow?.account_code)   throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')
    if (!cashRow?.account_code) throw new Error('GL_MAPPING_MISSING: حساب الخزينة (cash) غير مربوط.')

    const blueprint = await peResolveSupplierPayment(
      db, opts.company_id,
      apRow.account_code, cashRow.account_code,
      opts.amount, opts.description,
      { center_code: opts.center_code }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.description,
      ref_type:    'supplier_payment',
      ref_id:      opts.ref_id,
      lines:       blueprint.lines,
      created_by:  opts.created_by,
    })
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
    const cashRow = await db
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'")
      .bind(opts.company_id).first<{ account_code: string }>()
    if (!cashRow?.account_code) throw new Error('GL_MAPPING_MISSING: حساب الخزينة (cash) غير مربوط.')

    const blueprint = await peResolveExpense(
      db, opts.company_id, null, null,
      cashRow.account_code, opts.amount,
      opts.expense_account,
      opts.description,
      { center_code: opts.center_code }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.description,
      ref_type:    'expense',
      ref_id:      opts.ref_id,
      lines:       blueprint.lines,
      created_by:  opts.created_by,
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
    const receivableRow = await db
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'receivable_default'")
      .bind(opts.company_id).first<{ account_code: string }>()
    if (!receivableRow?.account_code) throw new Error('GL_MAPPING_MISSING: حساب المدينين (receivable_default) غير مربوط.')

    const blueprint = await peResolveSalesRevenue(
      db, opts.company_id, null, null,
      receivableRow.account_code, opts.amount,
      opts.description,
      { center_code: opts.center_code, season_id: opts.season_id, field_id: opts.field_id }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.description,
      ref_type:    'revenue',
      ref_id:      opts.ref_id,
      lines:       blueprint.lines,
      created_by:  opts.created_by,
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
    }
  ): Promise<number | null> {
    const [wagesRow, payableRow] = await Promise.all([
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'wages'")
        .bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'wages_payable'")
        .bind(opts.company_id).first<{ account_code: string }>(),
    ])
    if (!wagesRow?.account_code)   throw new Error('GL_MAPPING_MISSING: حساب الأجور (wages) غير مربوط.')
    if (!payableRow?.account_code) throw new Error('GL_MAPPING_MISSING: حساب الأجور المستحقة (wages_payable) غير مربوط.')

    const blueprint = await peResolvePayroll(
      db, opts.company_id,
      wagesRow.account_code, payableRow.account_code,
      opts.amount, opts.description,
      { center_code: opts.center_code }
    )
    if (blueprint.isBlocked) {
      throw new Error(`POSTING_ENGINE_BLOCKED: ${blueprint.validationErrors.join('; ')}`)
    }
    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.description,
      ref_type:    'payroll_run',
      ref_id:      opts.ref_id,
      lines:       blueprint.lines,
      created_by:  opts.created_by,
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
    const [payableRow, cashRow] = await Promise.all([
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'wages_payable'")
        .bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'")
        .bind(opts.company_id).first<{ account_code: string }>(),
    ])
    if (!payableRow?.account_code) throw new Error('GL_MAPPING_MISSING: حساب الأجور المستحقة (wages_payable) غير مربوط.')
    if (!cashRow?.account_code)    throw new Error('GL_MAPPING_MISSING: حساب الصندوق (cash) غير مربوط.')
    if (opts.amount <= 0) return null

    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.description,
      ref_type:    'payroll_payment',
      ref_id:      opts.ref_id,
      lines: [
        { account_code: payableRow.account_code, debit: opts.amount, credit: 0,           description: opts.description },
        { account_code: cashRow.account_code,    debit: 0,           credit: opts.amount, description: opts.description },
      ],
      created_by:  opts.created_by,
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
    const [cashRow, equityRow] = await Promise.all([
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'")
        .bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'equity'")
        .bind(opts.company_id).first<{ account_code: string }>(),
    ])
    if (!cashRow?.account_code)   throw new Error('GL_MAPPING_MISSING: حساب الصندوق (cash) غير مربوط.')
    if (!equityRow?.account_code) throw new Error('GL_MAPPING_MISSING: حساب رأس المال (equity) غير مربوط.')
    const abs = Math.abs(opts.delta)
    const lines = opts.delta > 0
      ? [
          { account_code: cashRow.account_code,   debit: abs, credit: 0,   description: opts.description },
          { account_code: equityRow.account_code,  debit: 0,   credit: abs, description: opts.description },
        ]
      : [
          { account_code: equityRow.account_code,  debit: abs, credit: 0,   description: opts.description },
          { account_code: cashRow.account_code,   debit: 0,   credit: abs, description: opts.description },
        ]
    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.description,
      ref_type:    'partner_capital',
      ref_id:      opts.ref_id,
      lines,
      created_by:  opts.created_by,
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
    const [cashRow, currentRow, equityRow] = await Promise.all([
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'")
        .bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'partner_current_acct'")
        .bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'equity'")
        .bind(opts.company_id).first<{ account_code: string }>(),
    ])
    if (!cashRow?.account_code) throw new Error('GL_MAPPING_MISSING: حساب الصندوق (cash) غير مربوط.')
    const currentAcctCode = currentRow?.account_code ?? equityRow?.account_code
    if (!currentAcctCode) throw new Error('GL_MAPPING_MISSING: حساب الشريك الجاري (partner_current_acct) غير مربوط.')
    const abs = Math.abs(opts.delta)
    const lines = opts.delta > 0
      ? [
          { account_code: cashRow.account_code, debit: abs, credit: 0,   description: opts.description },
          { account_code: currentAcctCode,       debit: 0,   credit: abs, description: opts.description },
        ]
      : [
          { account_code: currentAcctCode,       debit: abs, credit: 0,   description: opts.description },
          { account_code: cashRow.account_code, debit: 0,   credit: abs, description: opts.description },
        ]
    return await postAutoEntry(db, {
      company_id:  opts.company_id,
      entry_date:  opts.date,
      description: opts.description,
      ref_type:    'partner_current',
      ref_id:      opts.ref_id,
      lines,
      created_by:  opts.created_by,
    })
  },
}
