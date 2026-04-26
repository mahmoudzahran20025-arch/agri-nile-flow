import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, X,
  Banknote, Package, Wrench, Wheat, Users, FileText,
  ClipboardList,
} from 'lucide-react'
import { usePermissions } from '../store/appStore'

interface FABAction {
  label:   string
  icon:    React.ReactNode
  iconBg:  string
  path:    string
  module:  string
}

const ACTIONS: FABAction[] = [
  { label: 'معاملة نقدية', icon: <Banknote      size={16} />, iconBg: 'bg-emerald-100 text-emerald-700', path: '/treasury',            module: 'treasury'   },
  { label: 'حركة مخزون',   icon: <Package       size={16} />, iconBg: 'bg-blue-100    text-blue-700',    path: '/inventory/movements', module: 'inventory'  },
  { label: 'أمر شغل',      icon: <Wrench        size={16} />, iconBg: 'bg-amber-100   text-amber-700',   path: '/operations',          module: 'operations' },
  { label: 'سجل حصاد',     icon: <Wheat         size={16} />, iconBg: 'bg-lime-100    text-lime-700',    path: '/fields/harvest',      module: 'fields'     },
  { label: 'طلب إجازة',    icon: <Users         size={16} />, iconBg: 'bg-purple-100  text-purple-700',  path: '/hr/leaves',           module: 'hr'         },
  { label: 'عقد جديد',     icon: <FileText      size={16} />, iconBg: 'bg-rose-100    text-rose-700',    path: '/contracts',           module: 'contracts'  },
  { label: 'حضور اليوم',   icon: <ClipboardList size={16} />, iconBg: 'bg-sky-100     text-sky-700',     path: '/hr/attendance',       module: 'hr'         },
]

function canWrite(permissions: string[], module: string): boolean {
  return ['write', 'create', 'edit'].some(a => permissions.includes(`${module}.${a}`))
}

export default function QuickEntryFAB() {
  const navigate    = useNavigate()
  const permissions = usePermissions()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isAdmin = permissions.includes('admin.read')
  const visibleActions = ACTIONS.filter(a => isAdmin || canWrite(permissions, a.module))

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  if (visibleActions.length === 0) return null

  const handleNav = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  return (
    <div
      ref={ref}
      dir="rtl"
      className="fixed bottom-24 md:bottom-8 left-4 md:left-8 z-40 flex flex-col-reverse items-start gap-2"
    >
      {/* Action items */}
      {open && (
        <div className="flex flex-col-reverse gap-2 mb-2">
          {visibleActions.map(action => (
            <button
              key={action.path}
              onClick={() => handleNav(action.path)}
              className="flex items-center gap-3 bg-white rounded-2xl shadow-lg border border-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:shadow-xl transition-all whitespace-nowrap"
            >
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${action.iconBg}`}>
                {action.icon}
              </span>
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 ${
          open
            ? 'bg-gray-700 hover:bg-gray-800 rotate-45'
            : 'bg-brand-600 hover:bg-brand-700 hover:scale-110 active:scale-95'
        }`}
        aria-label="إجراءات سريعة"
        title="إجراءات سريعة"
      >
        {open
          ? <X    size={22} className="text-white" />
          : <Plus size={24} className="text-white" />
        }
      </button>
    </div>
  )
}
