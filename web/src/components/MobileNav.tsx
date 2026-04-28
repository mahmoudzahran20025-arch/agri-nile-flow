/**
 * MobileNav — bottom navigation bar, visible only on small screens (< md).
 * 4 primary tabs + "المزيد" button that slides up a full bottom-sheet with ALL nav items.
 */
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, Banknote, Users, MoreHorizontal,
  X, FileText, TrendingUp, ClipboardList, MapPin, Wrench,
  BookOpen, BookMarked, BarChart3, Shield, UserCog, Settings, Building2,
  Layers, GitBranch, Lock, Landmark, ShoppingCart, Link2, CreditCard,
  Leaf, Scale, Target, PieChart, CalendarDays, Wheat, ChevronDown,
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

interface MoreSection {
  label: string
  color: string
  items: { to: string; icon: React.ElementType; label: string }[]
}

const MORE_SECTIONS: MoreSection[] = [
  {
    label: 'العمليات الزراعية',
    color: 'bg-emerald-50 border-emerald-100',
    items: [
      { to: '/treasury/partners',        icon: TrendingUp,    label: 'الشركاء'         },
      { to: '/inventory/movements',      icon: ClipboardList, label: 'حركات المخزون'   },
      { to: '/inventory/posting-health', icon: Shield,        label: 'صحة الترحيل المخزني' },
      { to: '/inventory/cost-by-field',  icon: Wheat,         label: 'تكلفة الحقل'     },
      { to: '/fields',                   icon: MapPin,        label: 'قطع الأراضي'     },
      { to: '/fields/harvest',           icon: Leaf,          label: 'محصول وحصاد'     },
      { to: '/operations',               icon: Wrench,        label: 'أوامر العمل'     },
      { to: '/operations/templates',     icon: Layers,        label: 'نماذج العمليات'  },
      { to: '/contracts',                icon: FileText,      label: 'العقود'          },
    ],
  },
  {
    label: 'الموارد البشرية',
    color: 'bg-blue-50 border-blue-100',
    items: [
      { to: '/hr',                  icon: Users,        label: 'الموظفون'          },
      { to: '/hr/dashboard',        icon: PieChart,     label: 'لوحة HR'           },
      { to: '/hr/org',              icon: GitBranch,    label: 'الهيكل التنظيمي'   },
      { to: '/hr/attendance',       icon: ClipboardList,label: 'سجلات الحضور'      },
      { to: '/hr/leaves',           icon: FileText,     label: 'إجازات وسلف'       },
      { to: '/hr/payroll',          icon: Banknote,     label: 'مسير الرواتب'      },
      { to: '/hr/location-tasks',   icon: Target,       label: 'مهام ميدانية'      },
      { to: '/calendar',            icon: CalendarDays, label: 'التقويم الزراعي'   },
      { to: '/documents',           icon: FileText,     label: 'المستندات'         },
    ],
  },
  {
    label: 'المحاسبة',
    color: 'bg-violet-50 border-violet-100',
    items: [
      { to: '/gl/accounts',   icon: BookOpen,     label: 'دليل الحسابات'    },
      { to: '/gl/entries',    icon: BookMarked,   label: 'قيود اليومية'     },
      { to: '/gl/statements', icon: BarChart3,    label: 'القوائم المالية'  },
      { to: '/gl/periods',    icon: Lock,         label: 'الفترات المالية'  },
      { to: '/gl/posting-setup', icon: Link2,        label: 'ربط الحسابات'     },
      { to: '/treasury/bank', icon: Landmark,     label: 'تسوية بنكية'      },      { to: '/treasury/po',   icon: ShoppingCart, label: 'طلبات الشراء'     },
      { to: '/treasury/ap',   icon: CreditCard,   label: 'ذمم الموردين'     },
    ],
  },
  {
    label: 'التقارير',
    color: 'bg-amber-50 border-amber-100',
    items: [
      { to: '/reports',                   icon: FileText,     label: 'التقارير'              },
      { to: '/reports/trial-balance',     icon: Scale,        label: 'ميزان المراجعة'         },
      { to: '/reports/charts',            icon: BarChart3,    label: 'التقارير المرئية'       },
      { to: '/reports/cost-centers',      icon: Target,       label: 'مراكز التكلفة'         },
      { to: '/reports/suppliers-balance', icon: Scale,        label: 'أرصدة الموردين'         },
      { to: '/reports/season-summary',    icon: Leaf,         label: 'ملخص الموسم'           },
      { to: '/reports/season-pnl',        icon: TrendingUp,   label: 'أرباح وخسائر'          },
      { to: '/reports/season-close',      icon: Lock,         label: 'إغلاق الموسم'          },
    ],
  },
  {
    label: 'الإدارة',
    color: 'bg-slate-50 border-slate-100',
    items: [
      { to: '/users',  icon: UserCog, label: 'المستخدمون'  },
      { to: '/audit',  icon: Shield,  label: 'سجل التدقيق' },
      { to: '/config', icon: Settings,label: 'الإعدادات'   },
    ],
  },
]

