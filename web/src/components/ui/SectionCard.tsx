import type { ReactNode } from 'react'

interface SectionCardProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  badge?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export default function SectionCard({
  title,
  subtitle,
  icon,
  badge,
  action,
  children,
  className = '',
  bodyClassName = '',
}: SectionCardProps) {
  return (
    <section className={`bg-white rounded border border-slate-200 shadow-sm overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="text-[#0F2D5C] shrink-0">{icon}</span>}
            <h2 className="text-[14px] font-bold text-slate-800 truncate">{title}</h2>
            {badge}
          </div>
          {subtitle && <p className="text-[12px] text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  )
}
