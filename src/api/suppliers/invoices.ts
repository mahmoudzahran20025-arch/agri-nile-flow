/**
 * suppliers/invoices.ts
 * ======================
 * Invoice and payment transaction lifecycle:
 *   POST   /:code/transactions         — create (draft or direct-post)
 *   PATCH  /:code/transactions/:id/post — approve and post a draft
 *   DELETE /:code/transactions/:id      — delete a draft only
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { logAudit } from '../../lib/audit'
import { logFinancialWorkflowFailure } from '../../lib/finance/workflow_policy'
import { FinanceCore } from '../../lib/finance_core'
import { enforceDataQualityPolicy } from '../../lib/data_quality'
import { normalizeIsoDate, isFutureIsoDate } from '../../lib/utils/date'
import { tableColumnExists, isKnownServiceTypeCode, hasTechnicalGovernanceTag } from '../../lib/utils/api_helpers'
import {
  isSupplierAuthorizedForService,
  updateSupplierRunningBalance,
  fullRebalanceSupplierBalances,
  createOwnedCapitalAsset,
  rollbackCreatedAsset,
} from './shared'

const invoices = new Hono<{ Bindings: Env }>()
invoices.use('*', authMiddleware)

const financeOnly = roleGuard(['super_admin', 'company_admin', 'accountant'])

// ── POST /:code/transactions ──────────────────────────────────────────────────
invoices.post('/:code/transactions', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const b = await c.req.json<{
    transaction_date: string; entry_type: string; document_type?: string
    document_number?: number; expense_category?: string; equipment_type_id?: number; equipment?: string
    unit?: string; quantity?: number; unit_price?: number; amount: number
    credit?: number; debit?: number; check_amount?: number; due_date?: string
    notes?: string; season_id?: number; center_code?: number; account_code?: number
    statement_text?: string; notes_internal?: string; service_type_code?: string
    financial_account_id?: number; equipment_usage_mode?: 'owned' | 'rental'
    work_order_id?: number; status?: 'draft' | 'posted'
  }>()

  if (!b.transaction_date || !b.entry_type || b.amount == null) {
    return c.json({ success: false, error: 'التاريخ ونوع القيد والمبلغ مطلوبة' }, 400)
  }

  let postingDate: string
  try {
    postingDate = normalizeIsoDate(b.transaction_date, 'INVALID_DATE')
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'صيغة التاريخ غير صحيحة' }, 422)
  }

  const supplier = await c.env.DB
    .prepare('SELECT code, name, is_active FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id).first<{ code: number; name: string; is_active: number }>()

  if (!supplier)        return c.json({ success: false, error: 'المورد غير موجود' }, 404)
  if (!supplier.is_active) return c.json({ success: false, error: 'المورد غير نشط ولا يمكن إضافة حركة جديدة' }, 409)

  const status = b.status ?? 'posted'

  if (status === 'posted') {
    if (isFutureIsoDate(postingDate))
      return c.json({ success: false, error: 'غير مسموح بترحيل قيد مورد بتاريخ مستقبلي' }, 422)

    const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'posted', module: 'suppliers' })
    if (!gate.ok)
      return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)

    if (b.season_id == null || b.center_code == null)
      return c.json({ success: false, error: 'الموسم ومركز التكلفة مطلوبان عند الترحيل' }, 422)

    if (b.entry_type === 'م' && b.financial_account_id == null)
      return c.json({ success: false, error: 'حساب الخزينة / البنك مطلوب عند ترحيل سداد المورد' }, 422)
  }

  if (b.equipment_type_id && b.equipment_usage_mode == null)
    return c.json({ success: false, error: 'يجب تحديد ما إذا كانت المعدة إيجارًا أم مملوكة للشركة' }, 422)

  if (b.equipment_type_id && b.equipment_usage_mode === 'owned' && b.entry_type === 'د' && status !== 'posted')
    return c.json({ success: false, error: 'إدخال معدات رأسمالية يجب أن يكون مرحّلًا مباشرة' }, 422)

  let equipmentType: { id: number; name: string; asset_nature: string; default_life_months: number } | null = null
  if (b.equipment_type_id) {
    equipmentType = await c.env.DB.prepare(
      'SELECT id, name, asset_nature, default_life_months FROM equipment_types WHERE id = ? AND company_id = ?'
    ).bind(b.equipment_type_id, company_id).first<{ id: number; name: string; asset_nature: string; default_life_months: number }>()
    if (!equipmentType)
      return c.json({ success: false, error: 'نوع المعدة غير موجود أو غير متاح لهذه الشركة' }, 422)
  }

  if (status === 'posted') {
    const periodId = await getOpenPeriod(c.env.DB, company_id, postingDate)
    if (!periodId)
      return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${postingDate}` }, 400)
  }

  const credit     = b.credit ?? (b.entry_type === 'د' ? b.amount : 0)
  const debit      = b.debit  ?? (b.entry_type === 'م' ? b.amount : 0)
  const checkAmt   = b.check_amount ?? 0
  const [yearPart, monthPart] = postingDate.split('-')
  const equipmentName          = (b.equipment && b.equipment.trim()) || equipmentType?.name || null
  const statementText          = (b.statement_text ?? b.notes ?? '').trim()
  const notesInternal          = b.notes_internal?.trim() || null
  const normalizedExpenseCategory = b.expense_category?.trim() || null
  const serviceTypeCode        = b.service_type_code?.trim() || null
  const isSupplierInvoice      = b.entry_type === 'د' && credit > 0

  if (status === 'posted') {
    if (statementText.length < 3)
      return c.json({ success: false, error: 'البيان مطلوب عند الترحيل (3 أحرف على الأقل)' }, 422)
    if (hasTechnicalGovernanceTag(statementText))
      return c.json({ success: false, error: 'غير مسموح باستخدام وسوم الحوكمة التقنية داخل البيان' }, 422)
    if (hasTechnicalGovernanceTag(notesInternal))
      return c.json({ success: false, error: 'وسوم الحوكمة التقنية يجب أن تُسجل كـ flags وليس داخل الملاحظات' }, 422)
    if (isSupplierInvoice && !serviceTypeCode)
      return c.json({ success: false, error: 'service_type_code مطلوب عند ترحيل فاتورة المورد' }, 422)
    if (serviceTypeCode) {
      if (!(await isKnownServiceTypeCode(c.env.DB, company_id, serviceTypeCode)))
        return c.json({ success: false, error: 'service_type_code غير معروف أو غير نشط' }, 422)
      if (!(await isSupplierAuthorizedForService(c.env.DB, company_id, code, serviceTypeCode)))
        return c.json({ success: false, error: 'المورد غير مخول لهذا service_type_code' }, 422)
    }
  }

  const [hasStatementTextCol, hasNotesInternalCol, hasServiceTypeCodeCol] = await Promise.all([
    tableColumnExists(c.env.DB, 'supplier_transactions', 'statement_text'),
    tableColumnExists(c.env.DB, 'supplier_transactions', 'notes_internal'),
    tableColumnExists(c.env.DB, 'supplier_transactions', 'service_type_code'),
  ])

  const insertColumns = [
    'company_id', 'season_id', 'supplier_code', 'account_code', 'center_code', 'financial_account_id',
    'transaction_date', 'entry_type', 'document_type', 'document_number',
    'expense_category', 'equipment', 'equipment_type_id', 'equipment_usage_mode', 'amount',
    'credit', 'debit', 'check_amount', 'balance_no_checks', 'balance_with_checks',
    'due_date', 'notes', 'year', 'month', 'created_by_user_id', 'status', 'work_order_id',
  ]
  const insertValues: Array<string | number | null> = [
    company_id, b.season_id ?? null, code, b.account_code ?? null, b.center_code ?? null, b.financial_account_id ?? null,
    postingDate, b.entry_type, b.document_type ?? null, b.document_number ?? null,
    normalizedExpenseCategory, equipmentName, b.equipment_type_id ?? null, b.equipment_usage_mode ?? null, b.amount,
    credit, debit, checkAmt, 0, 0,
    b.due_date ?? null, statementText || null,
    Number(yearPart), Number(monthPart), userId, 'draft', b.work_order_id ?? null,
  ]
  if (hasStatementTextCol) { insertColumns.push('statement_text'); insertValues.push(statementText || null) }
  if (hasNotesInternalCol) { insertColumns.push('notes_internal'); insertValues.push(notesInternal) }
  if (hasServiceTypeCodeCol) { insertColumns.push('service_type_code'); insertValues.push(serviceTypeCode) }

  const result = await c.env.DB.prepare(
    `INSERT INTO supplier_transactions (${insertColumns.join(',')}) VALUES (${insertColumns.map(() => '?').join(',')})`
  ).bind(...insertValues).run()

  const txnId = result.meta.last_row_id

  if (status === 'posted' && isSupplierInvoice && !b.work_order_id &&
      (serviceTypeCode === 'SRV_MECH' || serviceTypeCode === 'SRV_LABOR')) {
    console.warn(`[suppliers/invoices] ${serviceTypeCode} invoice #${txnId} posted without work_order_id — operational attribution incomplete`)
  }

  if (status === 'posted') {
    const err = await _postTransaction(c.env.DB, {
      company_id, userId, code, txnId,
      supplier, equipmentType,
      postingDate, statementText, notesInternal,
      normalizedExpenseCategory, serviceTypeCode,
      isSupplierInvoice,
      b,
    })
    if (err) return c.json(err.body, err.status as 400)
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'supplier_transactions', record_id: txnId,
    new_value: {
      entry_type: b.entry_type, supplier: code, amount: b.amount,
      date: b.transaction_date, doc: b.document_number, status,
      financial_account_id: b.financial_account_id ?? null,
      equipment_type_id: b.equipment_type_id ?? null,
      equipment_usage_mode: b.equipment_usage_mode ?? null,
    },
  })

  return c.json({ success: true, data: null }, 201)
})

// ── PATCH /:code/transactions/:id/post ───────────────────────────────────────
invoices.patch('/:code/transactions/:id/post', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const id   = Number(c.req.param('id'))

  const supplier = await c.env.DB
    .prepare('SELECT code, name, is_active FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id).first<{ code: number; name: string; is_active: number }>()

  if (!supplier)        return c.json({ success: false, error: 'المورد غير موجود' }, 404)
  if (!supplier.is_active) return c.json({ success: false, error: 'المورد غير نشط ولا يمكن ترحيل حركة' }, 409)

  const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'posted', module: 'suppliers' })
  if (!gate.ok)
    return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)

  const txn = await c.env.DB.prepare(
    `SELECT id, supplier_code, entry_type, amount, transaction_date, expense_category,
            center_code, account_code, season_id, document_type, document_number, notes,
            financial_account_id, equipment_type_id, equipment_usage_mode, service_type_code, work_order_id, equipment
     FROM supplier_transactions WHERE id = ? AND company_id = ? AND supplier_code = ? AND status = 'draft'`
  ).bind(id, company_id, code).first<{
    id: number; supplier_code: number; entry_type: string; amount: number
    transaction_date: string; expense_category: string | null; center_code: number | null
    account_code: string | null; season_id: number | null; document_type: string | null
    document_number: number | null; notes: string | null; financial_account_id: number | null
    equipment_type_id: number | null; equipment_usage_mode: 'owned' | 'rental' | null
    service_type_code: string | null; work_order_id: number | null; equipment: string | null
  }>()

  if (!txn) return c.json({ success: false, error: 'المسودة غير موجودة أو تم ترحيلها بالفعل' }, 404)

  if (txn.season_id == null || txn.center_code == null)
    return c.json({ success: false, error: 'لا يمكن ترحيل المسودة بدون موسم ومركز تكلفة' }, 422)
  if (!txn.notes || txn.notes.trim().length < 3)
    return c.json({ success: false, error: 'لا يمكن ترحيل المسودة بدون بيان واضح (3 أحرف على الأقل)' }, 422)
  if (hasTechnicalGovernanceTag(txn.notes))
    return c.json({ success: false, error: 'غير مسموح باستخدام وسوم الحوكمة التقنية داخل البيان' }, 422)
  if (!txn.expense_category?.trim())
    return c.json({ success: false, error: 'لا يمكن ترحيل المسودة بدون تصنيف خدمة/مصروف' }, 422)
  if (txn.entry_type === 'م' && txn.financial_account_id == null)
    return c.json({ success: false, error: 'لا يمكن ترحيل مسودة سداد بدون تحديد حساب الخزينة / البنك' }, 422)

  const periodId = await getOpenPeriod(c.env.DB, company_id, txn.transaction_date)
  if (!periodId)
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${txn.transaction_date}` }, 400)

  let txnEquipmentType: { id: number; name: string; asset_nature: string; default_life_months: number } | null = null
  if (txn.equipment_type_id) {
    if (txn.equipment_usage_mode == null)
      return c.json({ success: false, error: 'لا يمكن ترحيل مسودة معدات بدون تحديد نوع الاستخدام (إيجار/مملوك)' }, 422)
    txnEquipmentType = await c.env.DB.prepare(
      'SELECT id, name, asset_nature, default_life_months FROM equipment_types WHERE id = ? AND company_id = ?'
    ).bind(txn.equipment_type_id, company_id).first<{ id: number; name: string; asset_nature: string; default_life_months: number }>()
    if (!txnEquipmentType)
      return c.json({ success: false, error: 'نوع المعدة غير صالح لهذه الشركة' }, 422)
  }

  const err = await _postTransaction(c.env.DB, {
    company_id, userId, code, txnId: id,
    supplier, equipmentType: txnEquipmentType,
    postingDate: txn.transaction_date,
    statementText: txn.notes ?? '',
    notesInternal: null,
    normalizedExpenseCategory: txn.expense_category,
    serviceTypeCode: txn.service_type_code,
    isSupplierInvoice: txn.entry_type === 'د',
    b: {
      entry_type: txn.entry_type, amount: txn.amount,
      equipment_usage_mode: txn.equipment_usage_mode,
      equipment: txn.equipment,
      financial_account_id: txn.financial_account_id,
      center_code: txn.center_code, season_id: txn.season_id,
      document_type: txn.document_type, document_number: txn.document_number,
      work_order_id: txn.work_order_id, quantity: undefined, unit_price: undefined,
    },
  })
  if (err) return c.json(err.body, err.status as 400)

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'supplier_transactions', record_id: id,
    new_value: { status: 'posted' }, source: 'governance_workflow',
  })

  return c.json({ success: true, data: null })
})

// ── DELETE /:code/transactions/:id ────────────────────────────────────────────
invoices.delete('/:code/transactions/:id', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const id   = Number(c.req.param('id'))

  const txn = await c.env.DB
    .prepare('SELECT id, amount, status FROM supplier_transactions WHERE id = ? AND company_id = ? AND supplier_code = ?')
    .bind(id, company_id, code).first<{ id: number; amount: number; status: string }>()

  if (!txn) return c.json({ success: false, error: 'الحركة غير موجودة' }, 404)
  if (txn.status !== 'draft')
    return c.json({ success: false, error: 'لا يمكن حذف حركة مرحّلة — يجب أن تكون مسودة فقط' }, 409)

  await c.env.DB
    .prepare('DELETE FROM supplier_transactions WHERE id = ? AND company_id = ?')
    .bind(id, company_id).run()

  await fullRebalanceSupplierBalances(c.env.DB, company_id, code)

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'DELETE',
    table_name: 'supplier_transactions', record_id: id,
    new_value: { deleted_draft: true, supplier_code: code, amount: txn.amount },
  })

  return c.json({ success: true, data: null })
})

// ── Internal: shared GL posting logic ────────────────────────────────────────
async function _postTransaction(
  db: Env['DB'],
  opts: {
    company_id: number; userId: number; code: number; txnId: number
    supplier: { code: number; name: string; is_active: number }
    equipmentType: { id: number; name: string; asset_nature: string; default_life_months: number } | null
    postingDate: string; statementText: string; notesInternal: string | null
    normalizedExpenseCategory: string | null; serviceTypeCode: string | null
    isSupplierInvoice: boolean
    b: {
      entry_type: string; amount: number
      equipment_usage_mode?: 'owned' | 'rental' | null
      equipment?: string | null
      financial_account_id?: number | null
      center_code?: number | null; season_id?: number | null
      document_type?: string | null; document_number?: number | null
      work_order_id?: number | null; quantity?: number; unit_price?: number
    }
  },
): Promise<{ body: Record<string, unknown>; status: number } | null> {
  const { company_id, userId, code, txnId, supplier, equipmentType, postingDate,
          statementText, notesInternal, normalizedExpenseCategory, serviceTypeCode,
          isSupplierInvoice, b } = opts

  let createdAssetId: number | null = null
  let glEntryId: number | null = null

  try {
    const supplierName = supplier.name

    if (b.entry_type === 'د') {
      if (b.equipment_usage_mode === 'owned') {
        createdAssetId = await createOwnedCapitalAsset(db, {
          companyId: company_id, txnId, supplierCode: code,
          equipmentType, transactionDate: postingDate,
          amount: b.amount, centerCode: b.center_code ?? null, userId,
        })
      }

      glEntryId = await FinanceCore.resolveSupplierInvoice(db, {
        company_id, ref_id: txnId, amount: b.amount, date: postingDate,
        description: `${normalizedExpenseCategory ?? b.entry_type} — ${supplierName}`,
        created_by: userId, supplier_code: code, service_type_code: serviceTypeCode,
      })

      if (b.work_order_id && isSupplierInvoice) {
        if (serviceTypeCode === 'SRV_MECH') {
          await db.prepare(`
            INSERT INTO work_order_equipment
              (work_order_id, company_id, equipment_name, task_date, hours_worked, cost_per_hour, equipment_usage_mode, supplier_code, notes, operation_id)
            VALUES (?, ?, ?, ?, ?, ?, 'rental', ?, ?, ?)
          `).bind(
            b.work_order_id, company_id,
            b.equipment || supplierName || 'معدة مقاول',
            postingDate, b.quantity ?? 1, b.unit_price ?? b.amount,
            code, statementText || null, `sup_mirror_${txnId}`
          ).run()
        } else if (serviceTypeCode === 'SRV_LABOR') {
          await db.prepare(`
            INSERT INTO work_tasks (work_order_id, company_id, task_date, description, quantity, unit, unit_cost, notes)
            VALUES (?, ?, ?, ?, ?, 'عامل/ساعة', ?, ?)
          `).bind(
            b.work_order_id, company_id, postingDate,
            normalizedExpenseCategory || supplierName || 'عمالة مقاول',
            b.quantity ?? 1, b.unit_price ?? b.amount, statementText || null
          ).run()
        }
      }
    } else {
      glEntryId = await FinanceCore.resolveSupplierPayment(db, {
        company_id, ref_id: txnId, amount: b.amount, date: postingDate,
        description: `${normalizedExpenseCategory ?? b.entry_type} — ${supplierName}`,
        created_by: userId, center_code: b.center_code ?? undefined,
        supplier_code: code, service_type_code: serviceTypeCode,
        financial_account_id: b.financial_account_id ?? null,
      })

      try {
        await FinanceCore.prepareCashMovement(db, {
          company_id, userId, transaction_date: postingDate,
          direction: 'م', amount: b.amount,
          financial_account_id: b.financial_account_id ?? null,
          narration: `${normalizedExpenseCategory ? normalizedExpenseCategory + ' — ' : ''}سداد مستحقات ${supplierName}`,
          statement_text: `${normalizedExpenseCategory ? normalizedExpenseCategory + ' — ' : ''}سداد مستحقات ${supplierName}`,
          service_type_code: serviceTypeCode, supplier_code: code,
          season_id: b.season_id ?? null, center_code: b.center_code ?? null,
          document_type: b.document_type ?? null, document_number: b.document_number ?? null,
          notes: statementText || null,
          notes_internal: notesInternal
            ? `${notesInternal} | [MIRROR_SUPPLIER_PAYMENT]`
            : '[MIRROR_SUPPLIER_PAYMENT]',
          status: 'posted', skipSupplierMirror: true, skipGlPosting: true,
        })
      } catch (mirrorErr: unknown) {
        if (glEntryId != null) {
          await db.prepare(
            "UPDATE journal_entries SET is_posted = 0, status = 'voided' WHERE id = ? AND company_id = ?"
          ).bind(glEntryId, company_id).run()
        }
        throw mirrorErr
      }
    }

    await db.prepare("UPDATE supplier_transactions SET status = 'posted' WHERE id = ? AND company_id = ?")
      .bind(txnId, company_id).run()

    await updateSupplierRunningBalance(db, company_id, code, txnId, postingDate)
    return null

  } catch (e: unknown) {
    if (createdAssetId != null) await rollbackCreatedAsset(db, company_id, createdAssetId)

    await logFinancialWorkflowFailure(db, {
      company_id, user_id: userId, module: 'suppliers',
      stage: 'post_supplier_transaction', table_name: 'supplier_transactions',
      record_id: txnId, error: e,
      context: { supplier_code: code, amount: b.amount, entry_type: b.entry_type, financial_account_id: b.financial_account_id ?? null },
    })

    const message = e instanceof Error ? e.message : 'خطأ غير معروف'
    return {
      body: { success: false, error: `تم حفظ القيد كمسودة، لكن فشل إنشاء القيد المحاسبي: ${message}` },
      status: 400,
    }
  }
}

export default invoices
