import { useCallback } from 'react'
import { Plus } from 'lucide-react'
import type { LineItem, MovementType } from './types'
import { isInboundType } from './types'
import LineRow from './LineRow'
import { useSpreadsheetController } from '../../hooks/workspace/spreadsheet/useSpreadsheetController'

const FIELDS = ['item_code', 'pack_count', 'quantity', 'unit_price']

// TSV column order expected from Excel paste: name/code, quantity, unit_price
function parseTsvToLineItems(tsv: string): Partial<LineItem>[] {
  return tsv
    .split('\n')
    .map(row => row.trim())
    .filter(Boolean)
    .map(row => {
      const cols = row.split('\t').map(c => c.trim())
      const parsed: Partial<LineItem> = {}
      const col0 = cols[0] ?? ''
      const numericCode = Number(col0)
      if (!isNaN(numericCode) && numericCode > 0 && !col0.includes('.')) {
        parsed.item_code = numericCode
      } else if (col0) {
        parsed.item_name = col0
      }
      if (cols[1] !== undefined) {
        const qty = parseFloat(cols[1])
        if (!isNaN(qty)) parsed.quantity = qty
      }
      if (cols[2] !== undefined) {
        const price = parseFloat(cols[2])
        if (!isNaN(price)) parsed.unit_price = price
      }
      return parsed
    })
    .filter(r => Object.keys(r).length > 0)
}

interface Props {
  lines:         LineItem[]
  movementType:  MovementType
  warehouse:     number | null
  onAddLine:     () => void
  onRemoveLine:  (key: string) => void
  onUpdateLine:  (rowId: string, field: string, value: unknown, extra?: { name?: string; unit?: string | null }) => void
  onApplyPaste?: (startRowId: string, rows: Partial<LineItem>[]) => void
}

export default function LineEditor({ lines, movementType, warehouse, onAddLine, onRemoveLine, onUpdateLine, onApplyPaste }: Props) {
  const isIn        = isInboundType(movementType)
  const filledCount = lines.filter(l => l.item_code !== null).length
  const isOnlyLine  = lines.length === 1

  const rowIds = lines.map(l => l._key)

  const {
    activeCell, editingCell,
    registerCell,
    beginEdit, commitEdit, cancelEdit,
    navigateRelative,
  } = useSpreadsheetController(rowIds, FIELDS)

  const handleGridPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!onApplyPaste) return
    const tsv = e.clipboardData.getData('text/plain')
    if (!tsv.includes('\t')) return // not a spreadsheet paste — let default handle it
    e.preventDefault()
    const rows = parseTsvToLineItems(tsv)
    if (rows.length === 0) return
    const startRowId = activeCell?.rowId ?? lines[0]?._key
    if (!startRowId) return
    onApplyPaste(startRowId, rows)
  }, [onApplyPaste, activeCell, lines])

  const handleUpdateCell = (
    rowId: string,
    field: string,
    value: unknown,
    extra?: { name?: string; unit?: string | null },
  ) => {
    // item_code selection also carries name + unit — propagate them
    if (field === 'item_code' && extra) {
      onUpdateLine(rowId, 'item_code',  value,       extra)
      onUpdateLine(rowId, 'item_name',  extra.name  ?? '', undefined)
      onUpdateLine(rowId, 'item_unit',  extra.unit  ?? '', undefined)
    } else {
      onUpdateLine(rowId, field, value, extra)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Horizontally scrollable wrapper for tablet/mobile */}
      <div className="flex-1 flex flex-col min-h-0 overflow-x-auto">
      {/* Column headers */}
      <div
        className="grid gap-0 px-0 py-2 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0"
        style={{ gridTemplateColumns: '32px 2fr 80px 90px 90px 90px 80px 28px', minWidth: '700px' }}
      >
        <span className="text-center">#</span>
        <span className="px-2">الصنف</span>
        <span className="text-center">أكياس</span>
        <span className="text-center">الكمية</span>
        <span className="text-center">سعر الوحدة</span>
        <span className="text-center">الإجمالي</span>
        <span className="text-center">{isIn ? 'ملاحظة' : 'الرصيد'}</span>
        <span />
      </div>

      {/* Scrollable line area */}
      <div className="flex-1 overflow-y-auto py-1 space-y-0.5 px-2" style={{ minWidth: '700px' }} onPaste={handleGridPaste}>
        {lines.map((line, idx) => (
          <LineRow
            key={line._key}
            line={line}
            idx={idx}
            isIn={isIn}
            isOnlyLine={isOnlyLine}
            onRemove={onRemoveLine}
            activeCell={activeCell}
            editingCell={editingCell}
            onUpdateCell={handleUpdateCell}
            onBeginEdit={beginEdit}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
            onNavigate={navigateRelative}
            registerCell={registerCell}
          />
        ))}

        {/* Add row */}
        <div className="flex items-center gap-3 py-2 px-2">
          <button
            type="button"
            onClick={onAddLine}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 hover:text-slate-700 transition-colors"
          >
            <Plus size={14} />
            إضافة صنف
          </button>
        </div>
      </div>
      </div>{/* end overflow-x-auto wrapper */}

      {/* Footer info */}
      {warehouse && (
        <div className="px-4 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 shrink-0">
          المخزن: <span className="font-semibold text-slate-600">#{warehouse}</span>
          {' · '}
          {filledCount} صنف من {lines.length}
          {' · '}
          <span className="text-slate-300">Tab / Enter للتنقل · Esc للإلغاء</span>
        </div>
      )}
    </div>
  )
}
