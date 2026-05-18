import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

interface CommandBarAction {
  label: string
  icon?: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  onClick?: () => void
  disabled?: boolean
}

interface CommandBarProps {
  title: string
  subtitle?: string
  actions?: CommandBarAction[]
  /** Show a back-arrow button before the title (detail pages) */
  onBack?: () => void
}

const variantClass: Record<string, string> = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  danger:    'btn bg-red-600 text-white hover:bg-red-700 border-red-600',
}

export function CommandBar({ title, subtitle, actions = [], onBack }: CommandBarProps) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/60 bg-white shrink-0">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
            aria-label="رجوع"
          >
            <ArrowRight size={18} />
          </button>
        )}
        <div>
          <h1 className="text-xl font-bold text-slate-800 leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="flex items-center gap-2">
          {actions.map((action, i) => (
            <button
              key={i}
              className={`btn gap-1.5 ${variantClass[action.variant ?? 'secondary'] ?? 'btn-secondary'}`}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
