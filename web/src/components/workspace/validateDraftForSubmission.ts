// Pure pre-flight validator — no side effects, no async, no hooks.
// Run this before calling the posting pipeline to surface all user-facing
// errors in one pass so the UI can show them without a round-trip.

import type { MovementDraft, MovementHeader, MovementDimensions, LineItem, ValidationIssue } from './types'
import { isSupplierType, isTransferType, isInboundType } from './types'

export interface SubmissionValidationResult {
  valid:    boolean
  errors:   ValidationIssue[]
  warnings: ValidationIssue[]
}

// ── Header rules ──────────────────────────────────────────────────────────────

function validateHeader(h: MovementHeader, errors: ValidationIssue[]) {
  if (!h.movement_date) {
    errors.push({ line_index: null, field: 'movement_date', message: 'تاريخ الحركة مطلوب', severity: 'error' })
  } else if (h.movement_date > new Date().toISOString().slice(0, 10)) {
    errors.push({ line_index: null, field: 'movement_date', message: 'غير مسموح بتاريخ مستقبلي', severity: 'error' })
  }

  if (!h.warehouse_id) {
    errors.push({ line_index: null, field: 'warehouse_id', message: 'يجب تحديد المخزن', severity: 'error' })
  }

  if (isSupplierType(h.movement_type) && !h.supplier_code) {
    errors.push({ line_index: null, field: 'supplier_code', message: 'كود المورد مطلوب لهذا النوع من الحركات', severity: 'error' })
  }

  if (isTransferType(h.movement_type) && !h.target_warehouse_id) {
    errors.push({ line_index: null, field: 'target_warehouse_id', message: 'مخزن الوجهة مطلوب في حركات التحويل', severity: 'error' })
  }

  if (h.movement_type === 'GRN' && !h.document_number?.trim()) {
    errors.push({ line_index: null, field: 'document_number', message: 'رقم المستند مطلوب في استلام البضاعة GRN', severity: 'error' })
  }
}

// ── Dimension rules ───────────────────────────────────────────────────────────
// Mirrors server-side enforceIssueDimensions for ISSUE movements.
// GRN mirrors enforceGrnDimensions.

function validateDimensions(
  h: MovementHeader,
  d: MovementDimensions,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
) {
  const isIssue = h.movement_type === 'ISSUE'
  const isGrn   = h.movement_type === 'GRN'

  if (isIssue) {
    if (!d.season_id) {
      errors.push({ line_index: null, field: 'season_id', message: 'الموسم مطلوب لصرف المخزون', severity: 'error' })
    }
    if (!d.center_code) {
      errors.push({ line_index: null, field: 'center_code', message: 'مركز التكلفة مطلوب لصرف المخزون', severity: 'error' })
    }
    if (!d.service_type_code?.trim()) {
      errors.push({ line_index: null, field: 'service_type_code', message: 'نوع الخدمة مطلوب لصرف المخزون', severity: 'error' })
    }
    const stmt = (d.statement_text ?? '').trim()
    if (stmt.length < 3) {
      errors.push({ line_index: null, field: 'statement_text', message: 'البيان مطلوب ولا يقل عن 3 أحرف لصرف المخزون', severity: 'error' })
    }
    if (!d.field_id) {
      warnings.push({ line_index: null, field: 'field_id', message: 'القطعة غير محددة — إمكانية التتبع على مستوى القطعة محدودة', severity: 'warning' })
    }
  }

  if (isGrn) {
    if (!d.season_id) {
      errors.push({ line_index: null, field: 'season_id', message: 'الموسم مطلوب في استلام المخزون GRN', severity: 'error' })
    }
  }

  // Inbound movements that aren't GRN or ISSUE can optionally carry dimensions
  if (!isIssue && !isGrn && isInboundType(h.movement_type)) {
    if (!d.season_id) {
      warnings.push({ line_index: null, field: 'season_id', message: 'يُنصح بتحديد الموسم لتتبع التكاليف', severity: 'warning' })
    }
  }
}

// ── Line rules ────────────────────────────────────────────────────────────────

function validateLines(
  lines: LineItem[],
  movementType: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
) {
  const validLines = lines.filter(l => l.item_code !== null && (l.quantity ?? 0) > 0)

  if (validLines.length === 0) {
    errors.push({ line_index: null, field: 'lines', message: 'يجب إضافة صنف واحد على الأقل بكمية أكبر من صفر', severity: 'error' })
    return
  }

  const isInbound = ['GRN', 'RETURN_CUSTOMER', 'ADJUSTMENT_PROFIT', 'TRANSFER_IN'].includes(movementType)

  lines.forEach((line, idx) => {
    const isEmpty = !line.item_code && !line.item_name && !(line.quantity ?? 0)
    if (isEmpty) return  // skip blank trailing lines

    if (line.item_name && !line.item_code) {
      errors.push({ line_index: idx, field: 'item_code', message: 'يرجى تأكيد الصنف من القائمة', severity: 'error' })
    }

    if (line.item_code && (line.quantity === null || line.quantity <= 0)) {
      errors.push({ line_index: idx, field: 'quantity', message: 'الكمية يجب أن تكون أكبر من صفر', severity: 'error' })
    }

    if (isInbound && (line.unit_price === null || line.unit_price < 0)) {
      warnings.push({ line_index: idx, field: 'unit_price', message: 'سعر الوحدة غير محدد — ستُسجَّل الحركة بسعر صفر', severity: 'warning' })
    }

    if (line._error) {
      errors.push({ line_index: idx, field: 'item_code', message: line._error, severity: 'error' })
    }
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

export function validateDraftForSubmission(draft: MovementDraft): SubmissionValidationResult {
  const errors:   ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  validateHeader(draft.header, errors)
  validateDimensions(draft.header, draft.dimensions, errors, warnings)
  validateLines(draft.lines, draft.header.movement_type, errors, warnings)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
