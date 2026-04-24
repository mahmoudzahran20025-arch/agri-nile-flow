import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { glApi } from '../api/client'

export default function PeriodWarningBanner() {
  const { data: periods = [] } = useQuery({
    queryKey: ['financial-periods-status'],
    queryFn:  glApi.periods,
    refetchInterval: 1000 * 60 * 5, // كل 5 دقائق
  })

  const today = new Date().toISOString().slice(0, 10)
  const hasOpenPeriod = (periods as any[]).some(p => 
    !p.is_closed && today >= p.start_date && today <= p.end_date
  )

  if (hasOpenPeriod || (periods as any[]).length === 0) return null

  return (
    <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm font-medium shadow-lg" dir="rtl">
      <div className="flex items-center gap-2">
        <AlertCircle size={18} className="animate-pulse" />
        <span>تنبيه: لا توجد فترة مالية مفتوحة تغطي تاريخ اليوم ({today}). لن تتمكن من تسجيل أي عمليات جديدة.</span>
      </div>
      <Link 
        to="/gl/periods" 
        className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors whitespace-nowrap"
      >
        فتح فترة مالية <ArrowRight size={16} />
      </Link>
    </div>
  )
}
