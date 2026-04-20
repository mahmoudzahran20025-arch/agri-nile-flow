import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Banknote, Package,
  FileText, Settings, LogOut, Leaf, ChevronLeft,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useState } from 'react'

interface NavItem {
  to:      string
  icon:    React.ReactNode
  label:   string
  badge?:  number
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',  icon: <LayoutDashboard size={20} />, label: 'لوحة التحكم' },
  { to: '/suppliers',  icon: <Users           size={20} />, label: 'الموردين والعملاء' },
  { to: '/treasury',   icon: <Banknote        size={20} />, label: 'الخزينة' },
  { to: '/inventory',  icon: <Package         size={20} />, label: 'المخازن' },
  { to: '/reports',    icon: <FileText        size={20} />, label: 'التقارير' },
  { to: '/config',     icon: <Settings        size={20} />, label: 'الإعدادات' },
]

export default function Sidebar() {
  const { company, user, logout } = useAppStore()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside
      className={`
        relative flex flex-col h-full bg-brand-900 text-white
        transition-all duration-200 ease-in-out shrink-0
        ${collapsed ? 'w-16' : 'w-64'}
      `}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="absolute -left-3 top-20 z-10 bg-brand-700 rounded-full p-1
                   hover:bg-brand-600 transition-colors shadow-md"
        aria-label="طي القائمة"
      >
        <ChevronLeft
          size={14}
          className={`transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-brand-800 ${collapsed ? 'justify-center' : ''}`}>
        <div className="flex-shrink-0 w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
          <Leaf size={20} className="text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-bold text-sm leading-tight truncate">نواة المستقبل</p>
            <p className="text-brand-300 text-xs truncate">{company?.name ?? '—'}</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto space-y-1 px-2">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `
              flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
              transition-colors duration-150 group relative
              ${isActive
                ? 'bg-brand-700 text-white'
                : 'text-brand-200 hover:bg-brand-800 hover:text-white'}
              ${collapsed ? 'justify-center' : ''}
            `}
            title={collapsed ? item.label : undefined}
          >
            <span className="flex-shrink-0">{item.icon}</span>
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {!collapsed && item.badge != null && (
              <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className={`border-t border-brand-800 p-3 ${collapsed ? 'flex justify-center' : ''}`}>
        {!collapsed && (
          <div className="mb-2 px-1">
            <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
            <p className="text-xs text-brand-300 truncate">{user?.email}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={`
            flex items-center gap-2 text-brand-300 hover:text-red-400
            text-sm transition-colors duration-150 py-1 px-1 rounded
            ${collapsed ? 'justify-center w-full' : 'w-full'}
          `}
          title={collapsed ? 'تسجيل الخروج' : undefined}
        >
          <LogOut size={16} />
          {!collapsed && <span>تسجيل الخروج</span>}
        </button>
      </div>
    </aside>
  )
}
