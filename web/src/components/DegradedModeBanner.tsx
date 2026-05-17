import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { hardeningApi } from '../api/gl'

export default function DegradedModeBanner() {
  const { data } = useQuery({
    queryKey: ['hardening', 'baseline'],
    queryFn: hardeningApi.baseline,
    refetchInterval: 1000 * 60 * 5,
    retry: false,
  })

  const meta = data?.meta
  if (!meta) return null
  if (meta.certification_status === 'certified' && !meta.degraded_mode) return null

  const isBlocked = meta.certification_status === 'blocked'

  return (
    <div
      className={`${isBlocked ? 'bg-red-600' : 'bg-amber-500'} text-white px-4 py-2 flex items-center justify-between gap-3 text-sm font-medium z-40 relative`}
      dir="rtl"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert size={18} className="shrink-0 animate-pulse" />
        <span className="truncate">
          {isBlocked
            ? 'النظام المحاسبي محظور — الترحيل موقوف'
            : 'النظام المحاسبي في وضع مخفّض — البيانات مصدرها جداول المعاملات'}
        </span>
        {meta.degraded_reason && (
          <span className="opacity-75 text-xs hidden sm:inline">({meta.degraded_reason})</span>
        )}
      </div>
      <Link
        to="/gl/hardening"
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors whitespace-nowrap shrink-0 text-xs font-semibold"
      >
        لوحة الحوكمة
        <ArrowRight size={14} />
      </Link>
    </div>
  )
}
