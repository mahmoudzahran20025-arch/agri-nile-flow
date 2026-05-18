import { memo, useState, useEffect, useRef, useCallback } from 'react'

interface SpreadsheetCellProps {
  rowId: string
  field: string
  value: string | number | null
  type?: 'text' | 'number'
  placeholder?: string
  isActive?: boolean
  isEditing?: boolean
  error?: string
  onChange: (rowId: string, field: string, value: unknown) => void
  onBeginEdit: (rowId: string, field: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onNavigate: (rowDelta: number, colDelta: number, expand?: boolean) => void
  registerCell: (rowId: string, field: string, el: HTMLElement | null) => void
}

const SpreadsheetCell = memo(function SpreadsheetCell({
  rowId,
  field,
  value,
  type = 'text',
  placeholder,
  isActive = false,
  isEditing = false,
  error,
  onChange,
  onBeginEdit,
  onCommitEdit,
  onCancelEdit,
  onNavigate,
  registerCell,
}: SpreadsheetCellProps) {
  // Local draft state for the controlled commit model
  const [localValue, setLocalValue] = useState<string>(value == null ? '' : String(value))
  
  // Keep local sync'd with external value changes ONLY when not editing
  useEffect(() => {
    if (!isEditing) {
      setLocalValue(value == null ? '' : String(value))
    }
  }, [value, isEditing])

  const isComposingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Register cell for virtualization-safe focus management
  useEffect(() => {
    registerCell(rowId, field, inputRef.current)
    return () => registerCell(rowId, field, null)
  }, [rowId, field, registerCell])

  const commitLocalValue = useCallback(() => {
    let finalValue: unknown = localValue
    if (type === 'number') {
      if (localValue.trim() === '') {
        finalValue = null
      } else {
        const parsed = parseFloat(localValue)
        finalValue = isNaN(parsed) ? null : parsed
      }
    }
    
    if (finalValue !== value) {
      onChange(rowId, field, finalValue)
    }
    onCommitEdit()
  }, [localValue, type, value, rowId, field, onChange, onCommitEdit])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME Safety: Ignore navigation/commits during composition
    if (isComposingRef.current) return

    if (!isEditing) {
      // Navigation Mode
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
        // Typing letters/numbers immediately begins edit and overwrites
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            onBeginEdit(rowId, field)
            // React handles the event bubbling to the input implicitly
          }
      }
    } else {
      // Edit Mode
      switch (e.key) {
        case 'Enter':
          e.preventDefault()
          commitLocalValue()
          // Excel behavior: move down on enter
          if (!e.shiftKey) onNavigate(1, 0)
          return
        case 'Escape':
          e.preventDefault()
          setLocalValue(value == null ? '' : String(value))
          onCancelEdit()
          return
        case 'Tab':
          e.preventDefault()
          commitLocalValue()
          onNavigate(0, e.shiftKey ? -1 : 1)
          return
        case 'ArrowUp':
        case 'ArrowDown':
          // In standard grid, up/down commit and move. 
          // (Left/Right just move cursor inside text unless at edges, 
          // but we'll stick to basic commit for up/down for now).
          e.preventDefault()
          commitLocalValue()
          onNavigate(e.key === 'ArrowUp' ? -1 : 1, 0)
          return
      }
    }
  }

  const handleBlur = () => {
    if (isEditing) {
      commitLocalValue()
    }
  }

  const handleClick = () => {
    if (!isActive) {
      inputRef.current?.focus() // Triggers focusManager implicitly via bubbling or handles directly
      // In a real grid, you'd call focusCell(rowId, field) here, but we pass events up.
    }
  }
  
  const handleDoubleClick = () => {
    if (!isEditing) {
      onBeginEdit(rowId, field)
    }
  }

  return (
    <div 
      className={`relative w-full h-full flex items-center border ${
        isActive ? 'border-brand-500 ring-1 ring-brand-500 z-10' : 'border-transparent'
      } ${error ? 'bg-red-50' : 'bg-transparent'}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={error}
    >
      <input
        ref={inputRef}
        type="text" // Always text for stable IME, parsed on commit
        className={`w-full h-full px-2 py-1 outline-none text-sm bg-transparent ${
          type === 'number' ? 'text-center font-medium' : 'text-right'
        } ${isEditing ? 'text-slate-800' : 'text-slate-600 cursor-default'} ${
          error ? 'text-red-700' : ''
        }`}
        value={isEditing ? localValue : (value == null ? '' : String(value))}
        placeholder={!isEditing && !value && placeholder ? placeholder : undefined}
        onChange={(e) => isEditing && setLocalValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={() => {
          // If focus arrives via Tab natively, ensure active state syncs
          if (!isActive) {
            // we rely on the controller to sync this via onNavigate, but if clicked:
            // we might need a prop like onFocus to sync state
          }
        }}
        onCompositionStart={() => { isComposingRef.current = true }}
        onCompositionEnd={() => { isComposingRef.current = false }}
        readOnly={!isEditing}
        tabIndex={-1} // Handled by controller / arrow keys
      />
      {error && (
        <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-bl-sm" />
      )}
    </div>
  )
})

export default SpreadsheetCell
