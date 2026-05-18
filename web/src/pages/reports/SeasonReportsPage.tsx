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
import { CommandBar } from '../../components/ui/CommandBar'

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

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <CommandBar
        title="تقارير الموسم الزراعي"
        subtitle="ملخص · أرباح وخسائر · ميزانية · تكاليف · أوامر عمل · جاهزية · إغلاق"
      />

      {/* Tab bar */}
      <div className="flex flex-wrap items-end gap-0 border-b border-slate-200 px-5 bg-white shrink-0">
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
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
