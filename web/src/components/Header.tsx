import { Bell, ChevronDown } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import type { Season } from '../types'

export default function Header() {
  const { company, activeSeason, seasons, setActiveSeason } = useAppStore()

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 gap-4 shrink-0 z-10">
      {/* Company name */}
      <span className="text-sm font-semibold text-slate-700 truncate max-w-[180px]">
        {company?.name ?? '—'}
      </span>

      <div className="flex-1" />

      {/* Season selector */}
      {seasons.length > 0 && (
        <div className="relative">
          <select
            value={activeSeason?.id ?? ''}
            onChange={e => {
              const id = Number(e.target.value)
              const s  = seasons.find((s: Season) => s.id === id) ?? null
              setActiveSeason(s)
            }}
            className="appearance-none bg-slate-50 border border-slate-200 rounded-lg
                       px-3 py-1.5 pl-8 text-sm font-medium text-slate-700
                       focus:outline-none focus:ring-2 focus:ring-brand-500
                       cursor-pointer ltr"
          >
            <option value="">كل المواسم</option>
            {(seasons as Season[]).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
        </div>
      )}

      {/* Notifications placeholder */}
      <button className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
        <Bell size={18} />
      </button>
    </header>
  )
}
