import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Banknote, Package,
  FileText, Settings, LogOut, Leaf, ChevronLeft,
  ClipboardList, UserCog, TrendingUp, MapPin, Wrench, Wheat,
  BookOpen, BookMarked, BarChart3, Building2, Shield, Target,
  CalendarDays, PieChart, Lock, Landmark, ShoppingCart,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '../api/client'
import { useIsAuth } from '../store/appStore'
import { useState } from 'react'

const ROLE_LABELS: Record<string, string> = {
  super_admin:      'مدير النظام',
  company_admin:    'مدير الشركة',
  accountant:       'محاسب',
  warehouse_mgr:    'مدير مخازن',
  field_supervisor: 'مشرف حقلي',
  viewer:           'مشاهدة فقط',
}

const ROLE_COLORS: Record<string, string> = {
  super_admin:      'bg-red-500/20 text-red-300',
  company_admin:    'bg-blue-500/20 text-blue-300',
  accountant:       'bg-amber-500/20 text-amber-300',
  warehouse_mgr:    'bg-green-500/20 text-green-300',
  field_supervisor: 'bg-teal-500/20 text-teal-300',
  viewer:           'bg-slate-500/20 text-slate-300',
}

interface NavItem {
  to:      string
  icon:    React.ReactNode
  label:   string
  badge?:  number
  group?:  string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',            icon: <LayoutDashboard size={20} />, label: 'لوحة التحكم' },
  { to: '/suppliers',            icon: <Users           size={20} />, label: 'الموردين والعملاء' },
  { to: '/treasury',             icon: <Banknote        size={20} />, label: 'الخزينة' },
  { to: '/treasury/partners',    icon: <TrendingUp      size={20} />, label: 'الشركاء' },
  { to: '/inventory',            icon: <Package         size={20} />, label: 'أرصدة المخازن' },
  { to: '/inventory/movements',  icon: <ClipboardList   size={20} />, label: 'حركات المخزون' },
  { to: '/fields',               icon: <MapPin          size={20} />, label: 'قطع الأراضي' },
  { to: '/fields/harvest',       icon: <Wheat           size={20} />, label: 'سجلات الحصاد' },
  { to: '/hr',                    icon: <Users           size={20} />, label: 'الموارد البشرية', group: 'HR' },
  { to: '/hr/dashboard',          icon: <PieChart        size={20} />, label: 'داشبورد HR', group: 'HR' },
  { to: '/hr/attendance',         icon: <ClipboardList   size={20} />, label: 'الحضور والانصراف', group: 'HR' },
  { to: '/hr/location-tasks',     icon: <Target          size={20} />, label: 'مهام الزيارات', group: 'HR' },
  { to: '/hr/leaves',             icon: <FileText        size={20} />, label: 'الإجازات والسلف', group: 'HR' },
  { to: '/hr/payroll',            icon: <Banknote        size={20} />, label: 'مسيرات الرواتب', group: 'HR' },
  { to: '/documents',             icon: <FileText        size={20} />, label: 'إدارة المستندات' },
  { to: '/calendar',              icon: <CalendarDays    size={20} />, label: 'التقويم والمهام' },
  { to: '/employees',             icon: <Users           size={20} />, label: 'الموظفون (قديم)' },
  { to: '/operations',            icon: <Wrench          size={20} />, label: 'أوامر العمل' },
  { to: '/contracts',            icon: <FileText        size={20} />, label: 'العقود' },
  { to: '/gl/accounts',         icon: <BookOpen        size={20} />, label: 'شجرة الحسابات', group: 'GL' },
  { to: '/gl/entries',          icon: <BookMarked      size={20} />, label: 'قيود اليومية', group: 'GL' },
  { to: '/gl/statements',       icon: <BarChart3       size={20} />, label: 'القوائم المالية', group: 'GL' },
  { to: '/gl/periods',          icon: <Lock            size={20} />, label: 'الفترات المالية', group: 'GL' },
  { to: '/treasury/bank',       icon: <Landmark        size={20} />, label: 'مطابقة البنك' },
  { to: '/treasury/po',         icon: <ShoppingCart    size={20} />, label: 'طلبات الشراء' },
  { to: '/reports',              icon: <ClipboardList   size={20} />, label: 'التقارير' },
  { to: '/reports/charts',       icon: <BarChart3       size={20} />, label: 'التقارير المرئية' },
  { to: '/audit',                icon: <Shield          size={20} />, label: 'سجل المراجعة' },
  { to: '/users',                icon: <UserCog         size={20} />, label: 'المستخدمون' },
  { to: '/config',               icon: <Settings        size={20} />, label: 'الإعدادات' },
]

export default function Sidebar() {
  const { company, user, role, logout } = useAppStore()
  const isAuth = useIsAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  // Low-stock alerts count
  const { data: alertsData = [] } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn:  () => dashboardApi.inventoryAlerts() as Promise<{ name: string; balance_qty: number }[]>,
    enabled:  isAuth,
    staleTime: 120_000,
    refetchInterval: 300_000, // refresh every 5 min
  })
  const alertCount = alertsData.length

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

      {/* Super-admin portal link */}
      {role === 'super_admin' && !collapsed && (
        <NavLink
          to="/admin"
          className={({ isActive }) => `
            flex items-center gap-2 mx-2 px-3 py-2 rounded-lg text-xs font-semibold
            border transition-colors
            ${isActive
              ? 'bg-red-600 border-red-700 text-white'
              : 'border-red-500/40 text-red-300 hover:bg-red-900/30'}
          `}
        >
          <Building2 size={15} />
          <span>لوحة مدير النظام</span>
        </NavLink>
      )}

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto space-y-1 px-2">
        {NAV_ITEMS.map(item => {
          const isInventory = item.to === '/inventory'
          const badge = isInventory && alertCount > 0 ? alertCount : item.badge
          return (
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
              <span className="flex-shrink-0 relative">
                {item.icon}
                {collapsed && badge != null && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 leading-none">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!collapsed && badge != null && (
                <span className={`text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center
                  ${isInventory ? 'bg-orange-500' : 'bg-red-500'}`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* User footer */}
      <div className={`border-t border-brand-800 p-3 ${collapsed ? 'flex justify-center' : ''}`}>
        {!collapsed && (
          <div className="mb-2 px-1 space-y-1">
            <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
            <p className="text-xs text-brand-300 truncate">{user?.email}</p>
            {role && (
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[role] ?? 'bg-slate-500/20 text-slate-300'}`}>
                {ROLE_LABELS[role] ?? role}
              </span>
            )}
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
