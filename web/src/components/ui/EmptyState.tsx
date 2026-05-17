import type { ReactNode } from 'react'
import { FileX, SearchX, Plus } from 'lucide-react'

interface EmptyStateProps {
  icon?:        ReactNode
  title:        string
  description?: string
  action?:      { label: string; onClick: () => void; icon?: ReactNode }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        {icon ?? <FileX size={28} className="text-slate-400" />}
      </div>
      <h3 className="text-[15px] font-semibold text-slate-700 mb-1">{title}</h3>
      {description && (
        <p className="text-[12px] text-slate-400 max-w-xs leading-relaxed">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 flex items-center gap-1.5 btn-primary text-[13px]"
        >
          {action.icon ?? <Plus size={14} />}
          {action.label}
        </button>
      )}
    </div>
  )
}

export function EmptySearch({ term }: { term: string }) {
  return (
    <EmptyState
      icon={<SearchX size={28} className="text-slate-400" />}
      title="لا توجد نتائج"
      description={`لم يتم العثور على نتائج مطابقة لـ "${term}"`}
    />
  )
}

export function EmptyList({ noun, onAdd }: { noun: string; onAdd?: () => void }) {
  return (
    <EmptyState
      title={`لا توجد ${noun} بعد`}
      description={`لم يتم إضافة أي ${noun} حتى الآن.`}
      action={onAdd ? { label: `إضافة ${noun}`, onClick: onAdd } : undefined}
    />
  )
}
