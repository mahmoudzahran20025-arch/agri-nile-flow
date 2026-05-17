import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, ChevronUp, BarChart3, Download, MapPin,
  TrendingDown, BookOpen, GitBranch,
} from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'

function egp(n: number | null | undefined) {
  if (n == null || n === 0) return '٠'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
  }).format(n)
}

function pct(part: number, total: number) {
  if (!total) return '0%'
  return ((part / total) * 100).toFixed(1) + '%'
}

const MONTH_NAMES = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

const ACCT_TYPE_AR: Record<string, string> = {
  expense: 'مصروف', revenue: 'إيراد', asset: 'أصول', liability: 'التزامات',
}

export default function CostCenterReportPage() {
  const [seasonId, setSeasonId]       = useState<number | undefined>(undefined)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [detailTab, setDetailTab]     = useState<'summary' | 'lines' | 'timeline'>('summary')

  const { data: seasons } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['cost-centers-report', seasonId],
    queryFn:  () => reportsApi.costCenters(seasonId),
  })

  const { data: detailResp, isLoading: detailLoading } = useQuery({
    queryKey: ['cost-center-detail', expandedRow, seasonId],
    queryFn:  () => reportsApi.costCenterDetail(expandedRow!, seasonId),
    enabled:  expandedRow !== null,
  })

  const rows      = data?.data ?? []
  const summary   = data?.summary
  const grandExp  = summary?.grand_expense ?? 0
  const detail    = detailResp?.data
  const detailLines = Array.isArray(detail?.lines) ? detail.lines : []
  const detailTimeline = Array.isArray(detail?.timeline) ? detail.timeline : []
  const detailPagination = detail?.pagination ?? { has_more: false, total: detailLines.length }

  const maxExpense = rows.reduce((m, r) => Math.max(m, r.expense_total), 0)

  function toggleRow(code: number) {
    if (expandedRow === code) { setExpandedRow(null); return }
    setExpandedRow(code)
    setDetailTab('summary')
  }

  function exportCsv() {
    const header = 'مركز التكلفة,الاسم,مصروفات (ج.م),إيرادات (ج.م),صافي التكلفة (ج.م),عدد القيود,النسبة'
    const lines = rows.map(r =>
      `${r.center_code},"${r.center_name ?? ''}",${r.expense_total.toFixed(2)},${r.revenue_total.toFixed(2)},${r.net_cost.toFixed(2)},${r.entry_count},${pct(r.expense_total, grandExp)}`
    )
    const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
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
          <p className="text-sm text-slate-500 mt-0.5">
            تجميع من دفتر الأستاذ العام — المصدر الوحيد للأرقام
          </p>
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

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">إجمالي المصروفات</p>
          <p className="text-xl font-bold text-red-700">{egp(summary?.grand_expense)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">إجمالي الإيرادات</p>
          <p className="text-xl font-bold text-emerald-700">{egp(summary?.grand_revenue)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">صافي التكلفة</p>
          <p className={`text-xl font-bold ${(summary?.grand_net_cost ?? 0) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {egp(summary?.grand_net_cost)}
          </p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">عدد المراكز</p>
          <p className="text-xl font-bold text-slate-700">{summary?.center_count ?? 0}</p>
        </div>
      </div>

      {/* Main table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-right font-semibold text-slate-700 w-10"></th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">مركز التكلفة</th>
                <th className="px-4 py-3 text-left font-semibold text-red-700">مصروفات</th>
                <th className="px-4 py-3 text-left font-semibold text-emerald-700 hidden md:table-cell">إيرادات</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">صافي التكلفة</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 hidden md:table-cell">قيود</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">% من الكل</th>
                <th className="px-4 py-3 hidden lg:table-cell"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">جارٍ التحميل…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">لا توجد بيانات للموسم المحدد</td></tr>
              )}
              {rows.map(row => (
                <Fragment key={row.center_code}>
                  <tr
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => toggleRow(row.center_code)}
                  >
                    <td className="px-4 py-3 text-slate-400">
                      {expandedRow === row.center_code ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 border border-blue-100 shrink-0">
                          <MapPin size={14} />
                        </div>
                        <span className="font-medium text-slate-700">{row.center_name ?? `مركز ${row.center_code}`}</span>
                        <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{row.center_code}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-left text-red-700 font-medium">
                      {row.expense_total > 0 ? egp(row.expense_total) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-left text-emerald-700 font-medium hidden md:table-cell">
                      {row.revenue_total > 0 ? egp(row.revenue_total) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-left font-bold">
                      {row.net_cost > 0
                        ? <span className="text-red-700">{egp(row.net_cost)}</span>
                        : row.net_cost < 0
                        ? <span className="text-emerald-700">{egp(Math.abs(row.net_cost))}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-left text-slate-500 text-xs hidden md:table-cell">
                      {row.entry_count}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs">
                      {pct(row.expense_total, grandExp)}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell w-40">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-400 rounded-full transition-all"
                          style={{ width: maxExpense ? `${(row.expense_total / maxExpense) * 100}%` : '0%' }}
                        />
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail */}
                  {expandedRow === row.center_code && (
                    <tr key={`detail-${row.center_code}`}>
                      <td colSpan={8} className="bg-slate-50 border-b border-slate-200 p-0">
                        <div className="px-6 py-4">
                          {/* Detail tabs */}
                          <div className="flex gap-2 mb-4">
                            {(['summary', 'timeline', 'lines'] as const).map(t => (
                              <button
                                key={t}
                                onClick={e => { e.stopPropagation(); setDetailTab(t) }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                  detailTab === t ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                {t === 'summary'  && <><BookOpen size={12} /> الحسابات</>}
                                {t === 'timeline' && <><TrendingDown size={12} /> الشهري</>}
                                {t === 'lines'    && <><GitBranch size={12} /> قيود GL</>}
                              </button>
                            ))}
                          </div>

                          {detailLoading ? (
                            <p className="text-slate-400 text-sm">جارٍ التحميل…</p>
                          ) : !detail ? (
                            <p className="text-slate-400 text-sm">لا توجد بيانات</p>
                          ) : (
                            <>
                              {/* Summary tab: by account */}
                              {detailTab === 'summary' && (
                                <div className="space-y-1">
                                  {detail.summary.length === 0
                                    ? <p className="text-slate-400 text-sm">لا توجد قيود لهذا المركز</p>
                                    : detail.summary.map(s => (
                                      <div key={s.account_code} className="flex items-center justify-between py-1.5 border-b border-slate-100 text-sm">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono text-[10px] text-slate-400">{s.account_code}</span>
                                          <span className="text-slate-700">{s.account_name}</span>
                                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                            {ACCT_TYPE_AR[s.account_type] ?? s.account_type}
                                          </span>
                                        </div>
                                        <div className="flex gap-4 text-right">
                                          {s.total_debit  > 0 && <span className="text-blue-700">م: {egp(s.total_debit)}</span>}
                                          {s.total_credit > 0 && <span className="text-amber-700">د: {egp(s.total_credit)}</span>}
                                          <span className="text-xs text-slate-400">{s.line_count} سطر</span>
                                        </div>
                                      </div>
                                    ))
                                  }
                                  <div className="mt-3 flex justify-between text-sm font-bold pt-2 border-t border-slate-300">
                                    <span className="text-slate-700">الإجمالي</span>
                                    <div className="flex gap-6">
                                      <span className="text-red-700">مصروفات: {egp(detail.totals.expense)}</span>
                                      {detail.totals.revenue > 0 && <span className="text-emerald-700">إيرادات: {egp(detail.totals.revenue)}</span>}
                                      <span className={detail.totals.net_cost >= 0 ? 'text-red-700' : 'text-emerald-700'}>
                                        صافي: {egp(Math.abs(detail.totals.net_cost))}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Timeline tab */}
                              {detailTab === 'timeline' && (
                                <div className="flex gap-3 flex-wrap">
                                  {detailTimeline.length === 0
                                    ? <p className="text-slate-400 text-sm">لا توجد بيانات شهرية</p>
                                    : detailTimeline.map(t => (
                                      <div key={`${t.year}-${t.month}`} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-center min-w-[90px]">
                                        <p className="text-xs text-slate-500">{MONTH_NAMES[Number(t.month)]} {t.year}</p>
                                        {t.expense_total > 0 && <p className="text-xs font-semibold text-red-700 mt-0.5">{egp(t.expense_total)}</p>}
                                        {t.revenue_total > 0 && <p className="text-xs text-emerald-700">{egp(t.revenue_total)}</p>}
                                        <p className="text-[10px] text-slate-400 mt-0.5">{t.entry_count} قيد</p>
                                      </div>
                                    ))
                                  }
                                </div>
                              )}

                              {/* GL Lines tab */}
                              {detailTab === 'lines' && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-slate-100 text-slate-600">
                                        <th className="px-2 py-2 text-right">التاريخ</th>
                                        <th className="px-2 py-2 text-right">الحساب</th>
                                        <th className="px-2 py-2 text-right">الوصف</th>
                                        <th className="px-2 py-2 text-left">مدين</th>
                                        <th className="px-2 py-2 text-left">دائن</th>
                                        <th className="px-2 py-2 text-right hidden md:table-cell">rule_slot</th>
                                        <th className="px-2 py-2 text-right hidden md:table-cell">المصدر</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detailLines.length === 0
                                        ? <tr><td colSpan={7} className="py-6 text-center text-slate-400">لا توجد سطور</td></tr>
                                        : detailLines.map(l => (
                                          <tr key={l.id} className="border-b border-slate-100 hover:bg-white">
                                            <td className="px-2 py-1.5 text-slate-500">{l.entry_date}</td>
                                            <td className="px-2 py-1.5">
                                              <span className="font-mono text-blue-700">{l.account_code}</span>
                                              <span className="text-slate-600 ml-1">{l.account_name}</span>
                                            </td>
                                            <td className="px-2 py-1.5 text-slate-500 max-w-[200px] truncate">
                                              {l.line_description ?? l.entry_description ?? '—'}
                                            </td>
                                            <td className="px-2 py-1.5 text-left text-blue-700">
                                              {l.debit > 0 ? egp(l.debit) : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-2 py-1.5 text-left text-amber-700">
                                              {l.credit > 0 ? egp(l.credit) : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-2 py-1.5 hidden md:table-cell">
                                              {l.rule_slot
                                                ? <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-mono">{l.rule_slot}</span>
                                                : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-2 py-1.5 text-slate-400 hidden md:table-cell">
                                              {l.source_module ?? l.ref_type ?? '—'}
                                            </td>
                                          </tr>
                                        ))
                                      }
                                    </tbody>
                                  </table>
                                  {detailPagination.has_more && (
                                    <p className="text-xs text-slate-400 text-center py-2">
                                      عرض {detailLines.length} من {detailPagination.total} سطر
                                    </p>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              {/* Grand total */}
              {rows.length > 0 && (
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-slate-700">الإجمالي الكلي</td>
                  <td className="px-4 py-3 text-left text-red-700">{egp(summary?.grand_expense)}</td>
                  <td className="px-4 py-3 text-left text-emerald-700 hidden md:table-cell">{egp(summary?.grand_revenue)}</td>
                  <td className="px-4 py-3 text-left text-slate-900 text-base">{egp(summary?.grand_net_cost)}</td>
                  <td className="px-4 py-3 hidden md:table-cell"></td>
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
