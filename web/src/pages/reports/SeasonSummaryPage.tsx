import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Leaf, TrendingDown, Download,
  ChevronDown, ChevronRight, MapPin, BarChart3, Info,
  BookOpen, Sprout,
} from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'
import type { Season } from '../../types'
import { useAppStore } from '../../store/appStore'

function egp(n: number | null | undefined) {
  if (n == null) return '0 ج.م'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
  }).format(n)
}

function pct(part: number, total: number) {
  if (!total || !part) return '0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

const MONTH_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

const ACCOUNT_TYPE_AR: Record<string, string> = {
  asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية',
  revenue: 'إيرادات', expense: 'مصروفات',
}

type TabId = 'overview' | 'cost_centers' | 'by_account' | 'by_field'

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

  const plSummary   = data?.pl_summary
  const costCenters = data?.by_cost_center ?? []
  const byAccount   = data?.by_account     ?? []
  const byField     = data?.by_field       ?? []
  const timeline    = data?.timeline       ?? []
  const season      = data?.season
  const totalExpense = plSummary?.total_expense ?? 0
  const totalRevenue = plSummary?.total_revenue ?? 0

  function downloadCsv(tabId: TabId) {
    const BOM = '﻿'
    let rows: (string | number)[][] = []
    let filename = ''

    if (tabId === 'cost_centers') {
      rows = [['مركز التكلفة', 'مصروفات', 'إيرادات', 'عدد القيود'],
              ...costCenters.map(r => [r.center_name || 'غير محدد', r.expense_total, r.revenue_total, r.entry_count])]
      filename = 'مراكز_التكلفة'
    } else if (tabId === 'by_account') {
      rows = [['كود الحساب', 'اسم الحساب', 'النوع', 'مدين', 'دائن', 'صافي'],
              ...byAccount.map(r => [r.account_code, r.account_name, r.account_type, r.total_debit, r.total_credit, r.net_debit])]
      filename = 'الحسابات'
    } else if (tabId === 'by_field') {
      rows = [['الحقل', 'المساحة (هكتار)', 'مصروفات', 'إيرادات'],
              ...byField.map(r => [r.field_name, r.area_ha ?? '', r.expense_total, r.revenue_total])]
      filename = 'الحقول'
    } else {
      rows = [['البند', 'المبلغ'],
              ['إجمالي الإيرادات', totalRevenue],
              ['إجمالي المصروفات', totalExpense],
              ['صافي الدخل', plSummary?.net_income ?? 0]]
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
    { id: 'overview',     label: 'نظرة عامة',        icon: <BarChart3  size={18} /> },
    { id: 'cost_centers', label: 'مراكز التكلفة',   icon: <MapPin     size={18} /> },
    { id: 'by_account',   label: 'بنود الحسابات',   icon: <BookOpen   size={18} /> },
    { id: 'by_field',     label: 'تحليل الحقول',    icon: <Sprout     size={18} /> },
  ]

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      {/* Header */}
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

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[
          { label: 'إجمالي الإيرادات', value: totalRevenue,                    color: 'emerald', icon: <TrendingDown size={24} /> },
          { label: 'إجمالي المصروفات', value: totalExpense,                    color: 'red',     icon: <TrendingDown size={24} className="rotate-180" /> },
          { label: 'صافي الدخل',       value: plSummary?.net_income ?? 0,      color: (plSummary?.net_income ?? 0) >= 0 ? 'blue' : 'amber', icon: <BarChart3 size={24} /> },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="card group p-6 overflow-hidden relative">
            <div className={`absolute top-0 right-0 w-1.5 h-full bg-${color}-500 transition-all group-hover:w-2`} />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-slate-500 mb-1">{label}</p>
                <h3 className={`text-2xl font-black text-${color}-600 tracking-tight`}>
                  {isLoading ? <div className="h-8 w-24 bg-slate-100 animate-pulse rounded" /> : egp(value)}
                </h3>
              </div>
              <div className={`p-3 bg-${color}-50 text-${color}-600 rounded-2xl`}>{icon}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
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

      {/* Content */}
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

        {/* Overview */}
        {!isLoading && tab === 'overview' && (
          <div className="card p-6">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 mb-6">
              <TrendingDown className="text-brand-500" />
              حركة الإيرادات والمصروفات الشهرية
            </h3>
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 rounded-xl">
                  <th className="th py-4">الشهر</th>
                  <th className="th py-4 text-left text-emerald-600">إيرادات</th>
                  <th className="th py-4 text-left text-red-600">مصروفات</th>
                  <th className="th py-4 text-left">عدد القيود</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {timeline.length > 0 ? timeline.map(row => (
                  <tr key={`${row.year}-${row.month}`} className="hover:bg-slate-50 transition-colors">
                    <td className="td py-4 font-bold text-slate-700">
                      {MONTH_AR[(Number(row.month) ?? 1) - 1]} {row.year}
                    </td>
                    <td className="td py-4 text-left text-emerald-600 font-medium">{row.revenue_total > 0 ? egp(row.revenue_total) : '—'}</td>
                    <td className="td py-4 text-left text-red-600 font-medium">{row.expense_total > 0 ? egp(row.expense_total) : '—'}</td>
                    <td className="td py-4 text-left text-slate-500 text-sm">{row.entry_count}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="td py-10 text-center text-slate-400">لا توجد حركات مسجلة لهذا الموسم</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Cost Centers */}
        {!isLoading && tab === 'cost_centers' && (
          <div className="card overflow-hidden border-none shadow-xl">
            <table className="w-full">
              <thead className="bg-slate-50/80 backdrop-blur-sm">
                <tr>
                  <th className="th py-5">مركز التكلفة / الحقل</th>
                  <th className="th py-5 text-left text-red-600">المصروفات</th>
                  <th className="th py-5 text-left text-emerald-600">الإيرادات</th>
                  <th className="th py-5 text-left">عدد القيود</th>
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
                      <td className="td py-5 text-left text-red-600 font-bold">{r.expense_total > 0 ? egp(r.expense_total) : '—'}</td>
                      <td className="td py-5 text-left text-emerald-600 font-bold">{r.revenue_total > 0 ? egp(r.revenue_total) : '—'}</td>
                      <td className="td py-5 text-left text-slate-500 text-sm">{r.entry_count}</td>
                      <td className="td py-5">
                        <div className="flex items-center justify-center gap-3">
                          <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                            <div className="h-full bg-brand-500 rounded-full" style={{ width: pct(r.expense_total, totalExpense) }} />
                          </div>
                          <span className="text-[11px] font-black text-brand-600 w-10">{pct(r.expense_total, totalExpense)}</span>
                        </div>
                      </td>
                      <td className="td py-5 text-slate-400">
                        {expandedCenter === r.center_code ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                      </td>
                    </tr>
                    {expandedCenter === r.center_code && (
                      <tr className="bg-white/50">
                        <td colSpan={6} className="p-0 overflow-hidden">
                          <div className="p-8 border-x-4 border-brand-500 bg-brand-50/20 animate-fade-in">
                            <div className="flex justify-end">
                              <button
                                onClick={(e) => { e.stopPropagation(); navigate(`/reports/cost-centers?center=${r.center_code}&season_id=${seasonId}`) }}
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
                  <tr><td colSpan={6} className="td py-20 text-center text-slate-400">لا توجد بيانات مراكز تكلفة متاحة</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* By Account */}
        {!isLoading && tab === 'by_account' && (
          <div className="card overflow-hidden shadow-xl border-none">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th py-5">كود الحساب</th>
                  <th className="th py-5">اسم الحساب</th>
                  <th className="th py-5 text-center">النوع</th>
                  <th className="th py-5 text-left text-blue-600">مدين</th>
                  <th className="th py-5 text-left text-amber-600">دائن</th>
                  <th className="th py-5 text-left">عدد القيود</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byAccount.length > 0 ? byAccount.map(r => (
                  <tr key={r.account_code} className="hover:bg-slate-50 transition-colors">
                    <td className="td py-4 font-mono text-brand-700 text-xs">{r.account_code}</td>
                    <td className="td py-4 font-bold text-slate-800">{r.account_name}</td>
                    <td className="td py-4 text-center">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        {ACCOUNT_TYPE_AR[r.account_type] ?? r.account_type}
                      </span>
                    </td>
                    <td className="td py-4 text-left text-blue-700 font-medium">{r.total_debit > 0 ? egp(r.total_debit) : '—'}</td>
                    <td className="td py-4 text-left text-amber-700 font-medium">{r.total_credit > 0 ? egp(r.total_credit) : '—'}</td>
                    <td className="td py-4 text-left text-slate-500 text-sm">{r.entry_count}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="td py-20 text-center text-slate-400">لا توجد حسابات مسجلة لهذا الموسم</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* By Field */}
        {!isLoading && tab === 'by_field' && (
          <div className="card overflow-hidden shadow-xl border-none">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th py-5">اسم الحقل</th>
                  <th className="th py-5 text-center">المساحة (هكتار)</th>
                  <th className="th py-5 text-left text-red-600">المصروفات</th>
                  <th className="th py-5 text-left text-emerald-600">الإيرادات</th>
                  <th className="th py-5 text-left">صافي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byField.length > 0 ? byField.map(r => {
                  const net = r.revenue_total - r.expense_total
                  return (
                    <tr key={r.field_id} className="hover:bg-slate-50 transition-colors">
                      <td className="td py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center text-green-600 border border-green-100">
                            <Sprout size={18} />
                          </div>
                          <span className="font-black text-slate-800">{r.field_name}</span>
                        </div>
                      </td>
                      <td className="td py-5 text-center text-slate-500">{r.area_ha != null ? `${r.area_ha} هـ` : '—'}</td>
                      <td className="td py-5 text-left text-red-700 font-bold">{r.expense_total > 0 ? egp(r.expense_total) : '—'}</td>
                      <td className="td py-5 text-left text-emerald-700 font-bold">{r.revenue_total > 0 ? egp(r.revenue_total) : '—'}</td>
                      <td className="td py-5 text-left">
                        <span className={`px-3 py-1 rounded-lg font-black text-sm ${net >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {egp(net)}
                        </span>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={5} className="td py-20 text-center text-slate-400">لا توجد بيانات حقول لهذا الموسم</td></tr>
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
