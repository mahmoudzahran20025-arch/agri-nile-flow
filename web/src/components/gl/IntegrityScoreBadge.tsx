import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import { glApi } from '../../api/client'
import { useIsAuth } from '../../store/appStore'

interface Props {
  collapsed?: boolean
}

export default function IntegrityScoreBadge({ collapsed = false }: Props) {
  const isAuth = useIsAuth()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey:  ['gl', 'integrity-score'],
    queryFn:   glApi.integrityScore,
    enabled:   isAuth,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  })

  const recompute = useMutation({
    mutationFn: glApi.recomputeIntegrityScore,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gl', 'integrity-score'] })
    },
  })

  const score = data?.overall_score ?? null

  const { icon: Icon, bg, text, border } = score === null
    ? { icon: ShieldCheck, bg: 'bg-slate-700/50', text: 'text-slate-400', border: 'border-slate-600' }
    : score >= 95
    ? { icon: ShieldCheck, bg: 'bg-emerald-900/40', text: 'text-emerald-400', border: 'border-emerald-700' }
    : score >= 80
    ? { icon: ShieldAlert, bg: 'bg-amber-900/40',   text: 'text-amber-400',   border: 'border-amber-700'  }
    : { icon: ShieldX,     bg: 'bg-red-900/40',     text: 'text-red-400',     border: 'border-red-700'    }

  if (isLoading) {
    return (
      <div className={`mx-2 my-1 h-8 rounded-lg animate-pulse bg-slate-700/40 ${collapsed ? 'w-10' : ''}`} />
    )
  }

  if (collapsed) {
    return (
      <div
        className={`mx-auto my-1 w-9 h-9 rounded-xl flex items-center justify-center border ${bg} ${border}`}
        title={score !== null ? `نزاهة البيانات: ${score}/100` : 'تحميل...'}
      >
        <Icon size={16} className={text} />
      </div>
    )
  }

  return (
    <div className={`mx-2 my-1 rounded-xl border px-3 py-2 flex items-center gap-2.5 ${bg} ${border}`}>
      <Icon size={15} className={`${text} shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-slate-400 leading-none">نزاهة البيانات</p>
        <p className={`text-sm font-black leading-tight ${text}`}>
          {score !== null ? `${score} / 100` : '—'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => recompute.mutate()}
        disabled={recompute.isPending}
        className="ml-1 rounded-md border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700/40 disabled:opacity-50"
        title="إعادة حساب فوري"
      >
        <RefreshCw size={11} className={recompute.isPending ? 'animate-spin' : ''} />
      </button>
      {score !== null && score < 95 && data?.alerts?.length ? (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
          score >= 80 ? 'bg-amber-800/50 text-amber-300' : 'bg-red-800/50 text-red-300'
        }`}>
          {data.alerts.length} تنبيه
        </span>
      ) : null}
    </div>
  )
}
