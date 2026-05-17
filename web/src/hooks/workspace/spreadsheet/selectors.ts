import type { LineItem } from '../../../components/workspace/types'

export interface RowTotals {
  value: number
  hasMissingPrice: boolean
}

export interface MovementTotals {
  totalQuantity: number
  totalValue:    number
  lineCount:     number
}

/**
 * Pure derived selector.
 * Calculates row-level totals without mutating the reducer.
 */
export function selectRowTotals(line: LineItem): RowTotals {
  const q = line.quantity ?? 0
  const p = line.unit_price ?? 0
  
  return {
    value: q * p,
    hasMissingPrice: q > 0 && p === 0
  }
}

/**
 * Pure derived selector.
 * Calculates aggregate totals for the workspace footer.
 */
export function selectMovementTotals(lines: LineItem[]): MovementTotals {
  let q = 0
  let v = 0
  let count = 0

  for (const line of lines) {
    if (line.item_code) {
      count++
      const lq = line.quantity ?? 0
      const lp = line.unit_price ?? 0
      q += lq
      v += (lq * lp)
    }
  }

  // If outbound, you might want to sign the value, but UI generally handles display signs.
  return {
    totalQuantity: q,
    totalValue: v,
    lineCount: count
  }
}
