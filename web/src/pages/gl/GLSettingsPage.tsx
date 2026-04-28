import { useSearchParams } from 'react-router-dom'
import { Settings, Link2, ShieldCheck, CalendarDays, BrainCircuit } from 'lucide-react'
import IntegrationControlPage from './IntegrationControlPage'
import PeriodsPage            from './PeriodsPage'
import SmartClassifierPage    from './SmartClassifierPage'

type Tab = 'mappings' | 'classifier' | 'integrations' | 'periods'

const TABS: { id: Tab; label: string; icon: React.ReactNode; desc: string; legacy?: boolean }[] = [
  { id: 'integrations', icon: <ShieldCheck size={15} />, label: 'حوكمة الربط',     desc: 'تفعيل وتعطيل الربط التلقائي لكل وحدة' },
  { id: 'periods',      icon: <CalendarDays size={15}/>, label: 'الفترات المالية', desc: 'إدارة الفترات المالية وقفلها' },
  { id: 'classifier',   icon: <BrainCircuit size={15} />,label: 'المصنف الذكي',    desc: 'إدارة الربط التفاعلي للبيانات القديمة', legacy: true },
]

export default function GLSettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'integrations'

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Settings size={22} className="text-slate-500" />
          <div>
            <h1 className="page-title">إعدادات المحاسبة</h1>
            <p className="text-sm text-slate-500">حوكمة الربط · الفترات المالية · أدوات قديمة للعرض فقط</p>
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
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'}
            `}
          >
            {t.icon}
            {t.label}
            {t.legacy && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">LEGACY</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content — render each page inline, suppressing their own h1 header */}
      <div className="[&_.page-header]:hidden [&_.page-title]:hidden">
        {tab === 'classifier'   && <SmartClassifierPage />}
        {tab === 'integrations' && <IntegrationControlPage />}
        {tab === 'periods'      && <PeriodsPage />}
      </div>
    </div>
  )
}
