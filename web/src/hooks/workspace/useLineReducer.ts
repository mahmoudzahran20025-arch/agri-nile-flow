import { useReducer } from 'react'
import { type LineItem, createEmptyLine } from '../../components/workspace/types'
import type { WorkspaceCommand } from './commands'
import type { ItemExtra } from '../../components/workspace/spreadsheet/SpreadsheetLookupCell'

/**
 * Packaging normalization: if item has package_capacity and user enters pack_count,
 * quantity is auto-derived and locked read-only.
 * If user clears pack_count, quantity reverts to manual entry.
 */
function applyPackagingNormalization(line: LineItem): LineItem {
  if (line.package_capacity != null && line.package_capacity > 0 && line.pack_count != null) {
    const derived = Math.round((line.pack_count * line.package_capacity) * 1000) / 1000
    return { ...line, quantity: derived, _qty_derived: true }
  }
  // No packaging context — allow manual quantity
  return { ...line, _qty_derived: false }
}

/**
 * After quantity or total_value changes, keep unit_price consistent.
 * unit_price = total_value / quantity (user enters total, we compute per-unit).
 * If total_value is not set, fall back to unit_price as-is.
 */
function applyValuationSync(line: LineItem): LineItem {
  const qty = line.quantity
  const tv  = line.total_value
  if (tv != null && qty != null && qty > 0) {
    return { ...line, unit_price: Math.round((tv / qty) * 10000) / 10000 }
  }
  return line
}

function applyItemSelection(line: LineItem, extra: ItemExtra): LineItem {
  const updated: LineItem = {
    ...line,
    item_name:        extra.name,
    item_unit:        extra.unit ?? '',
    package_type:     extra.package_type,
    package_capacity: extra.package_capacity,
    // Reset packaging fields when item changes
    pack_count:       null,
    quantity:         null,
    _qty_derived:     false,
    total_value:      null,
    unit_price:       null,
  }
  return updated
}

function lineReducer(state: LineItem[], action: WorkspaceCommand): LineItem[] {
  switch (action.type) {

    case 'SET_LINES':
      // On load, recompute _qty_derived for any lines that have pack_count + package_capacity
      return action.payload.map(l => applyPackagingNormalization(l))

    case 'ADD_ROW':
      return [...state, { ...createEmptyLine(), ...action.payload }]

    case 'REMOVE_ROW':
      return state.length > 1 ? state.filter((l) => l._key !== action.rowId) : state

    case 'UPDATE_CELL': {
      return state.map((l) => {
        if (l._key !== action.rowId) return l

        // Item selection — apply packaging metadata
        if (action.field === 'item_code' && action.extra) {
          const extra = action.extra as ItemExtra
          return applyItemSelection(l, extra)
        }

        let updated = { ...l, [action.field]: action.value }

        // Packaging: when pack_count changes, re-derive quantity
        if (action.field === 'pack_count') {
          updated = applyPackagingNormalization(updated)
        }

        // If user directly edits quantity while not derived, clear _qty_derived
        if (action.field === 'quantity' && !l._qty_derived) {
          updated._qty_derived = false
        }

        // Valuation sync: total_value or quantity change → update unit_price
        if (action.field === 'total_value' || action.field === 'quantity') {
          updated = applyValuationSync(updated)
        }

        // If user enters unit_price directly, clear total_value to avoid conflict
        if (action.field === 'unit_price') {
          updated.total_value = null
        }

        return updated
      })
    }

    case 'APPLY_EXCEL_PASTE': {
      const startIndex = state.findIndex(l => l._key === action.startRowId)
      if (startIndex === -1) return state

      const newState = [...state]
      let stateIdx = startIndex
      let pasteIdx = 0
      while (stateIdx < newState.length && pasteIdx < action.rows.length) {
        const merged = { ...newState[stateIdx], ...action.rows[pasteIdx] }
        newState[stateIdx] = applyValuationSync(applyPackagingNormalization(merged))
        stateIdx++
        pasteIdx++
      }
      while (pasteIdx < action.rows.length) {
        const merged = { ...createEmptyLine(), ...action.rows[pasteIdx] }
        newState.push(applyValuationSync(applyPackagingNormalization(merged)))
        pasteIdx++
      }
      return newState
    }

    default:
      return state
  }
}

export function useLineReducer(initialLines: LineItem[]) {
  const [lines, dispatchLineCommand] = useReducer(lineReducer, initialLines)
  return { lines, dispatchLineCommand }
}
