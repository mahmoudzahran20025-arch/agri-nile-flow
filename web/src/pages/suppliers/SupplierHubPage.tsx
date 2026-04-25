import { useSearchParams } from 'react-router-dom'
import { Users, Clock, Scale } from 'lucide-react'
import SupplierListPage   from './SupplierListPage'
import APAgingPage        from '../treasury/APAgingPage'
import SuppliersBalancePage from '../reports/SuppliersBalancePage'

type Tab = 'list' | 'aging' | 'balance'

const TABS: { id: Tab; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'list',    icon: <Users  size={15} />, label: 'قائمة الموردين',   color: 'text-brand-600'  },
  { id: 'aging',   icon: <Clock  size={15} />, label: 'تحليل الأعمار',    color: 'text-red-600'    },
  { id: 'balance', icon: <Scale  size={15} />, label: 'أرصدة ملخصة',      color: 'text-amber-600'  },
]

export default function SupplierHubPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'list'

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })

  const active = TABS.find(t => t.id === tab)!

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <span className={active.color}>{active.icon}</span>
          <div>
            <h1 className="page-title">الموردين والذمم الدائنة</h1>
            <p className="text-sm text-slate-500">قائمة الموردين · تحليل الأعمار · أرصدة ملخصة</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-end gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`
              flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 -mb-px transition-all
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
        {tab === 'list'    && <SupplierListPage />}
        {tab === 'aging'   && <APAgingPage />}
        {tab === 'balance' && <SuppliersBalancePage />}
      </div>
    </div>
  )
}
