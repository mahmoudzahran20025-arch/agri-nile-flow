import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { glApi } from '../../api/client'
import {
  Layers, Play, CheckCircle, AlertTriangle, RefreshCw,
  TrendingDown, BarChart3, Clock,
} from 'lucide-react'
import { TableSkeleton } from '../../components/ui/Skeleton'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

const CATEGORY_LABELS: Record<string, string> = {
  equipment:        'معدات',
  vehicle:          'مركبات',
  irrigation:       'ري',
  building:         'مباني',
  land_improvement: 'تحسينات أراضي',
  other:            'أخرى',
}

const currentYear  = new Date().getFullYear()
const currentMonth = new Date().getMonth() + 1

type DepAsset = {
  id: number; asset_code: string; name: string; category: string
  acquisition_date: string; cost: number; salvage_value: number
  useful_life_months: number; center_name: string | null; field_name: string | null
  monthly_amount: number; posted_months: number; remaining_months: number
  accumulated: number; book_value: number; pct_complete: number; fully_depreciated: boolean
}

function ProgressBar({ pct }: { pct: number }) {
  const clr = pct >= 100 ? 'bg-slate-400' : pct >= 75 ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${clr}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

export default function DepreciationPage() {
  const qc = useQueryClient()
  const [year,  setYear]  = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)
  const [runResult, setRunResult] = useState<{
    posted: number; skipped: number; total_charge: number; period_year: number; period_month: number
  } | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['depreciation-schedule'],
    queryFn:  glApi.depreciationSchedule,
  })

  const assets  = data?.assets  ?? []
  const summary = data?.summary

  const runMut = useMutation({
    mutationFn: () => glApi.runDepreciation(year, month),
    onSuccess: (res) => {
      setRunResult({ posted: res.posted, skipped: res.skipped, total_charge: res.total_charge, period_year: res.period_year, period_month: res.period_month })
      setRunError(null)
      qc.invalidateQueries({ queryKey: ['depreciation-schedule'] })
    },
    onError: (err: Error) => {
      setRunError(err.message.replace(/^Error:\s*/i, ''))
      setRunResult(null)
    },
  })

  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

  return (
    <div className="p-6 space-y-6" dir="rtl">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <TrendingDown size={20} className="text-slate-600" />
            <h1 className="text-xl font-bold text-slate-800">الإهلاك الشهري</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            ترحيل قيود إهلاك الأصول الثابتة بصورة شهرية — العملية آمنة للتكرار
          </p>
        </div>

        {/* Summary KPIs */}
        {summary && (
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-slate-800">{summary.active_assets}</div>
              <div className="text-xs text-slate-500">أصل نشط</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-700">{EGP(summary.total_monthly_charge)}</div>
              <div className="text-xs text-slate-500">إجمالي الإهلاك الشهري</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-600">{summary.fully_depreciated}</div>
              <div className="text-xs text-slate-500">مستهلك بالكامل</div>
            </div>
          </div>
        )}
      </div>

      {/* Run depreciation panel */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Play size={15} className="text-[#0F2D5C]" />
          <h2 className="text-sm font-semibold text-slate-800">تشغيل دورة الإهلاك</h2>
        </div>
        <p className="text-xs text-slate-500">
          اختر الشهر والسنة ثم اضغط «تشغيل». يتجاهل النظام الأصول التي رُحِّلت بالفعل لنفس الفترة.
        </p>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-slate-500 font-medium">السنة</label>
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
            >
              {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500 font-medium">الشهر</label>
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-[#1a3d6b] transition-colors"
          >
            {runMut.isPending
              ? <><RefreshCw size={13} className="animate-spin" /> جارٍ الترحيل…</>
              : <><Play size={13} /> تشغيل الإهلاك</>
            }
          </button>
        </div>

        {runResult && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <CheckCircle size={15} className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800">
              <p className="font-semibold">
                تم ترحيل إهلاك {MONTHS[runResult.period_month - 1]} {runResult.period_year} بنجاح
              </p>
              <p className="text-xs mt-1 text-emerald-700">
                {runResult.posted} أصل مُرحَّل · {runResult.skipped} محذوف مسبقاً ·
                إجمالي القيد {EGP(runResult.total_charge)}
              </p>
            </div>
          </div>
        )}

        {runError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">
              <p className="font-semibold">فشل الترحيل</p>
              <p className="text-xs mt-0.5">{runError}</p>
            </div>
          </div>
        )}
      </div>

      {/* Asset schedule table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <BarChart3 size={15} className="text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">جدول الأصول الثابتة</span>
        </div>

        {isLoading && <div className="p-5"><TableSkeleton rows={5} cols={7} /></div>}

        {isError && (
          <div className="flex items-center gap-2 m-5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertTriangle size={15} />
            تعذّر تحميل جدول الأصول
          </div>
        )}

        {!isLoading && !isError && assets.length === 0 && (
          <div className="px-6 py-12 text-center">
            <Layers className="mx-auto w-10 h-10 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">لا توجد أصول ثابتة نشطة</p>
            <p className="text-xs text-slate-400 mt-1">أضف أصولاً ثابتة لبدء جدولة الإهلاك</p>
          </div>
        )}

        {assets.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  {['الكود', 'الاسم', 'الفئة', 'مركز التكلفة', 'التكلفة', 'الإهلاك/شهر', 'مُرحَّل', 'متبقي', 'القيمة الدفترية', 'نسبة الاكتمال'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(assets as DepAsset[]).map(a => (
                  <tr key={a.id} className={`hover:bg-slate-50 ${a.fully_depreciated ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.asset_code}</td>
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[180px] truncate" title={a.name}>{a.name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{CATEGORY_LABELS[a.category] ?? a.category}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{a.center_name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{EGP(a.cost)}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">
                      {a.fully_depreciated
                        ? <span className="text-slate-400">مكتمل</span>
                        : EGP(a.monthly_amount)
                      }
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {a.posted_months}/{a.useful_life_months}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{a.remaining_months}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{EGP(a.book_value)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar pct={a.pct_complete} />
                        <span className="text-xs text-slate-500 whitespace-nowrap">{a.pct_complete}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50">
                <tr className="font-semibold text-slate-700 text-sm">
                  <td colSpan={5} className="px-4 py-3">الإجمالي ({assets.length} أصل)</td>
                  <td className="px-4 py-3 font-mono">{EGP(summary?.total_monthly_charge ?? 0)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
