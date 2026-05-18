import { memo, useState, useEffect, useRef, useCallback } from 'react'
import { useAsyncLookup } from '../../../hooks/workspace/spreadsheet/useAsyncLookup'
import { inventoryApi } from '../../../api/client'
import { Loader2 } from 'lucide-react'

interface ItemOption {
  code: number
  name: string
  unit: string | null
}

interface SpreadsheetLookupCellProps {
  rowId: string
  field: string
  value: number | null
  displayValue: string
  isActive?: boolean
  isEditing?: boolean
  error?: string
  onChange: (rowId: string, field: string, value: number | null, extra?: { name: string; unit: string | null }) => void
  onBeginEdit: (rowId: string, field: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onNavigate: (rowDelta: number, colDelta: number, expand?: boolean) => void
  registerCell: (rowId: string, field: string, el: HTMLElement | null) => void
}

const SpreadsheetLookupCell = memo(function SpreadsheetLookupCell({
  rowId,
  field,
  value: _value,
  displayValue,
  isActive = false,
  isEditing = false,
  error,
  onChange,
  onBeginEdit,
  onCommitEdit,
  onCancelEdit,
  onNavigate,
  registerCell,
}: SpreadsheetLookupCellProps) {
  const [localText, setLocalText] = useState(displayValue)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const isComposingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { search, clear, results, loading } = useAsyncLookup<ItemOption>({
    queryFn: async (q) => {
      const res = await inventoryApi.itemsMaster({ search: q, size: 50 })
      const items = (res as any)?.data ?? []
      return (items as ItemOption[]).filter(i => i.name.includes(q) || String(i.code).includes(q)).slice(0, 50)
    },
    debounceMs: 250
  })

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [results])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!dropdownRef.current) return
    const item = dropdownRef.current.children[highlightedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  // Register cell
  useEffect(() => {
    registerCell(rowId, field, inputRef.current)
    return () => registerCell(rowId, field, null)
  }, [rowId, field, registerCell])

  // Sync external display value
  useEffect(() => {
    if (!isEditing) {
      setLocalText(displayValue)
      clear()
    }
  }, [displayValue, isEditing, clear])

  const commitSelection = useCallback((option: ItemOption | null) => {
    if (option) {
      setLocalText(option.name)
      onChange(rowId, field, option.code, { name: option.name, unit: option.unit })
    } else {
      if (!localText.trim()) {
        onChange(rowId, field, null, { name: '', unit: null })
      } else {
        setLocalText(displayValue)
      }
    }
    clear()
    onCommitEdit()
  }, [localText, displayValue, rowId, field, onChange, clear, onCommitEdit])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposingRef.current) return

    if (!isEditing) {
      switch (e.key) {
        case 'Enter':
        case 'F2':
          e.preventDefault()
          onBeginEdit(rowId, field)
          return
        case 'ArrowUp':
          e.preventDefault()
          onNavigate(-1, 0, e.shiftKey)
          return
        case 'ArrowDown':
          e.preventDefault()
          onNavigate(1, 0, e.shiftKey)
          return
        case 'ArrowLeft':
          e.preventDefault()
          onNavigate(0, -1, e.shiftKey)
          return
        case 'ArrowRight':
          e.preventDefault()
          onNavigate(0, 1, e.shiftKey)
          return
        case 'Tab':
          e.preventDefault()
          onNavigate(0, e.shiftKey ? -1 : 1)
          return
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            onBeginEdit(rowId, field)
            setLocalText('')
          }
      }
    } else {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          setLocalText(displayValue)
          clear()
          onCancelEdit()
          return

        case 'ArrowDown':
          e.preventDefault()
          if (results.length > 0) {
            setHighlightedIndex(i => Math.min(i + 1, results.length - 1))
          } else {
            commitSelection(null)
            onNavigate(1, 0)
          }
          return

        case 'ArrowUp':
          e.preventDefault()
          if (results.length > 0) {
            setHighlightedIndex(i => Math.max(i - 1, 0))
          } else {
            commitSelection(null)
            onNavigate(-1, 0)
          }
          return

        case 'Enter':
          e.preventDefault()
          if (results.length > 0) {
            commitSelection(results[highlightedIndex] ?? results[0])
          } else {
            commitSelection(null)
          }
          if (!e.shiftKey) onNavigate(1, 0)
          return

        case 'Tab':
          e.preventDefault()
          if (results.length > 0) {
            commitSelection(results[highlightedIndex] ?? results[0])
          } else {
            commitSelection(null)
          }
          onNavigate(0, e.shiftKey ? -1 : 1)
          return
      }
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isEditing) {
      setLocalText(e.target.value)
      search(e.target.value)
    }
  }

  return (
    <div
      className={`relative w-full h-full flex items-center border ${
        isActive ? 'border-brand-500 ring-1 ring-brand-500 z-20' : 'border-transparent'
      } ${error ? 'bg-red-50' : 'bg-transparent'}`}
      onClick={() => {
        if (!isActive) inputRef.current?.focus()
      }}
      onDoubleClick={() => !isEditing && onBeginEdit(rowId, field)}
    >
      <input
        ref={inputRef}
        type="text"
        className={`w-full h-full px-2 py-1 outline-none text-sm bg-transparent text-right ${
          isEditing ? 'text-slate-800' : 'text-slate-600 cursor-default'
        } ${error ? 'text-red-700' : ''}`}
        value={isEditing ? localText : displayValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setTimeout(() => {
            if (isEditing) commitSelection(null)
          }, 150)
        }}
        onCompositionStart={() => { isComposingRef.current = true }}
        onCompositionEnd={() => { isComposingRef.current = false }}
        readOnly={!isEditing}
        tabIndex={-1}
        placeholder={isActive && !isEditing ? '' : '...'}
      />

      {loading && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-500">
          <Loader2 size={12} className="animate-spin" />
        </div>
      )}

      {error && !isEditing && (
        <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-bl-sm" title={error} />
      )}

      {isEditing && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full right-0 w-64 max-h-48 overflow-y-auto bg-white border border-slate-200 shadow-xl z-50 rounded-b-md"
        >
          {results.map((item, idx) => (
            <div
              key={item.code}
              className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between transition-colors ${
                idx === highlightedIndex
                  ? 'bg-brand-100 text-brand-800'
                  : 'hover:bg-slate-50'
              }`}
              onMouseEnter={() => setHighlightedIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                commitSelection(item)
                onNavigate(1, 0)
              }}
            >
              <div className="font-medium text-slate-800">{item.name}</div>
              <div className="text-[10px] text-slate-400">#{item.code}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default SpreadsheetLookupCell
