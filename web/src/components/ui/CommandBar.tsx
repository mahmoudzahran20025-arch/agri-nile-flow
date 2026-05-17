import type { ReactNode } from 'react'

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
}

const variantClass: Record<string, string> = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  danger:    'btn bg-red-600 text-white hover:bg-red-700 border-red-600',
}

export function CommandBar({ title, subtitle, actions = [] }: CommandBarProps) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/60 bg-white shrink-0">
      <div>
        <h1 className="text-xl font-bold text-slate-800 leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
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
