import { useSearchParams } from 'react-router-dom'
import { Shield, Activity, ShieldCheck, Tractor } from 'lucide-react'
import AuditLogPage            from './AuditLogPage'
import ErrorLogPage            from './ErrorLogPage'
import IntegrityPage           from './IntegrityPage'
import OperationalEventsPage   from './OperationalEventsPage'
import { CommandBar } from '../../components/ui/CommandBar'

type Tab = 'log' | 'errors' | 'integrity' | 'operational'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'log',         icon: <Shield      size={15} />, label: 'سجل التغييرات'   },
  { id: 'operational', icon: <Tractor     size={15} />, label: 'أحداث التشغيل'   },
  { id: 'errors',      icon: <Activity    size={15} />, label: 'سجل الأخطاء'     },
  { id: 'integrity',   icon: <ShieldCheck size={15} />, label: 'سلامة البيانات'  },
]

export default function AuditCenterPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'log'

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <CommandBar
        title="مركز التدقيق والمراجعة"
        subtitle="سجل التغييرات · سجل الأخطاء · سلامة البيانات"
      />

      {/* Tab bar */}
      <div className="flex items-end gap-1 border-b border-slate-200 px-5 bg-white shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`
              flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 -mb-px transition-all
              ${tab === t.id
                ? 'border-blue-600 text-blue-600'
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
        {tab === 'log'         && <AuditLogPage />}
        {tab === 'operational' && <OperationalEventsPage />}
        {tab === 'errors'      && <ErrorLogPage />}
        {tab === 'integrity'   && <IntegrityPage />}
      </div>
    </div>
  )
}