export default function MobileNav() {
  const isAuth    = useIsAuth()
  const { role }  = useAppStore()
  const navigate  = useNavigate()
  const [open, setOpen]           = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  const { data: alerts = [] } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn:  () => dashboardApi.inventoryAlerts() as Promise<unknown[]>,
    enabled:  isAuth,
    staleTime: 120_000,
  })
  const alertCount = alerts.length

  const handleMoreNav = (to: string) => {
    setOpen(false)
    setExpandedSection(null)
    navigate(to)
  }

  return (
    <>
      {/* ── Bottom bar ─────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 safe-area-inset-bottom">
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
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors
              ${open ? 'text-brand-600' : 'text-slate-400'}`}
          >
            <div className={`p-1.5 rounded-xl ${open ? 'bg-brand-50' : ''}`}>
              <MoreHorizontal size={22} strokeWidth={open ? 2.5 : 2} />
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
            onClick={() => { setOpen(false); setExpandedSection(null) }}
          />

          {/* Sheet */}
          <div
            className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-2xl shadow-2xl"
            dir="rtl"
            style={{ maxHeight: '82vh' }}
          >
            {/* Handle + header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="font-semibold text-slate-700">كل الأقسام</span>
              <button
                onClick={() => { setOpen(false); setExpandedSection(null) }}
                className="p-1.5 rounded-full hover:bg-slate-100"
              >
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            {/* Sections */}
            <div className="overflow-y-auto pb-8" style={{ maxHeight: 'calc(82vh - 56px)' }}>
              {MORE_SECTIONS.map(section => {
                const isExpanded = expandedSection === section.label
                return (
                  <div key={section.label} className={`border-b border-slate-100`}>
                    {/* Section toggle */}
                    <button
                      className={`w-full flex items-center justify-between px-4 py-3 ${section.color} border-b`}
                      onClick={() => setExpandedSection(isExpanded ? null : section.label)}
                    >
                      <span className="text-sm font-bold text-slate-700">{section.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">{section.items.length} صفحة</span>
                        <ChevronDown
                          size={16}
                          className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </button>

                    {/* Section items grid */}
                    {isExpanded && (
                      <div className="grid grid-cols-3 gap-2 p-3">
                        {section.items.map(({ to, icon: Icon, label }) => (
                          <button
                            key={to}
                            onClick={() => handleMoreNav(to)}
                            className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-brand-50 active:scale-95 transition-all"
                          >
                            <div className="w-11 h-11 bg-brand-100 rounded-xl flex items-center justify-center">
                              <Icon size={20} className="text-brand-700" />
                            </div>
                            <span className="text-[11px] font-medium text-slate-600 text-center leading-tight">
                              {label}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Super admin link */}
              {role === 'super_admin' && (
                <div className="p-3">
                  <button
                    onClick={() => handleMoreNav('/admin')}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-red-50 hover:bg-red-100 transition-colors"
                  >
                    <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                      <Building2 size={20} className="text-red-600" />
                    </div>
                    <span className="text-sm font-medium text-red-700">بوابة مدير النظام</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
