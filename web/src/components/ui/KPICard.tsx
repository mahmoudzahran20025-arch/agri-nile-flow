import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface Props {
  title:    string
  value:    number | string
  subtitle?: string
  icon:     LucideIcon
  color:    'green' | 'blue' | 'amber' | 'red' | 'slate'
  format?:  'currency' | 'number' | 'text'
  /** Percentage change vs. previous period. Positive = good for green, bad for red. */
  trend?:   number
  /** If true, a positive trend is displayed in red (e.g. liabilities). Default: false */
  invertTrend?: boolean
  onClick?: () => void
  alert?: boolean
  className?: string
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
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(value)
  }
  if (format === 'number') {
    return new Intl.NumberFormat('en-US').format(value)
  }
  return String(value)
}

export default function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  format = 'currency',
  trend,
  invertTrend = false,
  onClick,
  alert = false,
  className = '',
}: Props) {
  const c = colorMap[color]

  const trendUp   = trend != null && trend > 0
  const trendDown = trend != null && trend < 0
  const trendFlat = trend != null && trend === 0
  // "good" = green arrow, "bad" = red arrow
  const isGood = invertTrend ? trendDown : trendUp
  const isBad  = invertTrend ? trendUp   : trendDown

  const Wrapper = onClick ? 'button' : 'div'

  return (
    <Wrapper
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={`card p-5 flex items-start gap-4 text-right transition-all ${c.bg} ${alert ? 'ring-1 ring-amber-300 border-amber-200' : ''} ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer w-full' : ''} ${className}`}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${c.icon}`}>
        <Icon size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500 font-medium">{title}</p>
        <p className={`text-2xl font-bold mt-0.5 ${c.text}`}>{fmt(value, format)}</p>
        <div className="flex items-center gap-2 mt-1">
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          {trend != null && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full
              ${isGood ? 'bg-green-100 text-green-700' : isBad ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
              {trendFlat ? <Minus size={11} /> : trendUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {Math.abs(trend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </Wrapper>
  )
}
