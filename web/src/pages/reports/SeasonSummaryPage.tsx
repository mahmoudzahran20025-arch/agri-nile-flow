import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Leaf, Banknote, Users, Package, TrendingDown, Download,
  ChevronDown, ChevronRight, MapPin, BarChart3,
} from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'
import type { Season } from '../../types'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
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
  const [seasonId, setSeasonId] = useState<number>(1)
  const [tab, setTab]           = useState<TabId>('overview')
  const [expandedCenter, setExpandedCenter] = useState<number | null>(null)

  const { data: seasons } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<Season[]>,
  })

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
              ...costCenters.map(r => [r.center_name, r.cash_total, r.supplier_total, r.inventory_total, r.grand_total, pct(r.grand_total, grand)])]
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
    { id: 'overview',      label: 'ملخص عام',          icon: <BarChart3  size={16} /> },
    { id: 'cost_centers',  label: 'مراكز التكلفة',     icon: <MapPin     size={16} /> },
    { id: 'expense_types', label: 'أنواع المصروفات',   icon: <Banknote   size={16} /> },
    { id: 'suppliers',     label: 'الموردين',           icon: <Users      size={16} /> },
    { id: 'inventory',     label: 'المخزون المنصرف',   icon: <Package    size={16} /> },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Leaf className="text-brand-600" size={26} />
            ملخص الموسم الزراعي
          </h1>
          {season && (
            <p className="text-sm text-slate-500 mt-1">
              {season.name} — {new Date(season.start_date).toLocaleDateString('ar-EG')} إلى {new Date(season.end_date).toLocaleDateString('ar-EG')}
              <span className={`mr-2 badge ${season.status === 'active' ? 'badge-green' : 'badge-blue'}`}>{season.status === 'active' ? 'جارٍ' : 'مغلق'}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            className="input text-sm w-52"
            value={seasonId}
            onChange={e => setSeasonId(Number(e.target.value))}
          >
            {(seasons ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => downloadCsv(tab)} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={16} /> تصدير
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي النقدي', value: totals?.cash_out, color: 'blue',   icon: <Banknote size={20} /> },
          { label: 'مستحقات الموردين', value: totals?.supplier_credit, color: 'amber', icon: <Users    size={20} /> },
          { label: 'مدفوع للموردين',   value: totals?.supplier_debit,  color: 'green', icon: <TrendingDown size={20} /> },
          { label: 'تكلفة المخزون',    value: totals?.inventory_consumed, color: 'violet', icon: <Package size={20} /> },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className={`card p-4 border-r-4 border-${color}-500`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-${color}-500`}>{icon}</span>
              <span className="text-xs text-slate-500">{label}</span>
            </div>
            <p className={`text-lg font-bold text-${color}-700`}>
              {isLoading ? '...' : egp(value)}
            </p>
            {!isLoading && grand > 0 && value != null && (
              <p className="text-xs text-slate-400 mt-0.5">{pct(value, grand)} من الإجمالي</p>
            )}
          </div>
        ))}
      </div>

      {/* Grand total bar */}
      {!isLoading && grand > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">إجمالي تكاليف الموسم</span>
            <span className="text-xl font-bold text-brand-700">{egp(grand)}</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
            {[
              { val: totals?.cash_out ?? 0,             color: 'bg-blue-500' },
              { val: totals?.supplier_credit ?? 0,      color: 'bg-amber-500' },
              { val: totals?.inventory_consumed ?? 0,   color: 'bg-violet-500' },
            ].map(({ val, color }, i) => (
              <div key={i} className={`${color} h-full transition-all`} style={{ width: `${(val / grand) * 100}%` }} />
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> نقدي {pct(totals?.cash_out ?? 0, grand)}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> موردين {pct(totals?.supplier_credit ?? 0, grand)}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" /> مخزون {pct(totals?.inventory_consumed ?? 0, grand)}</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="flex items-center justify-center h-40 text-slate-400">جاري التحميل...</div>}
      {isError   && <div className="text-red-500 text-center py-8">حدث خطأ في تحميل البيانات</div>}

      {/* ─── Tab: Overview ─── */}
      {!isLoading && tab === 'overview' && (
        <div className="space-y-4">
          {/* Monthly timeline */}
          {timeline.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">التسلسل الزمني الشهري</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="py-2 text-right text-slate-500 font-medium">الشهر</th>
                      <th className="py-2 text-left text-blue-600 font-medium">نقدي</th>
                      <th className="py-2 text-left text-amber-600 font-medium">موردين</th>
                      <th className="py-2 text-left text-slate-600 font-medium">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {timeline.map(row => {
                      const rowTotal = (row.cash_out ?? 0) + (row.supplier_credit ?? 0)
                      return (
                        <tr key={`${row.year}-${row.month}`} className="hover:bg-slate-50">
                          <td className="py-2 text-slate-700 font-medium">
                            {MONTH_AR[(row.month ?? 1) - 1]} {row.year}
                          </td>
                          <td className="py-2 text-left text-blue-700">{egp(row.cash_out)}</td>
                          <td className="py-2 text-left text-amber-700">{egp(row.supplier_credit)}</td>
                          <td className="py-2 text-left font-bold text-slate-800">{egp(rowTotal)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top suppliers snapshot */}
          {suppliers.slice(0, 5).length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">أكبر 5 موردين</h3>
                <button onClick={() => setTab('suppliers')} className="text-xs text-brand-600 hover:underline">عرض الكل</button>
              </div>
              <div className="space-y-2">
                {suppliers.slice(0, 5).map(r => (
                  <div key={r.supplier_code} className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 w-48 truncate">{r.supplier_name}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{ width: `${Math.min((r.total_credit / (suppliers[0]?.total_credit || 1)) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-amber-700 w-28 text-left">{egp(r.total_credit)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Cost Centers ─── */}
      {!isLoading && tab === 'cost_centers' && (
        <div className="card overflow-hidden">
          {costCenters.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <MapPin size={40} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد بيانات مراكز تكلفة لهذا الموسم</p>
              <p className="text-xs mt-1">تأكد من ربط المعاملات بـ center_code</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right text-slate-600 font-medium">مركز التكلفة</th>
                  <th className="px-4 py-3 text-left text-blue-600 font-medium w-32">نقدي</th>
                  <th className="px-4 py-3 text-left text-amber-600 font-medium w-32">موردين</th>
                  <th className="px-4 py-3 text-left text-violet-600 font-medium w-32">مخزون</th>
                  <th className="px-4 py-3 text-left text-slate-700 font-medium w-32">الإجمالي</th>
                  <th className="px-4 py-3 text-right text-slate-500 font-medium w-28">%</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {costCenters.map(r => (
                  <>
                    <tr
                      key={r.center_code}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => setExpandedCenter(expandedCenter === r.center_code ? null : r.center_code)}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">{r.center_name}</td>
                      <td className="px-4 py-3 text-left text-blue-700">{r.cash_total > 0 ? egp(r.cash_total) : '—'}</td>
                      <td className="px-4 py-3 text-left text-amber-700">{r.supplier_total > 0 ? egp(r.supplier_total) : '—'}</td>
                      <td className="px-4 py-3 text-left text-violet-700">{r.inventory_total > 0 ? egp(r.inventory_total) : '—'}</td>
                      <td className="px-4 py-3 text-left font-bold text-slate-800">{egp(r.grand_total)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-500 rounded-full" style={{ width: pct(r.grand_total, grand) }} />
                          </div>
                          <span className="text-xs text-slate-500 w-10 text-right">{pct(r.grand_total, grand)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {expandedCenter === r.center_code ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                    </tr>
                    {expandedCenter === r.center_code && (
                      <tr key={`${r.center_code}-expand`}>
                        <td colSpan={7} className="bg-slate-50 px-8 py-3">
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            <div>
                              <p className="font-semibold text-blue-700 mb-1">نقدي</p>
                              <p>{egp(r.cash_total)}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-amber-700 mb-1">موردين</p>
                              <p>{egp(r.supplier_total)}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-violet-700 mb-1">مخزون منصرف</p>
                              <p>{egp(r.inventory_total)}</p>
                            </div>
                          </div>
                          <button
                            className="mt-2 text-xs text-brand-600 hover:underline"
                            onClick={(e) => { e.stopPropagation(); navigate(`/reports/cost-centers?center=${r.center_code}&season=${seasonId}`) }}
                          >
                            عرض التفاصيل الكاملة ←
                          </button>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-700">الإجمالي</td>
                  <td className="px-4 py-3 text-left font-bold text-blue-700">{egp(totals?.cash_out)}</td>
                  <td className="px-4 py-3 text-left font-bold text-amber-700">{egp(totals?.supplier_credit)}</td>
                  <td className="px-4 py-3 text-left font-bold text-violet-700">{egp(totals?.inventory_consumed)}</td>
                  <td className="px-4 py-3 text-left font-bold text-brand-700">{egp(grand)}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">100%</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ─── Tab: Expense Types ─── */}
      {!isLoading && tab === 'expense_types' && (
        <div className="card overflow-hidden">
          {expenseTypes.length === 0 ? (
            <div className="text-center py-16 text-slate-400"><p>لا توجد بيانات مصروفات</p></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right text-slate-600 font-medium">نوع المصروف</th>
                  <th className="px-4 py-3 text-left text-blue-600 font-medium w-36">إجمالي نقدي</th>
                  <th className="px-4 py-3 text-center text-slate-500 font-medium w-20">معاملات</th>
                  <th className="px-4 py-3 text-right text-slate-500 font-medium w-36">النسبة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenseTypes.map(r => (
                  <tr key={r.expense_code} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.expense_name}</td>
                    <td className="px-4 py-3 text-left text-blue-700 font-semibold">{egp(r.total)}</td>
                    <td className="px-4 py-3 text-center"><span className="badge-blue">{r.cnt}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: pct(r.total, totals?.cash_out ?? 1) }} />
                        </div>
                        <span className="text-xs text-slate-500 w-10 text-right">{pct(r.total, totals?.cash_out ?? 1)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-700">الإجمالي</td>
                  <td className="px-4 py-3 text-left font-bold text-blue-700">{egp(totals?.cash_out)}</td>
                  <td className="px-4 py-3 text-center text-slate-500 text-xs">{expenseTypes.reduce((s, r) => s + r.cnt, 0)}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">100%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ─── Tab: Suppliers ─── */}
      {!isLoading && tab === 'suppliers' && (
        <div className="card overflow-hidden">
          {suppliers.length === 0 ? (
            <div className="text-center py-16 text-slate-400"><p>لا توجد بيانات موردين</p></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right text-slate-600 font-medium">المورد</th>
                  <th className="px-4 py-3 text-right text-slate-500 font-medium w-28">النشاط</th>
                  <th className="px-4 py-3 text-left text-amber-600 font-medium w-36">دائن (مستحق)</th>
                  <th className="px-4 py-3 text-left text-blue-600 font-medium w-36">مدين (سُدِّد)</th>
                  <th className="px-4 py-3 text-left text-slate-600 font-medium w-32">الرصيد</th>
                  <th className="px-4 py-3 text-center text-slate-500 font-medium w-20">معاملات</th>
                  <th className="px-4 py-3 text-right text-slate-500 font-medium w-32">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map(r => (
                  <tr
                    key={r.supplier_code}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => navigate(`/suppliers/${r.supplier_code}`)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{r.supplier_name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.activity ?? '—'}</td>
                    <td className="px-4 py-3 text-left text-amber-700 font-semibold">{egp(r.total_credit)}</td>
                    <td className="px-4 py-3 text-left text-blue-700">{r.total_debit > 0 ? egp(r.total_debit) : '—'}</td>
                    <td className="px-4 py-3 text-left">
                      <span className={`font-bold text-xs ${r.balance > 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {egp(Math.abs(r.balance))} {r.balance > 0 ? '(علينا)' : '(لنا)'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center"><span className="badge-blue">{r.tx_count}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: pct(r.total_credit, totals?.supplier_credit ?? 1) }} />
                        </div>
                        <span className="text-xs text-slate-500 w-10 text-right">{pct(r.total_credit, totals?.supplier_credit ?? 1)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-700">الإجمالي</td>
                  <td></td>
                  <td className="px-4 py-3 text-left font-bold text-amber-700">{egp(totals?.supplier_credit)}</td>
                  <td className="px-4 py-3 text-left font-bold text-blue-700">{egp(totals?.supplier_debit)}</td>
                  <td className="px-4 py-3 text-left font-bold text-red-700">{egp((totals?.supplier_credit ?? 0) - (totals?.supplier_debit ?? 0))}</td>
                  <td className="px-4 py-3 text-center text-slate-500 text-xs">{suppliers.reduce((s, r) => s + r.tx_count, 0)}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">100%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ─── Tab: Inventory ─── */}
      {!isLoading && tab === 'inventory' && (
        <div className="card overflow-hidden">
          {invItems.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Package size={40} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد حركات صرف مخزون مرتبطة بهذا الموسم</p>
              <p className="text-xs mt-1">ارتبط حركات المخزون بـ season_id عند الإضافة</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right text-slate-600 font-medium">الصنف</th>
                  <th className="px-4 py-3 text-right text-slate-500 font-medium w-20">الوحدة</th>
                  <th className="px-4 py-3 text-left text-violet-600 font-medium w-36">الكمية المنصرفة</th>
                  <th className="px-4 py-3 text-left text-violet-700 font-medium w-36">القيمة</th>
                  <th className="px-4 py-3 text-right text-slate-500 font-medium w-36">النسبة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invItems.map(r => (
                  <tr key={r.item_code} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.item_name}</td>
                    <td className="px-4 py-3 text-slate-500">{r.unit ?? '—'}</td>
                    <td className="px-4 py-3 text-left text-violet-700 font-semibold">
                      {new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(r.total_qty_out)}
                    </td>
                    <td className="px-4 py-3 text-left text-violet-800 font-bold">{egp(r.total_value_out)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-violet-400 rounded-full" style={{ width: pct(r.total_value_out, totals?.inventory_consumed ?? 1) }} />
                        </div>
                        <span className="text-xs text-slate-500 w-10 text-right">{pct(r.total_value_out, totals?.inventory_consumed ?? 1)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                <tr>
                  <td className="px-4 py-3 font-bold text-slate-700">الإجمالي</td>
                  <td></td>
                  <td></td>
                  <td className="px-4 py-3 text-left font-bold text-violet-700">{egp(totals?.inventory_consumed)}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">100%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
