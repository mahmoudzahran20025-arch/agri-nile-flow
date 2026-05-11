import { useSearchParams } from 'react-router-dom'
import { Settings, CalendarDays } from 'lucide-react'
import PeriodsPage from './PeriodsPage'

type Tab = 'periods'

const TABS: { id: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'periods', icon: <CalendarDays size={15} />, label: 'الفترات المالية', desc: 'إدارة الفترات المالية وقفلها' },
]

export default function GLSettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = 'periods'
  void params

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Settings size={22} className="text-slate-500" />
          <div>
            <h1 className="page-title">إعدادات المحاسبة</h1>
            <p className="text-sm text-slate-500">الفترات المالية · إعدادات النظام</p>
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
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="[&_.page-header]:hidden [&_.page-title]:hidden">
        <PeriodsPage />
      </div>
    </div>
  )
}
