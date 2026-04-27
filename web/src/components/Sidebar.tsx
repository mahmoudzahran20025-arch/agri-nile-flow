import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Banknote, Package,
  FileText, Settings, LogOut, Leaf, ChevronLeft,
  ClipboardList, UserCog, TrendingUp, MapPin, Wrench,
  Building2, Shield, Activity, ChevronDown, Link2,
  ShieldCheck, Target, Lock, ShoppingCart, CalendarDays,
  Landmark, Database, BarChart3, FolderTree, ClipboardCheck
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi, inventoryApi } from '../api/client'
import { useIsAuth } from '../store/appStore'
import { useState } from 'react'

// suppress unused import warnings — icons kept for potential future use
void Link2; void ShieldCheck; void Lock;

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
  to:     string
  icon:   React.ReactNode
  label:  string
  badge?: number
  permission?: { module: string; action: string }
}

interface NavSection {
  key:   string
  label: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  // ── Main ──────────────────────────────────────────────────────
  {
    key: 'main', label: 'الرئيسي', items: [
      { to: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'لوحة التحكم' },
    ],
  },

  // ── Suppliers & AP ────────────────────────────────────────────
  {
    key: 'suppliers', label: 'الموردون والمدفوعات', items: [
      { to: '/suppliers',   icon: <Users         size={18} />, label: 'الموردون والعملاء', permission: { module: 'suppliers', action: 'read' } },
      { to: '/treasury/po', icon: <ShoppingCart  size={18} />, label: 'أوامر الشراء',      permission: { module: 'treasury',  action: 'read' } },
    ],
  },

  // ── Treasury ──────────────────────────────────────────────────
  {
    key: 'treasury', label: 'الخزينة والبنوك', items: [
      { to: '/treasury',          icon: <Banknote   size={18} />, label: 'الخزينة (صندوق)',  permission: { module: 'treasury', action: 'read' } },
      { to: '/treasury/bank',     icon: <Landmark   size={18} />, label: 'التسوية البنكية', permission: { module: 'treasury', action: 'read' } },
      { to: '/treasury/partners', icon: <TrendingUp size={18} />, label: 'الشركاء',          permission: { module: 'treasury', action: 'read' } },
    ],
  },

  // ── Inventory ─────────────────────────────────────────────────
  {
    key: 'inventory', label: 'المخزون', items: [
      { to: '/inventory',             icon: <Package       size={18} />, label: 'أرصدة المخازن',   permission: { module: 'inventory', action: 'read' } },
      { to: '/inventory/categories',  icon: <FolderTree    size={18} />, label: 'تصنيفات الأصناف', permission: { module: 'inventory', action: 'read' } },
      { to: '/inventory/adjustments', icon: <ClipboardCheck size={18} />, label: 'التسويات الجردية', permission: { module: 'inventory', action: 'read' } },
      { to: '/inventory/movements',   icon: <ClipboardList size={18} />, label: 'حركات المخزون',   permission: { module: 'inventory', action: 'read' } },
      { to: '/inventory/setup',       icon: <Building2     size={18} />, label: 'إدارة المستودعات', permission: { module: 'inventory', action: 'create' } },
    ],
  },

  // ── Agricultural Ops ──────────────────────────────────────────
  {
    key: 'ops', label: 'العمليات الزراعية', items: [
      { to: '/fields',     icon: <MapPin   size={18} />, label: 'قطع الأراضي', permission: { module: 'operations', action: 'read' } },
      { to: '/operations', icon: <Wrench   size={18} />, label: 'أوامر العمل', permission: { module: 'operations', action: 'read' } },
      { to: '/contracts',  icon: <FileText size={18} />, label: 'العقود',       permission: { module: 'operations', action: 'read' } },
    ],
  },

  // ── HR ────────────────────────────────────────────────────────
  {
    key: 'hr', label: 'الموارد البشرية', items: [
      { to: '/hr',            icon: <Users        size={18} />, label: 'قائمة الموظفين',  permission: { module: 'hr', action: 'read' } },
      { to: '/hr/attendance', icon: <Activity     size={18} />, label: 'الحضور والانصراف', permission: { module: 'hr', action: 'read' } },
      { to: '/hr/payroll',    icon: <Banknote     size={18} />, label: 'الرواتب والأجور',  permission: { module: 'hr', action: 'read' } },
      { to: '/hr/leaves',     icon: <CalendarDays size={18} />, label: 'الإجازات والسلف',  permission: { module: 'hr', action: 'read' } },
    ],
  },

