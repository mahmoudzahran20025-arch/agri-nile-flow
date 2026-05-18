/**
 * suppliers/invoices.ts
 * ======================
 * Invoice and payment transaction lifecycle:
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { logAudit } from '../../lib/audit'
import { logFinancialWorkflowFailure } from '../../lib/finance/workflow_policy'
import { FinanceCore } from '../../lib/finance_core'
import { normalizeIsoDate, isFutureIsoDate, yearMonthParts } from '../../lib/utils/date'
import {
  updateSupplierRunningBalance,
} from './shared'
import { enforceSupplierTxnDimensions } from '../../lib/dimension_validator'
import { postCostToWIP } from '../../lib/wip_engine'

const invoices = new Hono<{ Bindings: Env }>()
invoices.use('*', authMiddleware)

const financeOnly = roleGuard(['super_admin', 'company_admin', 'accountant'])

// ── 3-WAY MATCH HELPER: GET /purchase-orders/:id/match ────────────────────────
invoices.get('/purchase-orders/:id/match', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const poId = Number(c.req.param('id'))

  const po = await c.env.DB.prepare(
    'SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?'
  ).bind(poId, company_id).first()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)

  const items = await c.env.DB.prepare(
    'SELECT * FROM purchase_order_items WHERE po_id = ? AND company_id = ? ORDER BY id'
  ).bind(poId, company_id).all<{ id: number; item_name: string; unit: string; qty_ordered: number; qty_received: number; unit_price: number }>()

  const invoicesList = await c.env.DB.prepare(
    `SELECT id, document_number, transaction_date, amount, notes
     FROM supplier_transactions
     WHERE company_id = ? AND po_number = ? AND entry_type = 'د' AND status = 'posted'`
  ).bind(company_id, String(poId)).all<{ id: number; document_number: string; transaction_date: string; amount: number; notes: string }>()

  const matchRows = items.results.map(item => {
    return {
      po_item_id:     item.id,
      item_name:      item.item_name,
      unit:           item.unit,
      qty_ordered:    item.qty_ordered,
      qty_received:   item.qty_received,
      qty_invoiced:   0,
      po_unit_price:  item.unit_price,
      inv_unit_price: item.unit_price,
      match_status:   item.qty_received > 0 ? 'matched' : 'no_gr',
    }
  })

  return c.json({ 
    success: true, 
    data: { 
      po, 
      match_rows: matchRows, 
      invoices: invoicesList.results.map(i => ({ id: i.id, number: i.document_number, date: i.transaction_date, total: i.amount }))
    } 
  })
})

// ── PO INVOICE CREATION: POST /purchase-orders/:id/invoices ───────────────────
invoices.post('/purchase-orders/:id/invoices', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const poId = Number(c.req.param('id'))
  const b = await c.req.json<{
    invoice_number: string; invoice_date: string; notes?: string
    items: Array<{ po_item_id: number; qty_invoiced: number; unit_price: number }>
  }>()

  if (!b.invoice_number || !b.invoice_date || !b.items?.length) {
    return c.json({ success: false, error: 'بيانات الفاتورة غير مكتملة' }, 400)
  }

  const po = await c.env.DB.prepare(
    'SELECT supplier_code FROM purchase_orders WHERE id = ? AND company_id = ?'
  ).bind(poId, company_id).first<{ supplier_code: number | null }>()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)

  const totalAmount = b.items.reduce((s, i) => s + i.qty_invoiced * i.unit_price, 0)

  try {
    const txnId = await FinanceCore.prepareCashMovement(c.env.DB, {
      company_id,
      userId,
      transaction_date: b.invoice_date,
      direction: 'د',
      amount: totalAmount,
      narration: `فاتورة مورد #${b.invoice_number} (أمر شراء #${poId})`,
      document_number: b.invoice_number,
      document_type: 'invoice',
      supplier_code: po.supplier_code ?? undefined,
      notes: b.notes,
      status: 'posted',
    })

    await c.env.DB.prepare(
      'UPDATE supplier_transactions SET po_number = ? WHERE id = ? AND company_id = ?'
    ).bind(String(poId), txnId.txnId, company_id).run()

    void logAudit(c.env.DB, {
      user_id: userId, company_id, action: 'CREATE',
      table_name: 'supplier_transactions', record_id: txnId.txnId!,
      new_value: { po_id: poId, invoice_number: b.invoice_number, amount: totalAmount },
    })

    return c.json({ success: true, data: { id: txnId.txnId } }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: `فشل إنشاء الفاتورة: ${err.message}` }, 400)
  }
})

// ── Standard Transactions ─────────────────────────────────────────────────────

invoices.post('/:code/transactions', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const b = await c.req.json<{
    transaction_date: string; entry_type: string; document_type?: string
    document_number?: string; expense_category?: string; equipment_type_id?: number; equipment?: string
    unit?: string; quantity?: number; unit_price?: number; amount: number
    credit?: number; debit?: number; check_amount?: number; due_date?: string
    notes?: string; season_id?: number; center_code?: number; account_code?: number
    field_id?: number;
    statement_text?: string; notes_internal?: string; service_type_code?: string
    financial_account_id?: number; equipment_usage_mode?: 'owned' | 'rental'
    work_order_id?: number; crop_cycle_id?: number; status?: 'draft' | 'posted'
  }>()

  if (!b.transaction_date || !b.entry_type || b.amount == null) {
    return c.json({ success: false, error: 'التاريخ ونوع القيد والمبلغ مطلوبة' }, 400)
  }

  const transactionDate = normalizeIsoDate(b.transaction_date)
  if (isFutureIsoDate(transactionDate)) {
    return c.json({ success: false, error: 'غير مسموح بترحيل قيد مالي بتاريخ مستقبلي' }, 400)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, transactionDate)
  if (!periodId && b.status !== 'draft') {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${transactionDate}` }, 400)
  }

  // Dimension enforcement — only for posted transactions
  if (b.status !== 'draft') {
    try {
      await enforceSupplierTxnDimensions(c.env.DB, company_id, {
        entry_type:          b.entry_type,
        season_id:           b.season_id,
        center_code:         b.center_code,
        service_type_code:   b.service_type_code,
        document_number:     b.document_number,
        statement_text:      b.statement_text ?? b.notes,
        due_date:            b.due_date,
        financial_account_id: b.financial_account_id,
      })
    } catch (e: any) {
      return c.json({ success: false, error: e.error ?? 'خطأ في التحقق من الأبعاد', code: e.code }, e.status ?? 422)
    }
  }

  const ym = yearMonthParts(transactionDate)
  const localId = `st_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const status = b.status || 'posted'

  const lastRow = await c.env.DB.prepare(
    `SELECT balance_no_checks, balance_with_checks FROM supplier_transactions
     WHERE company_id = ? AND supplier_code = ? AND transaction_date <= ?
     ORDER BY transaction_date DESC, id DESC LIMIT 1`
  ).bind(company_id, code, transactionDate).first<{ balance_no_checks: number, balance_with_checks: number }>()

  const prevBalNoChecks = lastRow?.balance_no_checks || 0
  const prevBalWithChecks = lastRow?.balance_with_checks || 0
  const credit = Number(b.credit || (b.entry_type === 'د' ? b.amount : 0))
  const debit = Number(b.debit || (b.entry_type === 'م' ? b.amount : 0))
  const delta = credit - debit
  
  const balNoChecks = prevBalNoChecks + delta
  const balWithChecks = prevBalWithChecks + delta

  const result = await c.env.DB.prepare(
    `INSERT INTO supplier_transactions (
      company_id, season_id, supplier_code, account_code, center_code, 
      transaction_date, entry_type, document_type, document_number,
      expense_category, equipment, amount, credit, debit, check_amount, 
      due_date, balance_no_checks, balance_with_checks,
      year, month, notes, created_by_user_id, local_id,
      status, service_type_code, financial_account_id,
      equipment_type_id, equipment_usage_mode, work_order_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id || null, code, b.account_code || null, b.center_code || null,
    transactionDate, b.entry_type, b.document_type || null, b.document_number || null,
    b.expense_category || null, b.equipment || null, b.amount, credit, debit, b.check_amount || 0,
    b.due_date || null, balNoChecks, balWithChecks,
    ym.year, ym.month, b.notes || null, userId, localId,
    status, b.service_type_code || null, b.financial_account_id || null,
    b.equipment_type_id || null, b.equipment_usage_mode || 'rental', b.work_order_id || null
  ).run()

  const newId = Number(result.meta.last_row_id)

  if (status === 'posted') {
    // 🔴 FIX: correct argument order (db, companyId, supplierCode, newTxnId, newTxnDate)
    await updateSupplierRunningBalance(c.env.DB, company_id, code, newId, transactionDate)

    try {
      let glId: number | null = null
      if (b.entry_type === 'د') {
        glId = await FinanceCore.resolveSupplierInvoice(c.env.DB, {
          company_id, ref_id: newId, supplier_code: code, amount: b.amount, date: transactionDate,
          description: b.notes || `فاتورة مورد #${newId}`,
          expense_category: b.expense_category,
          service_type_code: b.service_type_code,
          created_by: userId,
          center_code: b.center_code || undefined,
          season_id:   b.season_id   || undefined,
          field_id:    b.field_id    || undefined,
        })
      } else {
        glId = await FinanceCore.resolveSupplierPayment(c.env.DB, {
          company_id, ref_id: newId, amount: b.amount, date: transactionDate,
          description: b.notes || `سداد مورد #${newId}`,
          supplier_code: code,
          expense_category: b.expense_category,
          service_type_code: b.service_type_code,
          financial_account_id: b.financial_account_id,
          created_by: userId,
          center_code: b.center_code || undefined,
          season_id:   b.season_id   || undefined,
          field_id:    b.field_id    || undefined,
        })
      }

      if (glId) {
        await c.env.DB.prepare('UPDATE supplier_transactions SET journal_entry_id = ? WHERE id = ? AND company_id = ?').bind(glId, newId, company_id).run()
      }

      // WIP side-effect: service/contractor invoices linked to a crop cycle
      // Route cost to wip_ledger for agricultural service procurement cost tracking.
      if (b.entry_type === 'د') {
        const cropCycleId = b.crop_cycle_id ?? (b.work_order_id
          ? (await c.env.DB.prepare('SELECT crop_cycle_id FROM work_orders WHERE id = ? AND company_id = ?')
              .bind(b.work_order_id, company_id).first<{ crop_cycle_id: number | null }>())?.crop_cycle_id
          : null)
        if (cropCycleId) {
          const cycle = await c.env.DB.prepare(
            'SELECT season_id, status FROM crop_cycles WHERE id = ? AND company_id = ?'
          ).bind(cropCycleId, company_id).first<{ season_id: number; status: string }>()
          if (cycle?.status === 'active') {
            try {
              await postCostToWIP({
                db: c.env.DB, company_id,
                crop_cycle_id: cropCycleId,
                season_id: cycle.season_id,
                transaction_date: transactionDate,
                cost_category: 'contractor',
                cost_category_code: 'contractor',
                debit: b.amount,
                description: b.notes || `خدمات مورد #${newId}`,
                source_module: 'supplier_invoice',
                source_id: newId,
                journal_entry_id: glId,
              })
            } catch (wipErr) {
              console.error(`WIP_SUPPLIER_INVOICE failed txn=${newId}:`, (wipErr as Error).message)
            }
          }
        }
      }
    } catch (e: any) {
      await logFinancialWorkflowFailure(c.env.DB, {
        company_id, user_id: userId, module: 'suppliers', stage: 'gl_posting',
        table_name: 'supplier_transactions', record_id: newId, error: e.message
      })
      return c.json({ success: true, data: { id: newId }, warning: `تم حفظ القيد لكن فشل الترحيل المالي: ${e.message}` }, 201)
    }
  }

  return c.json({ success: true, data: { id: newId } }, 201)
})

invoices.patch('/transactions/:id/post', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const tx = await c.env.DB.prepare(
    'SELECT * FROM supplier_transactions WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<any>()

  if (!tx) return c.json({ success: false, error: 'القيد غير موجود' }, 404)
  if (tx.status === 'posted') return c.json({ success: false, error: 'القيد مرحل بالفعل' }, 400)

  await c.env.DB.prepare(
    "UPDATE supplier_transactions SET status = 'posted' WHERE id = ?"
  ).bind(id).run()

  // 🔴 FIX: correct argument order
  await updateSupplierRunningBalance(c.env.DB, company_id, tx.supplier_code, id, tx.transaction_date)

  try {
    let glId: number | null = null
    if (tx.entry_type === 'د') {
      glId = await FinanceCore.resolveSupplierInvoice(c.env.DB, {
        company_id, ref_id: id, supplier_code: tx.supplier_code, amount: tx.amount, date: tx.transaction_date,
        description: tx.notes || `فاتورة مورد #${id}`,
        expense_category: tx.expense_category,
        service_type_code: tx.service_type_code,
        created_by: userId,
        center_code: tx.center_code || undefined,
        season_id:   tx.season_id   || undefined,
        field_id:    tx.field_id    || undefined,
      })
    } else {
      glId = await FinanceCore.resolveSupplierPayment(c.env.DB, {
        company_id, ref_id: id, amount: tx.amount, date: tx.transaction_date,
        description: tx.notes || `سداد مورد #${id}`,
        supplier_code: tx.supplier_code,
        expense_category: tx.expense_category,
        service_type_code: tx.service_type_code,
        financial_account_id: tx.financial_account_id,
        created_by: userId,
        center_code: tx.center_code || undefined,
        season_id:   tx.season_id   || undefined,
        field_id:    tx.field_id    || undefined,
      })
    }
    if (glId) {
      await c.env.DB.prepare('UPDATE supplier_transactions SET journal_entry_id = ? WHERE id = ? AND company_id = ?').bind(glId, id, company_id).run()
    }

    // WIP side-effect for service invoices linked to a crop cycle
    if (tx.entry_type === 'د') {
      const cropCycleId = tx.crop_cycle_id ?? (tx.work_order_id
        ? (await c.env.DB.prepare('SELECT crop_cycle_id FROM work_orders WHERE id = ? AND company_id = ?')
            .bind(tx.work_order_id, company_id).first<{ crop_cycle_id: number | null }>())?.crop_cycle_id
        : null)
      if (cropCycleId) {
        const cycle = await c.env.DB.prepare(
          'SELECT season_id, status FROM crop_cycles WHERE id = ? AND company_id = ?'
        ).bind(cropCycleId, company_id).first<{ season_id: number; status: string }>()
        if (cycle?.status === 'active') {
          try {
            await postCostToWIP({
              db: c.env.DB, company_id,
              crop_cycle_id: cropCycleId,
              season_id: cycle.season_id,
              transaction_date: tx.transaction_date,
              cost_category: 'contractor',
              cost_category_code: 'contractor',
              debit: tx.amount,
              description: tx.notes || `خدمات مورد #${id}`,
              source_module: 'supplier_invoice',
              source_id: id,
              journal_entry_id: glId,
            })
          } catch (wipErr) {
            console.error(`WIP_SUPPLIER_INVOICE failed txn=${id}:`, (wipErr as Error).message)
          }
        }
      }
    }
  } catch (e: any) {
    return c.json({ success: true, data: { id }, warning: `تم الترحيل لكن فشل القيد المحاسبي: ${e.message}` })
  }

  return c.json({ success: true, data: { id } })
})

invoices.delete('/transactions/:id', financeOnly, async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const tx = await c.env.DB.prepare(
    'SELECT status FROM supplier_transactions WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ status: string }>()

  if (!tx) return c.json({ success: false, error: 'القيد غير موجود' }, 404)
  if (tx.status === 'posted') return c.json({ success: false, error: 'لا يمكن حذف قيد مرحل' }, 400)

  await c.env.DB.prepare('DELETE FROM supplier_transactions WHERE id = ? AND company_id = ?').bind(id, company_id).run()
  return c.json({ success: true })
})

export default invoices
