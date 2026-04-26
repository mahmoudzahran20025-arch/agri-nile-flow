import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Lock, CheckCircle2, AlertTriangle, XCircle,
  Loader2, ChevronDown, Leaf, ClipboardCheck,
} from 'lucide-react'
import { configApi } from '../../api/client'

interface Season { id: number; name: string; status: string; start_date: string; end_date: string }
interface Check {
  key: string; label: string
  count: number; amount: number | null; blocker: boolean; ok: boolean
}
interface CloseCheckResult {
  season: { id: number; name: string; status: string }
  checks: Check[]
  can_close: boolean
}

function egp(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0 }).format(n)
}

export default function SeasonClosePage() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [done, setDone] = useState(false)

  const { data: seasons = [] } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
    select:   (d) => (d as Season[]).filter(s => s.status !== 'closed'),
  })

  const { data: checkData, isLoading: checkLoading, refetch: runCheck } = useQuery({
    queryKey: ['season-close-check', selectedId],
    queryFn:  () => configApi.seasonCloseCheck(selectedId as number),
    enabled:  !!selectedId,
    select:   (d) => d as CloseCheckResult,
    staleTime: 0,
  })

  const closeMut = useMutation({
    mutationFn: () => configApi.closeSeason(selectedId as number, notes || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seasons'] })
      qc.invalidateQueries({ queryKey: ['season-close-check'] })
      setDone(true)
    },
  })

  const issues   = checkData?.checks.filter(c => !c.ok) ?? []
  const blockers = checkData?.checks.filter(c => !c.ok && c.blocker) ?? []
  const canClose = !!checkData?.can_close && blockers.length === 0 && confirmed

  if (done) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center py-20" dir="rtl">
        <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-5">
          <Lock size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">تم إغلاق الموسم بنجاح</h2>
        <p className="text-gray-500 text-sm mb-6">
          الموسم <span className="font-semibold text-gray-800">{checkData?.season.name}</span> مغلق الآن.
          لا يمكن إضافة معاملات جديدة لهذا الموسم.
        </p>
        <div className="mb-6 text-right bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">⚠️ تذكير — الفترات المالية منفصلة</p>
          <p>إغلاق الموسم الزراعي لا يُغلق الفترة المالية المحاسبية تلقائياً. لإغلاق الفترة المالية توجَّه إلى <strong>دفتر الأستاذ ← الفترات المالية</strong>.</p>
        </div>
        <button
          onClick={() => { setDone(false); setSelectedId(''); setNotes(''); setConfirmed(false) }}
          className="text-sm text-indigo-600 hover:text-indigo-700 underline"
        >
          إغلاق موسم آخر
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center shadow-sm">
          <Lock size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">إغلاق الموسم الزراعي</h1>
          <p className="text-sm text-gray-500 mt-0.5">مراجعة وتأكيد إغلاق الموسم بشكل رسمي</p>
        </div>
      </div>

      {/* Step 1: Choose season */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">1</span>
          <h2 className="font-semibold text-gray-800">اختر الموسم</h2>
        </div>
        {seasons.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">لا توجد مواسم نشطة للإغلاق</p>
        ) : (
          <div className="relative">
            <select
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 appearance-none"
              value={selectedId}
              onChange={e => {
                setSelectedId(e.target.value ? Number(e.target.value) : '')
                setConfirmed(false)
                setNotes('')
              }}
            >
              <option value="">— اختر موسماً —</option>
              {seasons.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status}) — {s.start_date} : {s.end_date}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {/* Step 2: Pre-close checklist */}
      {selectedId && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">2</span>
              <h2 className="font-semibold text-gray-800">فحص ما قبل الإغلاق</h2>
            </div>
            <button
              onClick={() => runCheck()}
              className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              <ClipboardCheck size={13} /> إعادة الفحص
            </button>
          </div>

          {checkLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-gray-400" size={24} /></div>
          ) : checkData ? (
            <div className="space-y-2">
              {checkData.checks.map(check => (
                <div
                  key={check.key}
                  className={`flex items-center gap-3 p-3 rounded-xl border ${
                    check.ok
                      ? 'bg-emerald-50 border-emerald-200'
                      : check.blocker
                      ? 'bg-red-50 border-red-200'
                      : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  {check.ok ? (
                    <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                  ) : check.blocker ? (
                    <XCircle size={18} className="text-red-600 shrink-0" />
                  ) : (
                    <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${
                      check.ok ? 'text-emerald-800' : check.blocker ? 'text-red-800' : 'text-amber-800'
                    }`}>
                      {check.label}
                    </p>
                    {!check.ok && (
                      <p className={`text-xs mt-0.5 ${check.blocker ? 'text-red-600' : 'text-amber-600'}`}>
                        {check.count} {check.count === 1 ? 'بند' : 'بنود'}
                        {check.amount != null && check.amount > 0 && ` · ${egp(check.amount)} ج.م`}
                        {check.blocker && ' — يجب المعالجة قبل الإغلاق'}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                    check.ok ? 'bg-emerald-100 text-emerald-700' : check.blocker ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {check.ok ? '✓ جاهز' : check.blocker ? '✗ مانع' : '⚠ تحذير'}
                  </span>
                </div>
              ))}

              {/* Summary */}
              <div className={`mt-3 p-3 rounded-xl text-sm font-medium text-center ${
                blockers.length > 0
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : issues.length > 0
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}>
                {blockers.length > 0
                  ? `يوجد ${blockers.length} بند يمنع الإغلاق — يرجى المعالجة أولاً`
                  : issues.length > 0
                  ? `يمكن الإغلاق مع ${issues.length} تحذير (غير مانع)`
                  : 'جميع الفحوصات ناجحة — جاهز للإغلاق'}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Step 3: Confirm & close */}
      {checkData && blockers.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">3</span>
            <h2 className="font-semibold text-gray-800">تأكيد الإغلاق</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات الإغلاق</label>
              <textarea
                rows={3}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder="مثال: اكتملت جميع عمليات الموسم، تم مراجعة الحسابات بتاريخ ..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-amber-600"
              />
              <span className="text-sm text-amber-800">
                أؤكد أن موسم <strong>{checkData.season.name}</strong> قد اكتمل وأنني أوافق على إغلاقه رسمياً.
                لا يمكن التراجع عن هذا الإجراء.
              </span>
            </label>

            <button
              onClick={() => closeMut.mutate()}
              disabled={!canClose || closeMut.isPending}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-bold transition-colors"
            >
              {closeMut.isPending
                ? <><Loader2 size={16} className="animate-spin" /> جارٍ الإغلاق...</>
                : <><Lock size={16} /> إغلاق الموسم رسمياً</>
              }
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!selectedId && (
        <div className="text-center py-12 text-gray-400">
          <Leaf size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">اختر موسماً من القائمة أعلاه للبدء</p>
        </div>
      )}
    </div>
  )
}
