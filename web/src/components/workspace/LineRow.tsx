import { memo } from 'react'
import type { LineItem } from './types'

interface LineRowProps {
  line: LineItem
  idx: number
  isIn: boolean
  isOnlyLine: boolean
  onRemove: (key: string) => void
}

const LineRow = memo(function LineRow({ line, idx, isIn, isOnlyLine, onRemove }: LineRowProps) {
  const qty   = line.quantity ?? 0
  const price = line.unit_price ?? 0
  const total = qty * price

  return (
    <div
      className={`grid gap-2 items-center py-2 px-2 rounded-lg border transition-colors ${
        line._error
          ? 'border-red-300 bg-red-50'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
      style={{ gridTemplateColumns: '32px 2fr 80px 80px 90px 90px 80px 28px' }}
    >
      {/* Row number */}
      <span className="text-[11px] text-slate-400 text-center font-mono">
        {idx + 1}
      </span>

      {/* Item — Phase 2: smart search cell */}
      {/* Spreadsheet hot-path — avoid unstable references, keep inline updates contained */}
      <div className="text-sm text-slate-500 italic">
        {line.item_name || (
          <span className="text-slate-300">
            Phase 2: اختر الصنف
          </span>
        )}
      </div>

      {/* Pack count — Phase 2 */}
      <div className="text-center text-sm text-slate-300">—</div>

      {/* Quantity — Phase 2 */}
      <div className="text-center text-sm text-slate-300">
        {line.quantity ?? '—'}
      </div>

      {/* Unit price — Phase 2 */}
      <div className="text-center text-sm text-slate-300">
        {line.unit_price ?? '—'}
      </div>

      {/* Line total */}
      <div className="text-center text-sm font-semibold text-slate-400">
        {total > 0
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(total)
          : '—'
        }
      </div>

      {/* Stock / Notes — Phase 2 */}
      <div className="text-center text-[11px] text-slate-300">—</div>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(line._key)}
        disabled={isOnlyLine}
        className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded disabled:opacity-30"
        title="حذف"
      >
        ×
      </button>
    </div>
  )
})

export default LineRow
