import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Leaf, Banknote, Users, Package, TrendingDown, Download,
  ChevronDown, ChevronRight, MapPin, BarChart3, Info,
} from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'
import type { Season } from '../../types'
import { useAppStore } from '../../store/appStore'

function egp(n: number | null | undefined) {
  if (n == null) return '0 ج.م'
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
  }).format(n)
}

function pct(part: number, total: number) {
  if (!total || !part) return '0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

const MONTH_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

type TabId = 'overview' | 'cost_centers' | 'expense_types' | 'suppliers' | 'inventory'

export default function SeasonSummaryPage() {
  const navigate = useNavigate()
  const activeSeasonId = useAppStore(s => s.activeSeason?.id)
  const [seasonId, setSeasonId] = useState<number>(0)
  const [tab, setTab]           = useState<TabId>('overview')
  const [expandedCenter, setExpandedCenter] = useState<number | null>(null)

  const { data: seasons } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<Season[]>,
  })

  useEffect(() => {
    if (seasonId === 0 && seasons && seasons.length > 0) {
      setSeasonId(activeSeasonId ?? seasons[0].id)
    }
  }, [seasons, activeSeasonId, seasonId])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'season-summary', seasonId],
    queryFn:  () => reportsApi.seasonSummary(seasonId),
    enabled:  !!seasonId,
  })

  const totals       = data?.totals
  const grand        = totals?.grand_total ?? 0
  const costCenters  = data?.by_cost_center  ?? []
  const expenseTypes = data?.by_expense_type ?? []
  const suppliers    = data?.by_supplier     ?? []
  const invItems     = data?.by_inventory_item ?? []
  const timeline     = data?.monthly_timeline ?? []
  const season       = data?.season as { name: string; season_type: string; start_date: string; end_date: string; status: string } | null | undefined

  function downloadCsv(tabId: TabId) {
    const BOM = '\uFEFF'
    let rows: (string | number)[][] = []
    let filename = ''

    if (tabId === 'cost_centers') {
      rows = [['مركز التكلفة', 'نقدي', 'موردين', 'مخزون', 'الإجمالي', '%'],
              ...costCenters.map(r => [r.center_name || 'غير محدد', r.cash_total, r.supplier_total, r.inventory_total, r.grand_total, pct(r.grand_total, grand)])]
      filename = 'مراكز_التكلفة'
    } else if (tabId === 'suppliers') {
      rows = [['كود', 'المورد', 'النشاط', 'دائن', 'مدين', 'الرصيد'],
              ...suppliers.map(r => [r.supplier_code, r.supplier_name, r.activity ?? '', r.total_credit, r.total_debit, r.balance])]
      filename = 'الموردين'
    } else if (tabId === 'inventory') {
      rows = [['كود', 'الصنف', 'الوحدة', 'الكمية المنصرفة', 'القيمة'],
              ...invItems.map(r => [r.item_code, r.item_name, r.unit ?? '', r.total_qty_out, r.total_value_out])]
      filename = 'المخزون_المنصرف'
    } else {
      rows = [['البند', 'المبلغ'],
              ['نقدي', totals?.cash_out ?? 0],
              ['موردين (دائن)', totals?.supplier_credit ?? 0],
              ['موردين (مدين)', totals?.supplier_debit ?? 0],
              ['مخزون منصرف', totals?.inventory_consumed ?? 0],
              ['الإجمالي', grand]]
      filename = 'ملخص_الموسم'
    }

    const csv = BOM + rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${filename}_موسم_${seasonId}.csv`
    link.click()
  }

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'overview',      label: 'نظرة عامة',          icon: <BarChart3  size={18} /> },
    { id: 'cost_centers',  label: 'مراكز التكلفة',     icon: <MapPin     size={18} /> },
    { id: 'expense_types', label: 'بنود المصروفات',   icon: <Banknote   size={18} /> },
    { id: 'suppliers',     label: 'كشف الموردين',      icon: <Users      size={18} /> },
    { id: 'inventory',     label: 'استهلاك المخزون',   icon: <Package    size={18} /> },
  ]

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      {/* Header Section */}
      <div className="glass rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4 text-center md:text-right">
          <div className="p-3 bg-brand-100 text-brand-600 rounded-2xl">
            <Leaf size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">تحليلات الموسم الزراعي</h1>
            {season ? (
              <div className="flex items-center gap-2 mt-1 text-slate-500 font-medium">
                <span>{season.name}</span>
                <span className="text-slate-300">•</span>
                <span className={`badge ${season.status === 'active' ? 'badge-green' : 'badge-blue'}`}>
                  {season.status === 'active' ? 'موسم جارٍ' : 'موسم مغلق'}
                </span>
              </div>
            ) : (
              <p className="text-slate-400">اختر موسماً لعرض التحليلات</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:flex-initial">
            <select
              className="input pr-10 min-w-[200px] font-bold text-slate-700 h-12 shadow-sm"
              value={seasonId}
              onChange={e => setSeasonId(Number(e.target.value))}
            >
              {(seasons ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button 
            onClick={() => downloadCsv(tab)} 
            className="btn-secondary h-12 px-6 rounded-xl border-slate-200 hover:border-brand-500 group"
          >
            <Download size={18} className="group-hover:translate-y-0.5 transition-transform" /> 
            <span>تصدير البيانات</span>
          </button>
        </div>
      </div>

      {/* KPI Dynamic Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'سيولة نقدية خارجة', value: totals?.cash_out, color: 'blue',   icon: <Banknote size={24} />, bg: 'bg-blue-50' },
          { label: 'مديونية للموردين', value: totals?.supplier_credit, color: 'amber', icon: <Users    size={24} />, bg: 'bg-amber-50' },
          { label: 'مدفوعات مسددة',   value: totals?.supplier_debit,  color: 'emerald', icon: <TrendingDown size={24} />, bg: 'bg-emerald-50' },
          { label: 'مخزون مستهلك',    value: totals?.inventory_consumed, color: 'indigo', icon: <Package size={24} />, bg: 'bg-indigo-50' },
        ].map(({ label, value, color, icon, bg }) => (
          <div key={label} className="card group p-6 overflow-hidden relative">
            <div className={`absolute top-0 right-0 w-1.5 h-full bg-${color}-500 transition-all group-hover:w-2`} />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-slate-500 mb-1">{label}</p>
                <h3 className={`text-2xl font-black text-${color}-600 tracking-tight`}>
                  {isLoading ? <div className="h-8 w-24 bg-slate-100 animate-pulse rounded" /> : egp(value)}
                </h3>
              </div>
              <div className={`p-3 ${bg} text-${color}-600 rounded-2xl`}>{icon}</div>
            </div>
            {!isLoading && grand > 0 && value != null && (
              <div className="mt-4 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full bg-${color}-500`} style={{ width: pct(value, grand) }} />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pct(value, grand)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Master Breakdown Card */}
      {!isLoading && grand > 0 && (
        <div className="card p-8 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none shadow-2xl">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
            <div>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs mb-2">إجمالي تكلفة الموسم</p>
              <h2 className="text-5xl font-black text-white tracking-tighter">
                {egp(grand)}
              </h2>
            </div>
            <div className="flex gap-6">
              <div className="text-right">
                <p className="text-xs text-slate-400 mb-1">نقدي</p>
                <p className="text-blue-400 font-bold">{pct(totals?.cash_out ?? 0, grand)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 mb-1">موردين</p>
                <p className="text-amber-400 font-bold">{pct(totals?.supplier_credit ?? 0, grand)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 mb-1">مخزون</p>
                <p className="text-indigo-400 font-bold">{pct(totals?.inventory_consumed ?? 0, grand)}</p>
              </div>
            </div>
          </div>
          
          <div className="h-4 bg-white/10 rounded-full overflow-hidden flex shadow-inner">
            <div className="bg-blue-500 h-full transition-all duration-1000" style={{ width: pct(totals?.cash_out ?? 0, grand) }} />
            <div className="bg-amber-500 h-full transition-all duration-1000" style={{ width: pct(totals?.supplier_credit ?? 0, grand) }} />
            <div className="bg-indigo-500 h-full transition-all duration-1000" style={{ width: pct(totals?.inventory_consumed ?? 0, grand) }} />
          </div>
          
          <div className="mt-6 flex flex-wrap gap-6 text-sm text-slate-300">
             <div className="flex items-center gap-2">
               <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
               <span>نفقات نقدية مباشرة</span>
             </div>
             <div className="flex items-center gap-2">
               <div className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
               <span>ذمم دائنة (آجل)</span>
             </div>
             <div className="flex items-center gap-2">
               <div className="w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
               <span>مستلزمات إنتاج مخزنية</span>
             </div>
          </div>
        </div>
      )}

      {/* Modern Tabs Navigation */}
      <div className="flex items-center gap-2 bg-slate-100/50 p-1.5 rounded-2xl w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${
              tab === t.id
                ? 'bg-white text-brand-600 shadow-md translate-y-[-1px]'
                : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="min-h-[400px]">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 animate-pulse">
            <Leaf className="text-slate-200 mb-4 animate-bounce" size={64} />
            <p className="text-slate-400 font-bold">جاري تحليل بيانات الموسم...</p>
          </div>
        )}
        
        {isError && (
          <div className="glass p-12 text-center rounded-3xl border-rose-100">
            <div className="bg-rose-100 text-rose-600 p-4 rounded-full w-fit mx-auto mb-4">
              <Info size={32} />
            </div>
            <h3 className="text-xl font-bold text-slate-800">تعذر تحميل التقارير</h3>
            <p className="text-slate-500 mt-2">يرجى التحقق من اتصالك بالإنترنت أو صلاحيات الوصول.</p>
          </div>
        )}

        {/* ─── Tab: Overview ─── */}
        {!isLoading && tab === 'overview' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
               {/* Timeline Card */}
               <div className="card p-6">
                 <div className="flex items-center justify-between mb-6">
                   <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                     <TrendingDown className="text-brand-500" />
                     المصروفات الشهرية
                   </h3>
                 </div>
                 <div className="overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-slate-50 rounded-xl overflow-hidden">
                          <th className="th py-4">الشهر</th>
                          <th className="th py-4 text-left">نقدية</th>
                          <th className="th py-4 text-left">آجل</th>
                          <th className="th py-4 text-left">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {timeline.length > 0 ? timeline.map(row => {
                          const rowTotal = (row.cash_out ?? 0) + (row.supplier_credit ?? 0)
                          return (
                            <tr key={`${row.year}-${row.month}`} className="hover:bg-slate-50 transition-colors group">
                              <td className="td py-4 font-bold text-slate-700">
                                {MONTH_AR[(row.month ?? 1) - 1]} {row.year}
                              </td>
                              <td className="td py-4 text-left text-blue-600 font-medium">{egp(row.cash_out)}</td>
                              <td className="td py-4 text-left text-amber-600 font-medium">{egp(row.supplier_credit)}</td>
                              <td className="td py-4 text-left">
                                <span className="bg-slate-100 px-3 py-1.5 rounded-lg font-black text-slate-800 group-hover:bg-brand-50 group-hover:text-brand-700 transition-colors">
                                  {egp(rowTotal)}
                                </span>
                              </td>
                            </tr>
                          )
                        }) : (
                          <tr><td colSpan={4} className="td py-10 text-center text-slate-400">لا توجد حركات مسجلة لهذا الموسم</td></tr>
                        )}
                      </tbody>
                    </table>
                 </div>
               </div>
            </div>

            <div className="space-y-6">
               {/* Top Suppliers Snapshot */}
               <div className="card p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-black text-slate-800">أبرز الموردين</h3>
                    <button onClick={() => setTab('suppliers')} className="text-xs font-bold text-brand-600 hover:text-brand-700">عرض الكل</button>
                  </div>
                  <div className="space-y-5">
                    {suppliers.slice(0, 5).map((r, i) => (
                      <div key={r.supplier_code} className="relative">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-sm font-bold text-slate-700 truncate">{r.supplier_name}</span>
                          <span className="text-xs font-black text-amber-600">{egp(r.total_credit)}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${i === 0 ? 'bg-amber-500' : 'bg-slate-300'}`}
                            style={{ width: pct(r.total_credit, suppliers[0]?.total_credit || 1) }}
                          />
                        </div>
                      </div>
                    ))}
                    {suppliers.length === 0 && <p className="text-center py-6 text-slate-400 text-sm italic">لا يوجد موردون نشطون</p>}
                  </div>
               </div>
            </div>
          </div>
        )}

        {/* ─── Tab: Cost Centers ─── */}
        {!isLoading && tab === 'cost_centers' && (
          <div className="card overflow-hidden border-none shadow-xl">
             <table className="w-full">
                <thead className="bg-slate-50/80 backdrop-blur-sm">
                  <tr>
                    <th className="th py-5">مركز التكلفة / الحقل</th>
                    <th className="th py-5 text-left text-blue-600">نقدية</th>
                    <th className="th py-5 text-left text-amber-600">آجل</th>
                    <th className="th py-5 text-left text-indigo-600">مخزن</th>
                    <th className="th py-5 text-left text-slate-900">إجمالي النفقات</th>
                    <th className="th py-5 text-center">الوزن النسبي</th>
                    <th className="th py-5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {costCenters.length > 0 ? costCenters.map(r => (
                    <React.Fragment key={r.center_code}>
                      <tr 
                        className={`hover:bg-brand-50/30 cursor-pointer transition-colors ${expandedCenter === r.center_code ? 'bg-brand-50/50' : ''}`}
                        onClick={() => setExpandedCenter(expandedCenter === r.center_code ? null : r.center_code)}
                      >
                        <td className="td py-5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-brand-600 shadow-sm border border-slate-100">
                              <MapPin size={20} />
                            </div>
                            <span className="font-black text-slate-800">{r.center_name || 'مصروفات عامة / غير مخصصة'}</span>
                          </div>
                        </td>
                        <td className="td py-5 text-left text-blue-600 font-bold">{r.cash_total > 0 ? egp(r.cash_total) : '—'}</td>
                        <td className="td py-5 text-left text-amber-600 font-bold">{r.supplier_total > 0 ? egp(r.supplier_total) : '—'}</td>
                        <td className="td py-5 text-left text-indigo-600 font-bold">{r.inventory_total > 0 ? egp(r.inventory_total) : '—'}</td>
                        <td className="td py-5 text-left">
                           <span className="text-lg font-black text-slate-900">{egp(r.grand_total)}</span>
                        </td>
                        <td className="td py-5">
                           <div className="flex items-center justify-center gap-3">
                             <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                               <div className="h-full bg-brand-500 rounded-full" style={{ width: pct(r.grand_total, grand) }} />
                             </div>
                             <span className="text-[11px] font-black text-brand-600 w-10">{pct(r.grand_total, grand)}</span>
                           </div>
                        </td>
                        <td className="td py-5 text-slate-400">
                           {expandedCenter === r.center_code ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                        </td>
                      </tr>
                      {expandedCenter === r.center_code && (
                        <tr className="bg-white/50">
                          <td colSpan={7} className="p-0 overflow-hidden">
                            <div className="p-8 border-x-4 border-brand-500 bg-brand-50/20 animate-fade-in">
                               <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                  <div className="glass p-4 rounded-2xl">
                                    <p className="text-[10px] uppercase font-black text-blue-500 mb-2 tracking-widest">تحليل النقدية</p>
                                    <p className="text-xl font-bold text-slate-800">{egp(r.cash_total)}</p>
                                    <p className="text-xs text-slate-400 mt-1">تشمل الأجور والمشتريات المباشرة</p>
                                  </div>
                                  <div className="glass p-4 rounded-2xl">
                                    <p className="text-[10px] uppercase font-black text-amber-500 mb-2 tracking-widest">تحليل المديونية</p>
                                    <p className="text-xl font-bold text-slate-800">{egp(r.supplier_total)}</p>
                                    <p className="text-xs text-slate-400 mt-1">فواتير آجلة لم يتم تسويتها</p>
                                  </div>
                                  <div className="glass p-4 rounded-2xl">
                                    <p className="text-[10px] uppercase font-black text-indigo-500 mb-2 tracking-widest">تحليل المخزون</p>
                                    <p className="text-xl font-bold text-slate-800">{egp(r.inventory_total)}</p>
                                    <p className="text-xs text-slate-400 mt-1">قيمة الأسمدة والمبيدات المنصرفة</p>
                                  </div>
                               </div>
                               <div className="mt-6 flex justify-end">
                                 <button 
                                   onClick={(e) => { e.stopPropagation(); navigate(`/reports/cost-centers/${r.center_code}?season_id=${seasonId}`) }}
                                   className="btn-primary"
                                 >
                                   استعراض التحليل التفصيلي لهذا المركز
                                 </button>
                               </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )) : (
                    <tr><td colSpan={7} className="td py-20 text-center text-slate-400">لا توجد بيانات مراكز تكلفة متاحة</td></tr>
                  )}
                </tbody>
             </table>
          </div>
        )}

        {/* Other tabs follow same premium pattern... */}
        {!isLoading && tab === 'expense_types' && (
          <div className="card overflow-hidden shadow-xl border-none">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th py-5">بند المصروف</th>
                  <th className="th py-5 text-left text-blue-600">القيمة النقدية</th>
                  <th className="th py-5 text-center">عدد العمليات</th>
                  <th className="th py-5 text-right">الوزن من النقدية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenseTypes.length > 0 ? expenseTypes.map(r => (
                  <tr key={r.expense_code} className="hover:bg-slate-50 transition-colors">
                    <td className="td py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 border border-blue-100">
                          <Banknote size={20} />
                        </div>
                        <span className="font-black text-slate-800">{r.expense_name || 'مصروفات غير مصنفة'}</span>
                      </div>
                    </td>
                    <td className="td py-5 text-left text-blue-700 font-black text-lg">{egp(r.total)}</td>
                    <td className="td py-5 text-center">
                      <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-black">
                        {r.cnt} حركة
                      </span>
                    </td>
                    <td className="td py-5">
                      <div className="flex items-center gap-3 justify-end">
                        <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: pct(r.total, totals?.cash_out ?? 1) }} />
                        </div>
                        <span className="text-xs font-black text-slate-400 w-10">{pct(r.total, totals?.cash_out ?? 1)}</span>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="td py-20 text-center text-slate-400">لا توجد بيانات مصروفات</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Suppliers Tab */}
        {!isLoading && tab === 'suppliers' && (
          <div className="card overflow-hidden shadow-xl border-none">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th py-5">المورد والنشاط</th>
                  <th className="th py-5 text-left text-amber-600">إجمالي التعامل (دائن)</th>
                  <th className="th py-5 text-left text-emerald-600">المسدد (مدين)</th>
                  <th className="th py-5 text-left text-slate-900">الرصيد المتبقي</th>
                  <th className="th py-5 text-right w-40">توزيع التكلفة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.length > 0 ? suppliers.map(r => (
                  <tr 
                    key={r.supplier_code} 
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/suppliers/${r.supplier_code}`)}
                  >
                    <td className="td py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 border border-amber-100">
                          <Users size={20} />
                        </div>
                        <div>
                          <p className="font-black text-slate-800 leading-none mb-1">{r.supplier_name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{r.activity || 'نشاط غير محدد'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="td py-5 text-left text-amber-700 font-black">{egp(r.total_credit)}</td>
                    <td className="td py-5 text-left text-emerald-600 font-bold">{r.total_debit > 0 ? egp(r.total_debit) : '—'}</td>
                    <td className="td py-5 text-left">
                      <div className={`px-3 py-1.5 rounded-lg inline-block font-black text-sm ${r.balance > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {egp(Math.abs(r.balance))} {r.balance > 0 ? 'مستحق له' : 'سداد زائد'}
                      </div>
                    </td>
                    <td className="td py-5">
                      <div className="flex items-center gap-3 justify-end">
                        <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500" style={{ width: pct(r.total_credit, totals?.supplier_credit ?? 1) }} />
                        </div>
                        <span className="text-[10px] font-black text-slate-400 w-8">{pct(r.total_credit, totals?.supplier_credit ?? 1)}</span>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="td py-20 text-center text-slate-400">لا توجد تعاملات مع موردين</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Inventory Tab */}
        {!isLoading && tab === 'inventory' && (
          <div className="card overflow-hidden shadow-xl border-none">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th py-5">الصنف</th>
                  <th className="th py-5 text-center w-28">الوحدة</th>
                  <th className="th py-5 text-left text-indigo-600">الكمية المنصرفة</th>
                  <th className="th py-5 text-left text-slate-900">القيمة الإجمالية</th>
                  <th className="th py-5 text-right w-40">الأهمية النسبية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invItems.length > 0 ? invItems.map(r => (
                  <tr key={r.item_code} className="hover:bg-slate-50 transition-colors">
                    <td className="td py-5">
                       <div className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 border border-indigo-100">
                           <Package size={20} />
                         </div>
                         <span className="font-black text-slate-800">{r.item_name}</span>
                       </div>
                    </td>
                    <td className="td py-5 text-center text-slate-500 font-bold">{r.unit || '—'}</td>
                    <td className="td py-5 text-left text-indigo-600 font-black">
                      {new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(r.total_qty_out)}
                    </td>
                    <td className="td py-5 text-left">
                       <span className="text-lg font-black text-slate-900">{egp(r.total_value_out)}</span>
                    </td>
                    <td className="td py-5">
                       <div className="flex items-center gap-3 justify-end">
                         <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                           <div className="h-full bg-indigo-500" style={{ width: pct(r.total_value_out, totals?.inventory_consumed ?? 1) }} />
                         </div>
                         <span className="text-[10px] font-black text-slate-400 w-8">{pct(r.total_value_out, totals?.inventory_consumed ?? 1)}</span>
                       </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="td py-20 text-center text-slate-400">لم يتم صرف أي مخزون لهذا الموسم</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

import React from 'react'
