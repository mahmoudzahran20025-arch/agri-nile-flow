import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2,
  XCircle, RefreshCw, ExternalLink, Loader2,
} from 'lucide-react'
import { glApi } from '../../api/client'
import type { IntegrityCheck } from '../../api/client'

const MODULE_LABELS: Record<string, string> = {
  unbalanced_entries:  'محاسبة',
  negative_stock:      'مخازن',
  draft_transactions:  'خزينة',
  stale_work_orders:   'عمليات',
  gl_mappings:         'إعدادات GL',
  old_purchase_orders: 'مشتريات',
  harvest_gl_mappings: 'حصاد',
}

function CheckRow({ check, onNavigate }: { check: IntegrityCheck; onNavigate: (url: string) => void }) {
  const isOk = check.ok

  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
      isOk
        ? 'bg-emerald-50/60 border-emerald-200'
        : check.blocker
        ? 'bg-red-50 border-red-200'
        : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="mt-0.5 shrink-0">
        {isOk
          ? <CheckCircle2 size={20} className="text-emerald-600" />
          : check.blocker
          ? <XCircle      size={20} className="text-red-500" />
          : <AlertTriangle size={20} className="text-amber-500" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-semibold ${isOk ? 'text-emerald-800' : check.blocker ? 'text-red-800' : 'text-amber-800'}`}>
            {check.label}
          </p>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
            isOk
              ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
              : 'bg-white text-gray-600 border-gray-200'
          }`}>
            {MODULE_LABELS[check.key] ?? check.key}
          </span>
          {!isOk && check.blocker && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
              حاجب
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{check.description}</p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {!isOk && (
          <span className={`text-sm font-bold tabular-nums ${check.blocker ? 'text-red-600' : 'text-amber-600'}`}>
            {check.count}
          </span>
        )}
        {!isOk && (
          <button
            onClick={() => onNavigate(check.action_url)}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
              check.blocker
                ? 'border-red-300 text-red-700 hover:bg-red-100'
                : 'border-amber-300 text-amber-700 hover:bg-amber-100'
            }`}
          >
            <ExternalLink size={11} /> معالجة
          </button>
        )}
      </div>
    </div>
  )
}

export default function IntegrityPage() {
  const navigate = useNavigate()

  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['gl-integrity'],
    queryFn:  () => glApi.integrityCheck(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const checks = (data?.checks ?? []) as IntegrityCheck[]
  const result  = data ? { ...data, checks } : null
  const lastChecked = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('ar-EG')
    : null

  const scoreColor = !result
    ? 'text-gray-400'
    : result.score >= 80
    ? 'text-emerald-700'
    : result.score >= 50
    ? 'text-amber-700'
    : 'text-red-600'

  const scoreBg = !result
    ? 'bg-gray-100'
    : result.score >= 80
    ? 'bg-emerald-100'
    : result.score >= 50
    ? 'bg-amber-100'
    : 'bg-red-100'

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-sm ${
            !result ? 'bg-slate-200' : result.overall_ok ? 'bg-emerald-600' : result.has_blockers ? 'bg-red-600' : 'bg-amber-500'
          }`}>
            {!result || result.overall_ok
              ? <ShieldCheck size={22} className="text-white" />
              : <ShieldAlert size={22} className="text-white" />
            }
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">سلامة البيانات</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {lastChecked ? `آخر فحص: ${lastChecked}` : 'فحص تلقائي لجودة البيانات المحاسبية والتشغيلية'}
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          إعادة الفحص
        </button>
      </div>

      {/* Score card */}
      {result && (
        <div className={`rounded-2xl border p-5 flex items-center gap-6 ${
          result.overall_ok ? 'bg-emerald-50 border-emerald-200' : result.has_blockers ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
        }`}>
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center shrink-0 ${scoreBg}`}>
            <span className={`text-3xl font-black ${scoreColor}`}>{result.score}%</span>
          </div>
          <div>
            <p className={`text-lg font-bold ${scoreColor}`}>
              {result.overall_ok
                ? 'جميع الفحوصات ناجحة — النظام في حالة سليمة'
                : result.has_blockers
                ? 'توجد مشكلات حاجبة تحتاج معالجة فورية'
                : 'توجد تحذيرات تحتاج مراجعة'
              }
            </p>
            <p className="text-sm text-gray-600 mt-1">
              {result.checks.filter(ch => ch.ok).length} من {result.checks.length} فحوصات ناجحة
              {!result.overall_ok && ` · ${result.checks.filter(ch => !ch.ok && ch.blocker).length} حاجبة`}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {result.checks.length < 7 ? `⚠️ يتوقع النظام 7 فحوصات، استُرجع ${result.checks.length}` : `✅ جميع الـ ${result.checks.length} فحوصات محمّلة`}
            </p>
          </div>
        </div>
      )}

      {/* Check list */}
      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-400">
          <Loader2 size={32} className="animate-spin" />
        </div>
      ) : result ? (
        <div className="space-y-3">
          {/* Blockers first */}
          {result.checks.filter(ch => !ch.ok && ch.blocker).length > 0 && (
            <div>
              <p className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2">مشكلات حاجبة</p>
              <div className="space-y-2">
                {result.checks.filter(ch => !ch.ok && ch.blocker).map(ch => (
                  <CheckRow key={ch.key} check={ch} onNavigate={navigate} />
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {result.checks.filter(ch => !ch.ok && !ch.blocker).length > 0 && (
            <div>
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2 mt-4">تحذيرات</p>
              <div className="space-y-2">
                {result.checks.filter(ch => !ch.ok && !ch.blocker).map(ch => (
                  <CheckRow key={ch.key} check={ch} onNavigate={navigate} />
                ))}
              </div>
            </div>
          )}

          {/* Passing */}
          {result.checks.filter(ch => ch.ok).length > 0 && (
            <div>
              <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-2 mt-4">فحوصات ناجحة</p>
              <div className="space-y-2">
                {result.checks.filter(ch => ch.ok).map(ch => (
                  <CheckRow key={ch.key} check={ch} onNavigate={navigate} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <ShieldAlert size={36} className="mx-auto mb-3 opacity-30" />
          <p>تعذر تحميل نتائج الفحص</p>
          <button onClick={() => refetch()} className="mt-3 text-sm text-brand-600 underline">
            إعادة المحاولة
          </button>
        </div>
      )}
    </div>
  )
}
