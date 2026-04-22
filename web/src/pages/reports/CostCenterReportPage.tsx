import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, BarChart3, Download } from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'

function egp(n: number | null | undefined) {
  if (n == null || n === 0) return '٠'
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
  }).format(n)
}

function pct(part: number, total: number) {
  if (!total) return '0%'
  return ((part / total) * 100).toFixed(1) + '%'
}

const MONTH_NAMES = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

export default function CostCenterReportPage() {
  const [seasonId,    setSeasonId]    = useState<number | undefined>(1)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  const { data: seasons } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['cost-centers-report', seasonId],
    queryFn:  () => reportsApi.costCenters(seasonId),
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['cost-center-detail', expandedRow, seasonId],
    queryFn:  () => reportsApi.costCenterDetail(expandedRow!, seasonId),
    enabled:  expandedRow !== null,
  })

  const rows       = data?.data ?? []
  const grandTotal = data?.grand_total ?? 0

  // Bar scale — max bar width for chart
  const maxTotal = rows.reduce((m, r) => Math.max(m, r.grand_total), 0)

  function toggleRow(code: number) {
    setExpandedRow(prev => prev === code ? null : code)
  }

  function exportCsv() {
    const header = 'مركز التكلفة,الاسم,نقدي (ج.م),موردين (ج.م),الإجمالي (ج.م),النسبة'
    const lines = rows.map(r =>
      `${r.center_code},"${r.center_name ?? ''}",${r.cash_total.toFixed(2)},${r.supplier_total.toFixed(2)},${r.grand_total.toFixed(2)},${pct(r.grand_total, grandTotal)}`
    )
    const blob = new Blob(['\ufeff' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: `مراكز_تكلفة_${seasonId ?? 'كل'}.csv` })
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BarChart3 size={22} className="text-blue-600" />
            تحليل تكاليف مراكز الإنتاج
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">إجمالي المصروفات النقدية وعمليات الموردين وصرف المخزون لكل بيفوت</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={seasonId ?? ''}
            onChange={e => setSeasonId(e.target.value ? Number(e.target.value) : undefined)}
            className="input-field h-9 text-sm"
          >
            <option value="">كل المواسم</option>
            {(seasons as Array<{ id: number; name: string }> ?? []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button onClick={exportCsv} className="btn-secondary gap-2 h-9 text-sm">
            <Download size={15} />
            تصدير CSV
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">إجمالي المصروفات</p>
          <p className="text-xl font-bold text-slate-900">{egp(grandTotal)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">مصروفات نقدية</p>
          <p className="text-xl font-bold text-blue-700">
            {egp(rows.reduce((s, r) => s + r.cash_total, 0))}
          </p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">مستحقات موردين</p>
          <p className="text-xl font-bold text-amber-700">
            {egp(rows.reduce((s, r) => s + (r.supplier_total ?? 0), 0))}
          </p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">صرف مخزون</p>
          <p className="text-xl font-bold text-green-700">
            {egp(rows.reduce((s, r) => s + (r.inventory_total ?? 0), 0))}
          </p>
        </div>
      </div>

      {/* Main Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-right font-semibold text-slate-700 w-10"></th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">مركز التكلفة</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700 hidden md:table-cell">البيفوت</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">نقدي</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">موردين</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 hidden md:table-cell">مخزون</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 font-bold">الإجمالي</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">% من الكل</th>
                <th className="px-4 py-3 hidden lg:table-cell"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">جارٍ التحميل…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">لا توجد بيانات للموسم المحدد</td></tr>
              )}
              {rows.map(row => (
                <>
                  <tr
                    key={row.center_code}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => toggleRow(row.center_code)}
                  >
                    <td className="px-4 py-3 text-slate-400">
                      {expandedRow === row.center_code
                        ? <ChevronUp size={16} />
                        : <ChevronDown size={16} />}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">
                      <span className="badge-blue text-xs ml-2">{row.center_code}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 hidden md:table-cell">
                      {row.center_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-left text-blue-700">
                      {row.cash_total ? egp(row.cash_total) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-left text-amber-700">
                      {row.supplier_total ? egp(row.supplier_total) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-left text-green-700 hidden md:table-cell">
                      {row.inventory_total ? egp(row.inventory_total) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-left font-bold text-slate-900">
                      {egp(row.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs">
                      {pct(row.grand_total, grandTotal)}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell w-40">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: maxTotal ? `${(row.grand_total / maxTotal) * 100}%` : '0%' }}
                        />
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedRow === row.center_code && (
                    <tr key={`detail-${row.center_code}`}>
                      <td colSpan={9} className="bg-slate-50 border-b border-slate-200">
                        <div className="px-6 py-4">
                          {detailLoading ? (
                            <p className="text-slate-400 text-sm">جارٍ التحميل…</p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Cash by category */}
                              <div>
                                <h4 className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">
                                  المصروفات النقدية — حسب النوع
                                </h4>
                                {(detail?.cash_by_category ?? []).length === 0
                                  ? <p className="text-slate-400 text-xs">لا توجد مصروفات نقدية</p>
                                  : (detail?.cash_by_category ?? []).map((c, i) => (
                                    <div key={i} className="flex justify-between items-center py-1 border-b border-slate-100 text-sm">
                                      <span className="text-slate-700">{c.expense_name}</span>
                                      <span className="font-medium text-blue-700">{egp(c.total)}</span>
                                    </div>
                                  ))
                                }
                              </div>

                              {/* Supplier by name */}
                              <div>
                                <h4 className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">
                                  مستحقات الموردين — حسب المورد
                                </h4>
                                {(detail?.sup_by_supplier ?? []).length === 0
                                  ? <p className="text-slate-400 text-xs">لا توجد معاملات موردين</p>
                                  : (detail?.sup_by_supplier ?? []).map((s, i) => (
                                    <div key={i} className="flex justify-between items-center py-1 border-b border-slate-100 text-sm">
                                      <span className="text-slate-700">{s.supplier_name}</span>
                                      <span className="font-medium text-amber-700">{egp(s.total)}</span>
                                    </div>
                                  ))
                                }
                              </div>

                              {/* Monthly timeline */}
                              {(detail?.cash_timeline ?? []).length > 0 && (
                                <div className="md:col-span-2">
                                  <h4 className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">
                                    التسلسل الزمني (نقدي)
                                  </h4>
                                  <div className="flex gap-3 flex-wrap">
                                    {(detail?.cash_timeline ?? []).map((t, i) => (
                                      <div key={i} className="bg-white border border-slate-200 rounded px-3 py-2 text-center min-w-[70px]">
                                        <p className="text-xs text-slate-500">{MONTH_NAMES[t.month]}</p>
                                        <p className="text-sm font-semibold text-slate-800">{egp(t.total)}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}

              {/* Grand Total Row */}
              {rows.length > 0 && (
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-slate-700" colSpan={2}>الإجمالي الكلي</td>
                  <td className="px-4 py-3 text-left text-blue-700">
                    {egp(rows.reduce((s, r) => s + r.cash_total, 0))}
                  </td>
                  <td className="px-4 py-3 text-left text-amber-700">
                    {egp(rows.reduce((s, r) => s + (r.supplier_total ?? 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-left text-green-700 hidden md:table-cell">
                    {egp(rows.reduce((s, r) => s + (r.inventory_total ?? 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-left text-slate-900 text-base">
                    {egp(grandTotal)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">100%</td>
                  <td className="hidden lg:table-cell"></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
