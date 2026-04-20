import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, KeyRound, LogOut, Search } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import ChangePasswordModal from './forms/ChangePasswordModal'
import type { Season } from '../types'

export default function Header() {
  const navigate = useNavigate()
  const { company, user, role, activeSeason, seasons, setActiveSeason, logout } = useAppStore()
  const [profileOpen,   setProfileOpen]   = useState(false)
  const [changePassOpen, setChangePassOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const ROLE_AR: Record<string, string> = {
    super_admin:      'مدير النظام',
    company_admin:    'مدير الشركة',
    accountant:       'محاسب',
    warehouse_mgr:    'مدير مخازن',
    field_supervisor: 'مشرف حقلي',
    viewer:           'مشاهدة فقط',
  }

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

      {/* Global Search trigger */}
      <button
        onClick={() => {
          const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
          window.dispatchEvent(event)
        }}
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200
                   text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors text-sm"
      >
        <Search size={14} />
        <span className="text-xs">بحث سريع</span>
        <kbd className="text-[10px] bg-slate-200 rounded px-1 py-0.5">Ctrl+K</kbd>
      </button>

      {/* Notifications placeholder */}
      <button className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
        <Bell size={18} />
      </button>

      {/* User profile dropdown */}
      <div ref={profileRef} className="relative">
        <button
          onClick={() => setProfileOpen(o => !o)}
          className="flex items-center gap-2 pr-2 pl-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {user?.full_name?.[0] ?? 'أ'}
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-slate-800 leading-tight max-w-[110px] truncate">
              {user?.full_name ?? '—'}
            </p>
            <p className="text-[10px] text-slate-400 leading-tight">
              {ROLE_AR[role ?? ''] ?? role ?? ''}
            </p>
          </div>
          <ChevronDown size={13} className="text-slate-400" />
        </button>

        {profileOpen && (
          <div className="absolute left-0 top-full mt-2 w-52 bg-white rounded-xl shadow-lg border border-slate-200 z-50 overflow-hidden">
            {/* User info header */}
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800 truncate">{user?.full_name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              <p className="text-xs text-brand-600 mt-0.5">{ROLE_AR[role ?? ''] ?? role}</p>
            </div>

            {/* Actions */}
            <div className="py-1">
              <button
                onClick={() => { setProfileOpen(false); setChangePassOpen(true) }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <KeyRound size={15} className="text-slate-400" />
                تغيير كلمة المرور
              </button>

              <div className="border-t border-slate-100 mt-1 pt-1">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={15} />
                  تسجيل الخروج
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ChangePasswordModal open={changePassOpen} onClose={() => setChangePassOpen(false)} />
    </header>
  )
}
