/**
 * dimension_validator.ts
 * =======================
 * Centralised dimension enforcement helpers used by operational API modules.
 * All functions are pure DB queries — no side effects, no writes.
 *
 * Consuming modules: inventory/issues.ts, inventory/movements.ts,
 *                    suppliers/invoices.ts, treasury/cash.ts
 */

import type { D1Database } from '@cloudflare/workers-types'

// ── Individual validators ─────────────────────────────────────────────────────

export async function isActiveSeason(
  db: D1Database,
  companyId: number,
  seasonId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM seasons WHERE id = ? AND company_id = ? AND status NOT IN ('closed','cancelled') LIMIT 1",
    )
    .bind(seasonId, companyId)
    .first<{ ok: number }>()
  return !!row?.ok
}

export async function isActiveCenterCode(
  db: D1Database,
  companyId: number,
  centerCode: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT 1 AS ok FROM cost_centers WHERE company_id = ? AND CAST(code AS INTEGER) = ? AND is_active = 1 LIMIT 1',
    )
    .bind(companyId, centerCode)
    .first<{ ok: number }>()
  return !!row
}

export async function isKnownServiceType(
  db: D1Database,
  companyId: number,
  code: string,
): Promise<boolean> {
  const normalized = code.trim()
  if (!normalized) return false

  const byService = await db
    .prepare('SELECT 1 AS ok FROM service_types WHERE company_id = ? AND code = ? AND is_active = 1 LIMIT 1')
    .bind(companyId, normalized)
    .first<{ ok: number }>()
  if (byService?.ok) return true

  const byExpense = await db
    .prepare('SELECT 1 AS ok FROM expense_types WHERE company_id = ? AND CAST(code AS TEXT) = ? LIMIT 1')
    .bind(companyId, normalized)
    .first<{ ok: number }>()
  return !!byExpense?.ok
}

// ── Composite: ISSUE dimension guard ─────────────────────────────────────────
// Validates all mandatory dimensions for an inventory ISSUE (تصريف).
// Throws a structured { status, error, code } object on failure so callers
// can respond with the correct HTTP status and Arabic message.

export interface IssueDimensions {
  seasonId:        number
  centerCode:      number
  fieldId:         number | null
  serviceTypeCode: string
  statementText:   string
  fieldWarning:    string | null
}

export async function enforceIssueDimensions(
  db: D1Database,
  companyId: number,
  input: {
    season_id?:         number
    center_code?:       number
    field_id?:          number
    service_type_code?: string
    statement_text?:    string
    notes?:             string
  },
): Promise<IssueDimensions> {
  if (!input.season_id) {
    throw { status: 422, error: 'season_id مطلوب لصرف المخزون', code: 'ISSUE_REQUIRES_SEASON' }
  }
  if (!input.center_code) {
    throw { status: 422, error: 'center_code مطلوب لصرف المخزون', code: 'ISSUE_REQUIRES_CENTER' }
  }
  if (!input.service_type_code?.trim()) {
    throw { status: 422, error: 'service_type_code مطلوب لصرف المخزون', code: 'ISSUE_REQUIRES_SERVICE_TYPE' }
  }

  const statementText = (input.statement_text ?? input.notes ?? '').trim()
  if (statementText.length < 3) {
    throw { status: 422, error: 'البيان مطلوب ويجب ألا يقل عن 3 أحرف', code: 'ISSUE_REQUIRES_STATEMENT' }
  }

  const [seasonValid, centerValid, serviceKnown] = await Promise.all([
    isActiveSeason(db, companyId, input.season_id),
    isActiveCenterCode(db, companyId, input.center_code),
    isKnownServiceType(db, companyId, input.service_type_code.trim()),
  ])

  if (!seasonValid) {
    throw { status: 422, error: `الموسم ${input.season_id} غير موجود أو مغلق`, code: 'INVALID_SEASON' }
  }
  if (!centerValid) {
    throw { status: 422, error: 'مركز التكلفة غير موجود أو غير نشط', code: 'INVALID_CENTER' }
  }
  if (!serviceKnown) {
    throw { status: 422, error: 'service_type_code غير معروف أو غير نشط', code: 'UNKNOWN_SERVICE_TYPE_CODE' }
  }

  return {
    seasonId:        input.season_id,
    centerCode:      input.center_code,
    fieldId:         input.field_id ?? null,
    serviceTypeCode: input.service_type_code.trim(),
    statementText,
    fieldWarning: !input.field_id
      ? 'field_id غير محدد — إمكانية التتبع على مستوى القطعة محدودة'
      : null,
  }
}

