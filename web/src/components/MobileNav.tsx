/**
 * MobileNav — bottom navigation bar, visible only on small screens (< md).
 * 4 primary tabs + "المزيد" button that slides up a full bottom-sheet with all nav items.
 */
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, Banknote, Users, MoreHorizontal,
  X, FileText, TrendingUp, ClipboardList, MapPin, Wrench,
  BookOpen, BookMarked, BarChart3, Shield, UserCog, Settings, Building2,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '../api/client'
import { useIsAuth, useAppStore } from '../store/appStore'

const PRIMARY_ITEMS = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'الرئيسية' },
  { to: '/inventory',  icon: Package,         label: 'مخزون'    },
  { to: '/treasury',   icon: Banknote,        label: 'خزينة'    },
  { to: '/suppliers',  icon: Users,           label: 'موردين'   },
]

const MORE_ITEMS = [
  { to: '/treasury/partners',   icon: TrendingUp,    label: 'الشركاء' },
  { to: '/inventory/movements', icon: ClipboardList, label: 'حركات المخزون' },
  { to: '/fields',              icon: MapPin,        label: 'قطع الأراضي' },
  { to: '/employees',           icon: Users,         label: 'الموظفون' },
  { to: '/operations',          icon: Wrench,        label: 'أوامر العمل' },
  { to: '/contracts',           icon: FileText,      label: 'العقود' },
  { to: '/gl/accounts',         icon: BookOpen,      label: 'شجرة الحسابات' },
  { to: '/gl/entries',          icon: BookMarked,    label: 'قيود اليومية' },
  { to: '/gl/statements',       icon: BarChart3,     label: 'القوائم المالية' },
  { to: '/reports',             icon: FileText,      label: 'التقارير' },
  { to: '/reports/charts',      icon: BarChart3,     label: 'التقارير المرئية' },
  { to: '/audit',               icon: Shield,        label: 'سجل المراجعة' },
  { to: '/users',               icon: UserCog,       label: 'المستخدمون' },
  { to: '/config',              icon: Settings,      label: 'الإعدادات' },
]

export default function MobileNav() {
  const isAuth    = useIsAuth()
  const { role }  = useAppStore()
  const navigate  = useNavigate()
  const [open, setOpen] = useState(false)

  const { data: alerts = [] } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn:  () => dashboardApi.inventoryAlerts() as Promise<unknown[]>,
    enabled:  isAuth,
    staleTime: 120_000,
  })
  const alertCount = alerts.length

  const handleMoreNav = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <>
      {/* ── Bottom bar ─────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200">
        <div className="grid grid-cols-5 h-16">
          {PRIMARY_ITEMS.map(({ to, icon: Icon, label }) => {
            const isInventory = to === '/inventory'
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors
                   ${isActive ? 'text-brand-600' : 'text-slate-400'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={`relative p-1.5 rounded-xl ${isActive ? 'bg-brand-50' : ''}`}>
                      <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                      {isInventory && alertCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                          {alertCount > 99 ? '99+' : alertCount}
                        </span>
                      )}
                    </div>
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            )
          })}

          {/* More button */}
          <button
            onClick={() => setOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-slate-400"
          >
            <div className="p-1.5 rounded-xl">
              <MoreHorizontal size={22} strokeWidth={2} />
            </div>
            <span>المزيد</span>
          </button>
        </div>
      </nav>

      {/* ── More drawer (bottom sheet) ─────────────────── */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-50 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-2xl shadow-2xl"
            dir="rtl"
          >
            {/* Handle bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="font-semibold text-slate-700">كل الأقسام</span>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-100"
              >
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            {/* Grid of nav items */}
            <div className="grid grid-cols-4 gap-1 p-3 max-h-[60vh] overflow-y-auto pb-8">
              {MORE_ITEMS.map(({ to, icon: Icon, label }) => (
                <button
                  key={to}
                  onClick={() => handleMoreNav(to)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-brand-50 transition-colors"
                >
                  <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center">
                    <Icon size={22} className="text-brand-700" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-600 text-center leading-tight">
                    {label}
                  </span>
                </button>
              ))}

              {/* Super admin link */}
              {role === 'super_admin' && (
                <button
                  onClick={() => handleMoreNav('/admin')}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-red-50 transition-colors"
                >
                  <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
                    <Building2 size={22} className="text-red-600" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-600 text-center leading-tight">
                    مدير النظام
                  </span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
