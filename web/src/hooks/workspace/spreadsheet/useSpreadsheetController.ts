import { useState, useCallback, useRef } from 'react'
import { useSpreadsheetFocusManager } from './useSpreadsheetFocusManager'

export interface CellAddress {
  rowId: string
  field: string
}

export interface SelectionRange {
  start: CellAddress | null
  end:   CellAddress | null
}

export function useSpreadsheetController(orderedRowIds: string[], fields: string[]) {
  // Interaction State only. No business data.
  const [activeCell, setActiveCell]   = useState<CellAddress | null>(null)
  const [editingCell, setEditingCell] = useState<CellAddress | null>(null)
  const [selection, setSelection]     = useState<SelectionRange>({ start: null, end: null })
  
  const { registerCell, focusCell: focusDomCell } = useSpreadsheetFocusManager()

  // Ref-based active state for keyboard event listeners (avoids stale closures)
  const activeRef = useRef<CellAddress | null>(null)
  const isEditingRef = useRef(false)
  const rowIdsRef = useRef(orderedRowIds)
  const fieldsRef = useRef(fields)

  // Sync refs to avoid stale closures in keydown handlers
  rowIdsRef.current = orderedRowIds
  fieldsRef.current = fields

  const focusCell = useCallback((rowId: string, field: string, expandSelection = false) => {
    const addr = { rowId, field }
    setActiveCell(addr)
    
    setSelection(prev => ({
      start: expandSelection && prev.start ? prev.start : addr,
      end: addr
    }))
    
    activeRef.current = addr
    focusDomCell(rowId, field)
  }, [focusDomCell])

  const beginEdit = useCallback((rowId: string, field: string) => {
    const addr = { rowId, field }
    setActiveCell(addr)
    setEditingCell(addr)
    isEditingRef.current = true
    activeRef.current = addr
  }, [])

  const commitEdit = useCallback(() => {
    setEditingCell(null)
    isEditingRef.current = false
    // Note: The UI component will dispatch the UPDATE_CELL command.
    if (activeRef.current) {
      focusDomCell(activeRef.current.rowId, activeRef.current.field)
    }
  }, [focusDomCell])

  const cancelEdit = useCallback(() => {
    setEditingCell(null)
    isEditingRef.current = false
    if (activeRef.current) {
      focusDomCell(activeRef.current.rowId, activeRef.current.field)
    }
  }, [focusDomCell])

  const navigateRelative = useCallback((rowDelta: number, colDelta: number, expandSelection = false) => {
    if (!activeRef.current) return

    const currentRowIdx = rowIdsRef.current.indexOf(activeRef.current.rowId)
    const currentColIdx = fieldsRef.current.indexOf(activeRef.current.field)

    if (currentRowIdx === -1 || currentColIdx === -1) return

    const nextRowIdx = Math.max(0, Math.min(rowIdsRef.current.length - 1, currentRowIdx + rowDelta))
    const nextColIdx = Math.max(0, Math.min(fieldsRef.current.length - 1, currentColIdx + colDelta))

    const nextRowId = rowIdsRef.current[nextRowIdx]
    const nextField = fieldsRef.current[nextColIdx]

    focusCell(nextRowId, nextField, expandSelection)
  }, [focusCell])

  return {
    activeCell,
    editingCell,
    selection,
    registerCell,
    focusCell,
    beginEdit,
    commitEdit,
    cancelEdit,
    navigateRelative,
  }
}