// ── Composite: GRN dimension guard ────────────────────────────────────────────
// Validates mandatory dimensions for an inventory GRN (استلام).

export async function enforceGrnDimensions(
  db: D1Database,
  companyId: number,
  input: {
    season_id?:       number
    supplier_code?:   number
    document_number?: number | string
  },
): Promise<void> {
  if (!input.supplier_code) {
    throw { status: 422, error: 'كود المورد مطلوب في استلام المخزون GRN', code: 'GRN_REQUIRES_SUPPLIER' }
  }
  if (!input.document_number) {
    throw { status: 422, error: 'رقم المستند مطلوب في استلام المخزون GRN', code: 'GRN_REQUIRES_DOCUMENT' }
  }
  if (!input.season_id) {
    throw { status: 422, error: 'الموسم مطلوب في استلام المخزون GRN', code: 'GRN_REQUIRES_SEASON' }
  }

  const seasonValid = await isActiveSeason(db, companyId, input.season_id)
  if (!seasonValid) {
    throw { status: 422, error: `الموسم ${input.season_id} غير موجود أو مغلق`, code: 'INVALID_SEASON' }
  }
}

// ── Composite: Supplier Invoice dimension guard ───────────────────────────────
// Validates mandatory dimensions per TARGET_ARCHITECTURE §3.3 and §4.5.
// entry_type='د' (invoice): requires season_id, center_code, service_type_code,
//   document_number, due_date.
// entry_type='م' (payment): requires season_id, financial_account_id.

export async function enforceSupplierTxnDimensions(
  db: D1Database,
  companyId: number,
  input: {
    entry_type:         string
    season_id?:         number
    center_code?:       number
    service_type_code?: string
    document_number?:   string | number
    due_date?:          string
    financial_account_id?: number
  },
): Promise<void> {
  const isInvoice = input.entry_type === 'د'
  const isPayment = input.entry_type === 'م'

  if (!isInvoice && !isPayment) {
    throw { status: 400, error: `entry_type غير صحيح: ${input.entry_type}`, code: 'INVALID_ENTRY_TYPE' }
  }

  if (!input.season_id) {
    throw { status: 422, error: 'season_id مطلوب في جميع معاملات الموردين', code: 'SUPPLIER_TXN_REQUIRES_SEASON' }
  }

  if (isInvoice) {
    if (!input.center_code) {
      throw { status: 422, error: 'center_code مطلوب في فاتورة المورد', code: 'INVOICE_REQUIRES_CENTER' }
    }
    if (!input.service_type_code?.trim()) {
      throw { status: 422, error: 'service_type_code مطلوب في فاتورة المورد', code: 'INVOICE_REQUIRES_SERVICE_TYPE' }
    }
    if (!input.document_number) {
      throw { status: 422, error: 'رقم المستند مطلوب في فاتورة المورد', code: 'INVOICE_REQUIRES_DOCUMENT' }
    }
    if (!input.due_date) {
      throw { status: 422, error: 'due_date مطلوب في فاتورة المورد (لحساب الذمم المتأخرة)', code: 'INVOICE_REQUIRES_DUE_DATE' }
    }
  }

  if (isPayment && !input.financial_account_id) {
    throw { status: 422, error: 'financial_account_id مطلوب في سداد المورد (الحساب المدفوع منه)', code: 'PAYMENT_REQUIRES_ACCOUNT' }
  }

  // Async validations
  const checks: Promise<void>[] = [
    isActiveSeason(db, companyId, input.season_id).then(ok => {
      if (!ok) throw { status: 422, error: `الموسم ${input.season_id} غير موجود أو مغلق`, code: 'INVALID_SEASON' }
    }),
  ]

  if (isInvoice && input.center_code) {
    checks.push(
      isActiveCenterCode(db, companyId, input.center_code).then(ok => {
        if (!ok) throw { status: 422, error: 'مركز التكلفة غير موجود أو غير نشط', code: 'INVALID_CENTER' }
      }),
    )
  }

  if (isInvoice && input.service_type_code?.trim()) {
    checks.push(
      isKnownServiceType(db, companyId, input.service_type_code.trim()).then(ok => {
        if (!ok) throw { status: 422, error: `service_type_code '${input.service_type_code}' غير معروف`, code: 'UNKNOWN_SERVICE_TYPE_CODE' }
      }),
    )
  }

  await Promise.all(checks)
}
