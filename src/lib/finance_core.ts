import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { getOpenPeriod, postAutoEntry, isIntegrationEnabled } from './gl'

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

    // Pre-fetch GL accounts once — not N times inside the loop
    const invAcc = await db
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'inventory'")
      .bind(opts.company_id).first<{ account_code: string }>()
    const apAcc = await db
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'accounts_payable'")
      .bind(opts.company_id).first<{ account_code: string }>()

    if (!invAcc) throw new Error('GL_MAPPING_MISSING: حساب المخزون (inventory) غير مربوط.')
    if (!apAcc)  throw new Error('GL_MAPPING_MISSING: حساب الدائنين (accounts_payable) غير مربوط.')

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
      ).bind(jeKey, opts.company_id, invAcc.account_code, valIn, 0, item.item_name))

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
    const enabled = await isIntegrationEnabled(db, opts.company_id, 'harvest')
    if (!enabled) return { revenue_entry_id: null, cost_entry_id: null }

    const periodId = await getOpenPeriod(db, opts.company_id, opts.harvest_date)
    if (!periodId) {
      throw new Error(`PERIOD_CLOSED: لا توجد فترة مالية مفتوحة للتاريخ ${opts.harvest_date}`)
    }

    // 1. VOID PREVIOUS ENTRIES linked to this harvest_id to prevent duplication
    // We use DELETE here because 'journal_entries' schema lacks a 'status' column and uses ON DELETE CASCADE for lines.
    await db.prepare(
      "DELETE FROM journal_entries WHERE company_id = ? AND ref_type IN ('harvest_revenue', 'harvest_cogs') AND ref_id = ?"
    ).bind(opts.company_id, opts.harvest_id).run()

    // 2. Fetch STRICT mappings (no fallbacks allowed for harvest for accuracy)
    const [cashOrAr, revenueAcc, cogsAcc, inventoryAcc] = await Promise.all([
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'receivable_default'").bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'harvest_revenue'").bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'harvest_cogs'").bind(opts.company_id).first<{ account_code: string }>(),
      db.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'inventory'").bind(opts.company_id).first<{ account_code: string }>(),
    ])

    let revenueEntryId: number | null = null
    let costEntryId: number | null = null

    // 3. Post Revenue (DR Cash/AR, CR Revenue)
    if (opts.total_revenue > 0) {
      if (!cashOrAr?.account_code || !revenueAcc?.account_code) {
        throw new Error('GL_MAPPING_MISSING: يجب تحديد حسابات (العملاء/الصندوق) و (إيراد الحصاد) في الإعدادات أولاً.')
      }
      revenueEntryId = await postAutoEntry(db, {
        company_id: opts.company_id,
        entry_date: opts.harvest_date,
        description: `إيراد حصاد: ${opts.crop_name} - ${opts.field_name}`,
        ref_type: 'harvest_revenue',
        ref_id: opts.harvest_id,
        created_by: opts.userId,
        lines: [
          { account_code: cashOrAr.account_code, debit: opts.total_revenue, credit: 0, description: `إيراد حصاد ${opts.crop_name}`, center_code: opts.center_code ?? undefined, season_id: opts.season_id ?? undefined, field_id: opts.field_id },
          { account_code: revenueAcc.account_code, debit: 0, credit: opts.total_revenue, description: `إيراد حصاد ${opts.crop_name}`, center_code: opts.center_code ?? undefined, season_id: opts.season_id ?? undefined, field_id: opts.field_id },
        ],
      })
    }

    // 4. Post COGS (DR Expense/COGS, CR Inventory)
    if (opts.total_actual_cost > 0) {
      if (!cogsAcc?.account_code || !inventoryAcc?.account_code) {
        throw new Error('GL_MAPPING_MISSING: يجب تحديد حسابات (تكلفة الحصاد) و (المخزون) في الإعدادات أولاً.')
      }
      costEntryId = await postAutoEntry(db, {
        company_id: opts.company_id,
        entry_date: opts.harvest_date,
        description: `تكلفة حصاد: ${opts.crop_name} - ${opts.field_name}`,
        ref_type: 'harvest_cogs',
        ref_id: opts.harvest_id,
        created_by: opts.userId,
        lines: [
          { account_code: cogsAcc.account_code, debit: opts.total_actual_cost, credit: 0, description: `تكلفة حصاد ${opts.crop_name}`, center_code: opts.center_code ?? undefined, season_id: opts.season_id ?? undefined, field_id: opts.field_id },
          { account_code: inventoryAcc.account_code, debit: 0, credit: opts.total_actual_cost, description: `تكلفة حصاد ${opts.crop_name}`, center_code: opts.center_code ?? undefined, season_id: opts.season_id ?? undefined, field_id: opts.field_id },
        ],
      })
    }

    return { revenue_entry_id: revenueEntryId, cost_entry_id: costEntryId }
  }
}
