import type { LineItem } from '../../../components/workspace/types'

/**
 * Deterministic TSV parser for Excel-style clipboard data.
 * Does NOT generate UUIDs; UUID generation is strictly owned by the Reducer.
 */
export function parseSpreadsheetPaste(text: string): Partial<LineItem>[] {
  if (!text || typeof text !== 'string') return []

  const rows = text.split(/\r?\n/)
  const result: Partial<LineItem>[] = []

  for (const row of rows) {
    if (!row.trim()) continue

    const cells = row.split('\t')
    
    // Mapping heuristic (can be expanded later for dynamic column mapping)
    // Assuming standard copy from our grid: [ItemName/Code, PackCount, Quantity, UnitPrice, Notes]
    const parsedRow: Partial<LineItem> = {}

    if (cells[0]) {
      // Attempt to parse as code if numeric, else just item_name (Phase 2 smart search will resolve it)
      const code = parseInt(cells[0].trim(), 10)
      if (!isNaN(code) && code > 0) {
        parsedRow.item_code = code
      } else {
        parsedRow.item_name = cells[0].trim()
      }
    }
    
    if (cells[1]) {
      const p = parseFloat(cells[1].replace(/,/g, '').trim())
      if (!isNaN(p)) parsedRow.pack_count = p
    }

    if (cells[2]) {
      const q = parseFloat(cells[2].replace(/,/g, '').trim())
      if (!isNaN(q)) parsedRow.quantity = q
    }

    if (cells[3]) {
      const u = parseFloat(cells[3].replace(/,/g, '').trim())
      if (!isNaN(u)) parsedRow.unit_price = u
    }

    if (cells[4]) {
      parsedRow.notes = cells[4].trim()
    }

    // Only add if at least one meaningful cell was parsed
    if (Object.keys(parsedRow).length > 0) {
      result.push(parsedRow)
    }
  }

  return result
}
