import { useState, useCallback, useRef } from 'react'
import type { LineItem, ValidationIssue, MovementHeader, MovementDimensions } from '../../../components/workspace/types'

export type RowValidationState = {
  isValidating: boolean
  errors:       ValidationIssue[]
  warnings:     ValidationIssue[]
}

/**
 * Deterministic validation scheduler.
 * Validates state without blocking typing or mutating the core Reducer directly.
 */
export function useWorkspaceValidationScheduler() {
  const [rowValidation, setRowValidation] = useState<Record<string, RowValidationState>>({})
  const [globalValidation, setGlobalValidation] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] })
  
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const validationTokenRef = useRef(0)

  // This would eventually tie into an async engine or GL preview rules
  const scheduleValidation = useCallback((
    header: MovementHeader,
    _dimensions: MovementDimensions,
    lines: LineItem[]
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current)

    const token = ++validationTokenRef.current

    // Debounce validation so rapid typing doesn't spam calculation
    timerRef.current = setTimeout(async () => {
      // 1. Sync Structural Validation
      const nextRowState: Record<string, RowValidationState> = {}
      const globalErrors: string[] = []

      // Example structural rules
      if (!header.movement_date) globalErrors.push('التاريخ مطلوب')
      if (header.movement_type === 'TRANSFER_OUT' && !header.target_warehouse_id) {
        globalErrors.push('مخزن الوجهة مطلوب في التحويل')
      }

      for (const line of lines) {
        const errors: ValidationIssue[] = []
        
        // Empty lines are ignored unless it's the only line
        const isEmpty = !line.item_code && !line.item_name && !line.quantity
        if (isEmpty && lines.length > 1) continue

        if (line.item_name && !line.item_code) {
          errors.push({ line_index: null, field: 'item_code', message: 'يرجى تأكيد الصنف من القائمة', severity: 'error' })
        }
        
        if (line.item_code && (line.quantity === null || line.quantity <= 0)) {
          errors.push({ line_index: null, field: 'quantity', message: 'الكمية يجب أن تكون أكبر من صفر', severity: 'error' })
        }

        if (errors.length > 0) {
          nextRowState[line._key] = { isValidating: false, errors, warnings: [] }
        }
      }

      // 2. Async Validation (Phase 2 placeholder)
      // e.g. check stock balances for ISSUE types

      // Commit validation state
      if (validationTokenRef.current === token) {
        setRowValidation(nextRowState)
        setGlobalValidation({ errors: globalErrors, warnings: [] })
      }
    }, 400)
  }, [])

  return { rowValidation, globalValidation, scheduleValidation }
}
