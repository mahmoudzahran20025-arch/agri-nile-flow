import { Plus, Clipboard } from 'lucide-react'
import type { LineItem, MovementType } from './types'
import { isInboundType } from './types'
import LineRow from './LineRow'

interface Props {
  lines:        LineItem[]
  movementType: MovementType
  warehouse:    number | null
  onAddLine:    () => void
  onRemoveLine: (key: string) => void
}

export default function LineEditor({ lines, movementType, warehouse, onAddLine, onRemoveLine }: Props) {
  const isIn       = isInboundType(movementType)
  const filledCount = lines.filter(l => l.item_code !== null).length
  const isOnlyLine  = lines.length === 1

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Column headers */}
      <div
        className="grid gap-2 px-6 py-2 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0"
        style={{ gridTemplateColumns: '32px 2fr 80px 80px 90px 90px 80px 28px' }}
      >
        <span>#</span>
        <span>الصنف</span>
        <span className="text-center">أكياس</span>
        <span className="text-center">الكمية</span>
        <span className="text-center">سعر الوحدة</span>
        <span className="text-center">الإجمالي</span>
        <span className="text-center">{isIn ? 'ملاحظة' : 'الرصيد'}</span>
        <span />
      </div>

      {/* Scrollable line area */}
      <div className="flex-1 overflow-y-auto px-6 py-2 space-y-1">
        {lines.map((line, idx) => (
          <LineRow
            key={line._key}
            line={line}
            idx={idx}
            isIn={isIn}
            isOnlyLine={isOnlyLine}
            onRemove={onRemoveLine}
          />
        ))}

        {/* Add row placeholder */}
        <div className="flex items-center gap-3 py-2 px-2">
          <button
            type="button"
            onClick={onAddLine}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-slate-700 transition-colors"
          >
            <Plus size={14} />
            إضافة صنف
          </button>
          <span className="text-slate-200">|</span>
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-300 cursor-not-allowed"
            title="Phase 2: لصق من Excel"
          >
            <Clipboard size={13} />
            لصق من Excel
          </button>
        </div>
      </div>

      {/* Footer info */}
      {warehouse && (
        <div className="px-6 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 shrink-0">
          المخزن: <span className="font-semibold text-slate-600">#{warehouse}</span>
          {' · '}
          {filledCount} صنف من {lines.length}
        </div>
      )}
    </div>
  )
}
