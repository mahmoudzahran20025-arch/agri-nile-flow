import { useSearchParams } from 'react-router-dom'
import {
  Leaf, TrendingUp, Target, ShieldCheck, Lock, BarChart3, ClipboardList,
} from 'lucide-react'
import SeasonSummaryPage  from './SeasonSummaryPage'
import SeasonPnLPage      from './SeasonPnLPage'
import BudgetVsActualPage from './BudgetVsActualPage'
import SeasonReadinessPage from './SeasonReadinessPage'
import SeasonClosePage    from './SeasonClosePage'
import SeasonRollupPage   from './SeasonRollupPage'
import WorkOrderReconciliationPage from './WorkOrderReconciliationPage'

type Tab = 'summary' | 'pnl' | 'budget' | 'readiness' | 'close' | 'rollup' | 'wo-reconcile'

const TABS: { id: Tab; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'summary',       icon: <Leaf          size={15} />, label: 'ملخص الموسم',         color: 'text-emerald-600' },
  { id: 'pnl',           icon: <TrendingUp    size={15} />, label: 'أرباح وخسائر',         color: 'text-brand-600'   },
  { id: 'budget',        icon: <Target        size={15} />, label: 'الميزانية مقابل الفعلي', color: 'text-violet-600'  },
  { id: 'rollup',        icon: <BarChart3     size={15} />, label: 'ملخص التكاليف',        color: 'text-cyan-600'    },
  { id: 'wo-reconcile',  icon: <ClipboardList size={15} />, label: 'مطابقة أوامر العمل',   color: 'text-purple-600'  },
  { id: 'readiness',     icon: <ShieldCheck   size={15} />, label: 'جاهزية الإغلاق',       color: 'text-amber-600'   },
  { id: 'close',         icon: <Lock          size={15} />, label: 'إغلاق الموسم',          color: 'text-red-600'     },
]

export default function SeasonReportsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'summary'

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })

  const active = TABS.find(t => t.id === tab) ?? TABS[0]

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <span className={active.color}>{active.icon}</span>
          <div>
            <h1 className="page-title">تقارير الموسم الزراعي</h1>
            <p className="text-sm text-slate-500">ملخص · أرباح وخسائر · ميزانية · تكاليف · أوامر عمل · جاهزية · إغلاق</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap items-end gap-0 border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`
              flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-all
              ${tab === t.id
                ? `border-current ${t.color}`
                : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'}
            `}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content — suppress inner page headers */}
      <div className="[&_.page-header]:hidden [&_.page-title]:hidden">
        {tab === 'summary'      && <SeasonSummaryPage />}
        {tab === 'pnl'          && <SeasonPnLPage />}
        {tab === 'budget'       && <BudgetVsActualPage />}
        {tab === 'rollup'       && <SeasonRollupPage />}
        {tab === 'wo-reconcile' && <WorkOrderReconciliationPage />}
        {tab === 'readiness'    && <SeasonReadinessPage />}
        {tab === 'close'        && <SeasonClosePage />}
      </div>
    </div>
  )
}
