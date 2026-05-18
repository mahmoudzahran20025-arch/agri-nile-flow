import type { LineItem, MovementHeader, MovementDimensions } from '../../components/workspace/types'
import type { ItemExtra } from '../../components/workspace/spreadsheet/SpreadsheetLookupCell'

export type WorkspaceCommand =
  // ─── Line Commands ───────────────────────────────────────────────────────────
  | { type: 'ADD_ROW'; payload?: Partial<LineItem> }
  | { type: 'REMOVE_ROW'; rowId: string }
  | { type: 'UPDATE_CELL'; rowId: string; field: keyof LineItem; value: unknown; extra?: ItemExtra }
  | { type: 'APPLY_EXCEL_PASTE'; startRowId: string; rows: Partial<LineItem>[] }
  // ─── Header Commands ─────────────────────────────────────────────────────────
  | { type: 'UPDATE_HEADER'; field: keyof MovementHeader; value: unknown }
  | { type: 'REPLACE_HEADER'; payload: MovementHeader }
  // ─── Dimensions Commands ─────────────────────────────────────────────────────
  | { type: 'UPDATE_DIMENSIONS'; field: keyof MovementDimensions; value: unknown }
  | { type: 'REPLACE_DIMENSIONS'; payload: MovementDimensions }
  // ─── Meta / Lifecycle Commands (Orchestrator Level) ──────────────────────────
  | { type: 'SET_LINES'; payload: LineItem[] } // For bulk restore/init