  // ── General Ledger ────────────────────────────────────────────
  {
    key: 'finance', label: 'دفتر الأستاذ العام', items: [
      { to: '/gl/accounts',       icon: <Database  size={18} />, label: 'شجرة الحسابات',      permission: { module: 'finance', action: 'read' } },
      { to: '/gl/entries',        icon: <FileText  size={18} />, label: 'قيود اليومية',        permission: { module: 'finance', action: 'read' } },
      { to: '/gl/statements',     icon: <BarChart3 size={18} />, label: 'القوائم المالية',      permission: { module: 'finance', action: 'read' } },
      { to: '/gl/setup-wizard',   icon: <ClipboardCheck size={18} />, label: 'معالج الإعداد',   permission: { module: 'config',  action: 'read' } },
      { to: '/gl/posting-groups', icon: <Settings  size={18} />, label: 'مجموعات الترحيل',     permission: { module: 'config',  action: 'read' } },
      { to: '/gl/posting-setup',  icon: <Settings  size={18} />, label: 'إعداد الترحيل',       permission: { module: 'config',  action: 'read' } },
      { to: '/gl/settings',       icon: <Settings  size={18} />, label: 'إعدادات المحاسبة',    permission: { module: 'config',  action: 'read' } },
    ],
  },

  // ── Reports ───────────────────────────────────────────────────
  {
    key: 'reports', label: 'التقارير والتحليل', items: [
      { to: '/reports',              icon: <ClipboardList size={18} />, label: 'مركز التقارير',  permission: { module: 'reports', action: 'read' } },
      { to: '/reports/season',       icon: <Leaf          size={18} />, label: 'تقارير الموسم',  permission: { module: 'reports', action: 'read' } },
      { to: '/reports/cost-centers', icon: <Target        size={18} />, label: 'مراكز التكلفة',  permission: { module: 'reports', action: 'read' } },
    ],
  },

  // ── System ────────────────────────────────────────────────────
  {
    key: 'admin', label: 'الإدارة والنظام', items: [
      { to: '/users',  icon: <UserCog  size={18} />, label: 'المستخدمون',  permission: { module: 'admin',  action: 'users' } },
      { to: '/audit',  icon: <Shield   size={18} />, label: 'مركز التدقيق', permission: { module: 'admin',  action: 'audit' } },
      { to: '/config', icon: <Settings size={18} />, label: 'الإعدادات',    permission: { module: 'config', action: 'read'  } },
    ],
  },
]

export default function Sidebar() {
  const { company, user, role, permissions, logout } = useAppStore()
  const isAuth = useIsAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  const toggleSection = (key: string) =>
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))

  const { data: alertsData = [] } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn:  () => dashboardApi.inventoryAlerts() as Promise<{ name: string; balance_qty: number }[]>,
    enabled:  isAuth,
    staleTime: 120_000,
    refetchInterval: 300_000,
  })

  const { data: reorderData = [] } = useQuery({
    queryKey: ['inventory', 'reorder-alerts'],
    queryFn:  inventoryApi.reorderAlerts,
    enabled:  isAuth,
    staleTime: 120_000,
    refetchInterval: 300_000,
  })

  const alertCount = alertsData.length + reorderData.length

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

      {/* Super-admin portal */}
      {role === 'super_admin' && !collapsed && (
        <NavLink
          to="/admin"
          className={({ isActive }) => `
            flex items-center gap-2 mx-2 mt-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors
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
      <nav className="flex-1 py-3 overflow-y-auto px-2 space-y-1">
        {NAV_SECTIONS.map(section => {
          const visibleItems = section.items.filter(item => {
            if (!item.permission) return true
            if (role === 'super_admin') return true
            return permissions.includes(`${item.permission.module}.${item.permission.action}`)
          })

          if (visibleItems.length === 0) return null

          const sectionCollapsed = collapsedSections[section.key]
          return (
            <div key={section.key}>
              {!collapsed && section.key !== 'main' && (
                <button
                  onClick={() => toggleSection(section.key)}
                  className="w-full flex items-center justify-between px-2 py-1.5 mt-2 mb-0.5 rounded-md
                             text-brand-400 hover:text-brand-200 transition-colors"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider truncate">
                    {section.label}
                  </span>
                  <ChevronDown
                    size={12}
                    className={`shrink-0 transition-transform duration-200 ${sectionCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              )}

              {!sectionCollapsed && visibleItems.map(item => {
                const isInventory = item.to === '/inventory'
                const badge = isInventory && alertCount > 0 ? alertCount : item.badge
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/hr' || item.to === '/treasury' || item.to === '/inventory'}
                    className={({ isActive }) => `
                      flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
                      transition-colors duration-150 relative
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
            </div>
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
