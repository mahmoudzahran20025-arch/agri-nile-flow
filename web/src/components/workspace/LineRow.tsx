import { memo } from 'react'
import type { LineItem } from './types'
import SpreadsheetCell from './spreadsheet/SpreadsheetCell'
import SpreadsheetLookupCell from './spreadsheet/SpreadsheetLookupCell'

interface LineRowProps {
  line:        LineItem
  idx:         number
  isIn:        boolean
  isOnlyLine:  boolean
  onRemove:    (key: string) => void
  // Spreadsheet controller props
  activeCell:  { rowId: string; field: string } | null
  editingCell: { rowId: string; field: string } | null
  onUpdateCell: (rowId: string, field: string, value: unknown, extra?: { name?: string; unit?: string | null }) => void
  onBeginEdit:  (rowId: string, field: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onNavigate:   (rowDelta: number, colDelta: number, expand?: boolean) => void
  registerCell: (rowId: string, field: string, el: HTMLElement | null) => void
}

const FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const EGP = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 })

const LineRow = memo(function LineRow({
  line, idx, isIn, isOnlyLine, onRemove,
  activeCell, editingCell,
  onUpdateCell, onBeginEdit, onCommitEdit, onCancelEdit, onNavigate, registerCell,
}: LineRowProps) {
  const qty   = line.quantity   ?? 0
  const price = line.unit_price ?? 0
  const total = qty * price

  const isActive  = (field: string) => activeCell?.rowId  === line._key && activeCell?.field  === field
  const isEditing = (field: string) => editingCell?.rowId === line._key && editingCell?.field === field

  return (
    <div
      className={`grid gap-0 items-stretch rounded-lg border transition-colors ${
        line._error
          ? 'border-red-300 bg-red-50'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
      style={{ gridTemplateColumns: '32px 2fr 80px 90px 90px 90px 80px 28px', minHeight: '36px' }}
    >
      {/* Row number */}
      <span className="text-[11px] text-slate-400 text-center font-mono flex items-center justify-center border-r border-slate-100">
        {idx + 1}
      </span>

      {/* Item — lookup cell */}
      <div className="border-r border-slate-100">
        <SpreadsheetLookupCell
          rowId={line._key}
          field="item_code"
          value={line.item_code}
          displayValue={line.item_name}
          isActive={isActive('item_code')}
          isEditing={isEditing('item_code')}
          error={line._error ?? undefined}
          onChange={(rowId, field, value, extra) =>
            onUpdateCell(rowId, field, value, extra)
          }
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
          onCancelEdit={onCancelEdit}
          onNavigate={onNavigate}
          registerCell={registerCell}
        />
      </div>

      {/* Pack count */}
      <div className="border-r border-slate-100">
        <SpreadsheetCell
          rowId={line._key}
          field="pack_count"
          value={line.pack_count}
          type="number"
          isActive={isActive('pack_count')}
          isEditing={isEditing('pack_count')}
          onChange={onUpdateCell}
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
          onCancelEdit={onCancelEdit}
          onNavigate={onNavigate}
          registerCell={registerCell}
        />
      </div>

      {/* Quantity */}
      <div className="border-r border-slate-100">
        <SpreadsheetCell
          rowId={line._key}
          field="quantity"
          value={line.quantity}
          type="number"
          isActive={isActive('quantity')}
          isEditing={isEditing('quantity')}
          onChange={onUpdateCell}
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
          onCancelEdit={onCancelEdit}
          onNavigate={onNavigate}
          registerCell={registerCell}
        />
      </div>

      {/* Unit price */}
      <div className="border-r border-slate-100">
        <SpreadsheetCell
          rowId={line._key}
          field="unit_price"
          value={line.unit_price}
          type="number"
          isActive={isActive('unit_price')}
          isEditing={isEditing('unit_price')}
          onChange={onUpdateCell}
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
          onCancelEdit={onCancelEdit}
          onNavigate={onNavigate}
          registerCell={registerCell}
        />
      </div>

      {/* Line total — read-only computed */}
      <div className="flex items-center justify-center border-r border-slate-100">
        <span className="text-sm font-semibold text-slate-600 px-2">
          {total > 0 ? EGP.format(total) : '—'}
        </span>
      </div>

      {/* Stock balance (outbound) or notes badge (inbound) */}
      <div className="flex items-center justify-center border-r border-slate-100 px-1">
        {isIn ? (
          line.notes ? (
            <span className="text-[10px] text-slate-400 truncate max-w-[68px]" title={line.notes}>
              {line.notes}
            </span>
          ) : null
        ) : (
          line._stockLoading ? (
            <span className="text-[10px] text-slate-300">...</span>
          ) : line._available != null ? (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
              line._available < (line.quantity ?? 0)
                ? 'bg-red-100 text-red-700'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {FMT.format(line._available)}
            </span>
          ) : null
        )}
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(line._key)}
        disabled={isOnlyLine}
        className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded disabled:opacity-30 flex items-center justify-center"
        title="حذف"
      >
        ×
      </button>
    </div>
  )
})

export default LineRow
