import { useRef, useCallback } from 'react'

export type CellCoordinate = {
  rowId: string
  field: string
}

export function buildCellKey(rowId: string, field: string) {
  return `${rowId}::${field}`
}

export function useSpreadsheetFocusManager() {
  // Registry of DOM elements, virtualization safe because unmounted cells 
  // simply overwrite or delete their registry entry, and remounted ones re-register.
  const cellRegistryRef = useRef<Map<string, HTMLElement>>(new Map())

  const registerCell = useCallback((rowId: string, field: string, element: HTMLElement | null) => {
    const key = buildCellKey(rowId, field)
    if (element) {
      cellRegistryRef.current.set(key, element)
    } else {
      cellRegistryRef.current.delete(key)
    }
  }, [])

  const focusCell = useCallback((rowId: string, field: string) => {
    const key = buildCellKey(rowId, field)
    const el = cellRegistryRef.current.get(key)
    if (el) {
      el.focus()
      // If it's an input, select the text for quick overwrite
      if (el instanceof HTMLInputElement) {
        el.select()
      }
      return true
    }
    return false
  }, [])

  return {
    registerCell,
    focusCell,
    cellRegistryRef
  }
}
