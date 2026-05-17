import { useReducer } from 'react'
import { type LineItem, createEmptyLine } from '../../components/workspace/types'
import type { WorkspaceCommand } from './commands'

function lineReducer(state: LineItem[], action: WorkspaceCommand): LineItem[] {
  switch (action.type) {
    case 'SET_LINES':
      return action.payload
    case 'ADD_ROW':
      return [...state, { ...createEmptyLine(), ...action.payload }]
    case 'REMOVE_ROW':
      return state.length > 1 ? state.filter((l) => l._key !== action.rowId) : state
    case 'UPDATE_CELL':
      return state.map((l) =>
        l._key === action.rowId ? { ...l, [action.field]: action.value } : l
      )
    case 'APPLY_EXCEL_PASTE': {
      // Find starting index
      const startIndex = state.findIndex(l => l._key === action.startRowId)
      if (startIndex === -1) return state

      const newState = [...state]
      
      // Overwrite existing rows from start
      let stateIdx = startIndex
      let pasteIdx = 0
      while (stateIdx < newState.length && pasteIdx < action.rows.length) {
        newState[stateIdx] = { ...newState[stateIdx], ...action.rows[pasteIdx] }
        stateIdx++
        pasteIdx++
      }
      
      // Append any remaining pasted rows
      while (pasteIdx < action.rows.length) {
        newState.push({ ...createEmptyLine(), ...action.rows[pasteIdx] })
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
