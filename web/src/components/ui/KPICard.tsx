import type { LucideIcon } from 'lucide-react'

interface Props {
  title:    string
  value:    number | string
  subtitle?: string
  icon:     LucideIcon
  color:    'green' | 'blue' | 'amber' | 'red' | 'slate'
  format?:  'currency' | 'number' | 'text'
}

const colorMap = {
  green: { bg: 'bg-green-50',  icon: 'bg-green-100 text-green-700',  text: 'text-green-700' },
  blue:  { bg: 'bg-blue-50',   icon: 'bg-blue-100  text-blue-700',   text: 'text-blue-700'  },
  amber: { bg: 'bg-amber-50',  icon: 'bg-amber-100 text-amber-700',  text: 'text-amber-700' },
  red:   { bg: 'bg-red-50',    icon: 'bg-red-100   text-red-700',    text: 'text-red-700'   },
  slate: { bg: 'bg-slate-50',  icon: 'bg-slate-100 text-slate-600',  text: 'text-slate-600' },
}

function fmt(value: number | string, format?: Props['format']): string {
  if (typeof value === 'string') return value
  if (format === 'currency') {
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(value)
  }
  if (format === 'number') {
    return new Intl.NumberFormat('ar-EG').format(value)
  }
  return String(value)
}

export default function KPICard({ title, value, subtitle, icon: Icon, color, format = 'currency' }: Props) {
  const c = colorMap[color]
  return (
    <div className={`card p-5 flex items-start gap-4 ${c.bg}`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${c.icon}`}>
        <Icon size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500 font-medium">{title}</p>
        <p className={`text-2xl font-bold mt-0.5 ${c.text}`}>{fmt(value, format)}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </div>
    </div>
  )
}
