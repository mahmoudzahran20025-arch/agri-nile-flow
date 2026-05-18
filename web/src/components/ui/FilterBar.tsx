import type { ReactNode } from 'react'

interface FilterBarProps {
  children: ReactNode
  /** Extra classes applied to the root container */
  className?: string
}

/**
 * Sticky sub-bar rendered between CommandBar and the page scroll container.
 * Use for season selectors, search inputs, segmented button groups, and any
 * filter controls that need to stay visible while the content scrolls.
 *
 * Pattern:
 *   <div className="flex flex-col h-full">
 *     <CommandBar title="..." />
 *     <FilterBar>...</FilterBar>
 *     <div className="flex-1 overflow-y-auto p-5">...</div>
 *   </div>
 */
export function FilterBar({ children, className = '' }: FilterBarProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-5 py-2.5 border-b border-slate-200 bg-white shrink-0 ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * A segmented button group for mutually-exclusive filter options.
 * Matches the Treasury / Charts cashflow period toggle style.
 */
interface SegmentedOption<T extends string | number> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string | number> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
      {options.map(opt => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs rounded-md font-semibold transition-all ${
            opt.value === value
              ? 'bg-white shadow text-brand-700'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
