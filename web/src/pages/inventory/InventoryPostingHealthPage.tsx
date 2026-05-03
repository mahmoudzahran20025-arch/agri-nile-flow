/**
 * InventoryPostingHealthPage — Visual matrix of warehouse×PPG posting coverage
 * + GL Traceability view (ghost-posted, pending, failed movements).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { ShieldCheck, AlertTriangle, CheckCircle, Package, ExternalLink, Link2Off, Tag, Activity, RefreshCw, Ban } from 'lucide-react'
import { inventoryApi } from '../../api/inventory'

const EGP = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

type TraceFilter = 'all' | 'ghost_posted' | 'pending' | 'failed' | 'exempt'

const GL_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  posted:            { label: 'مرحّل',          cls: 'bg-green-100 text-green-700 border-green-200' },
  pending:           { label: 'قيد الانتظار',   cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  failed:            { label: 'فشل',             cls: 'bg-red-100 text-red-700 border-red-200' },
  exempt_zero_value: { label: 'معفى (صفر)',      cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  decoupled:         { label: 'منفصل',           cls: 'bg-purple-100 text-purple-700 border-purple-200' },
}

const FILTER_OPTS: { key: TraceFilter; label: string; color: string }[] = [
  { key: 'all',          label: 'الكل',              color: 'slate'  },
  { key: 'ghost_posted', label: 'مرحّل بدون قيد',    color: 'orange' },
  { key: 'pending',      label: 'قيد الانتظار',      color: 'blue'   },
  { key: 'failed',       label: 'فشل الترحيل',       color: 'red'    },
  { key: 'exempt',       label: 'معفى (صفر القيمة)', color: 'slate'  },
]

export default function InventoryPostingHealthPage() {
  const navigate = useNavigate()
  const [traceFilter, setTraceFilter] = useState<TraceFilter>('ghost_posted')

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'posting-health'],
    queryFn:  inventoryApi.postingHealth,
    staleTime: 60_000,
  })

  const qc = useQueryClient()
  const resolveMut = useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: 'exempt' | 'retry'; reason?: string }) =>
      inventoryApi.resolveGlTrace(id, action, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'gl-trace'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'health-summary'] })
    },
  })

  const { data: traceData, isLoading: traceLoading } = useQuery({
    queryKey: ['inventory', 'gl-trace', traceFilter],
    queryFn:  () => inventoryApi.glTrace({ status: traceFilter, limit: 200 }),
    staleTime: 30_000,
  })

  // Legacy unlinked movements breakdown (kept for backward compat)
  const { data: movData } = useQuery({
    queryKey: ['inventory', 'movements', { page: 1, size: 200 }],
    queryFn:  () => inventoryApi.list({ page: 1, size: 200 }),
    staleTime: 60_000,
  })
  const movRows = (movData as any)?.data ?? []
  const unlinkedZeroValue   = movRows.filter((r: any) => !r.journal_entry_id && (r.value_in + r.value_out) === 0)
  const unlinkedWithValue   = movRows.filter((r: any) => !r.journal_entry_id && (r.value_in + r.value_out) > 0)

  const health  = data?.data    ?? []
  const summary = data?.summary ?? { total_combos: 0, covered: 0, exact_setup: 0, missing_setup: 0, health_pct: 100 }

  const missing  = health.filter(h => !h.is_covered)

  return (
    <div className="space-y-5 pb-10">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ShieldCheck size={22} className="text-slate-400" />
            فحص صحة الترحيل المخزني
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            مصفوفة التغطية: كل تركيبة (مخزن × مجموعة ترحيل) لها حركات مخزنية
          </p>
        </div>
        <button
          className="btn-secondary gap-2"
          onClick={() => navigate('/gl/posting-setup')}
        >
          <ExternalLink size={15} /> إعداد الترحيل
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center text-brand-600">
            <Package size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">إجمالي التوليفات</p>
            <p className="text-xl font-bold">{summary.total_combos}</p>
          </div>
        </div>
        <div className={`card p-4 flex items-center gap-3 ${summary.health_pct < 100 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${summary.health_pct < 100 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
            {summary.health_pct < 100 ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
          </div>
          <div>
            <p className="text-xs text-slate-400">نسبة التغطية</p>
            <p className={`text-xl font-bold ${summary.health_pct < 100 ? 'text-amber-700' : 'text-green-700'}`}>
              {summary.health_pct}%
            </p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3 border-green-200 bg-green-50">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center text-green-600">
            <CheckCircle size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">تطابق تام</p>
            <p className="text-xl font-bold text-green-700">{summary.exact_setup}</p>
          </div>
        </div>
        <div className={`card p-4 flex items-center gap-3 ${summary.missing_setup > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${summary.missing_setup > 0 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-400'}`}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">توليفات بدون إعداد</p>
            <p className={`text-xl font-bold ${summary.missing_setup > 0 ? 'text-red-700' : 'text-slate-500'}`}>
              {summary.missing_setup}
            </p>
          </div>
        </div>
      </div>

      {/* GL Linkage panel */}
      {(unlinkedZeroValue.length > 0 || unlinkedWithValue.length > 0) && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <Link2Off size={16} className="text-slate-400" />
            <h3 className="font-semibold text-slate-700">حركات بدون قيد محاسبي</h3>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Zero-value — informational */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <Tag size={16} className="text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-amber-800 text-sm">
                    {unlinkedZeroValue.length} حركة بسعر صفر
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    القيمة المالية = 0 ← لا قيد مطلوب. يُنصح بمراجعة أسعار هذه الأصناف وتحديثها.
                  </p>
                  <Link
                    to="/inventory/movements?unlinked=1"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-700 hover:text-amber-900 underline"
                  >
                    عرض الحركات ←
                  </Link>
                </div>
              </div>
            </div>

            {/* With value — real gap */}
            {unlinkedWithValue.length > 0 ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-red-800 text-sm">
                      {unlinkedWithValue.length} حركة بقيمة بدون قيد — فجوة محاسبية
                    </p>
                    <p className="text-xs text-red-700 mt-1">
                      هذه الحركات لها قيمة مالية لكن لم يُنشأ لها قيد GL. يحتاج تدخلاً.
                    </p>
                    <Link
                      to="/inventory/movements"
                      className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-red-700 hover:text-red-900 underline"
                    >
                      عرض في حركات المخزون ←
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 flex items-center gap-3">
                <CheckCircle size={16} className="text-green-600 shrink-0" />
                <p className="text-sm text-green-700 font-medium">
                  كل الحركات ذات قيمة مالية مرتبطة بقيود GL ✓
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Missing combos alert */}
      {missing.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 mb-2">
                {missing.length} تركيبة بدون إعداد ترحيل — الحركات المستقبلية ستفشل
              </p>
              <div className="space-y-1">
                {missing.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-red-700">
                    <span className="font-mono bg-red-100 px-2 py-0.5 rounded text-xs">{m.warehouse}</span>
                    <span className="text-red-400">×</span>
                    <span className="font-mono bg-red-100 px-2 py-0.5 rounded text-xs">{m.ppg ?? 'NULL'}</span>
                    <span className="text-red-400">—</span>
                    <span className="text-xs">{m.movement_count} حركة · {EGP(m.total_value)}</span>
                    {m.gaps.map((g, gi) => (
                      <span key={gi} className="text-xs bg-red-200 px-1.5 py-0.5 rounded-full">{g}</span>
                    ))}
                  </div>
                ))}
              </div>
              <button
                className="mt-3 text-sm font-medium text-red-700 hover:text-red-900 underline"
                onClick={() => navigate('/gl/posting-setup?tab=inventory')}
              >
                انتقل لإعداد الترحيل المخزني ←
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GL Traceability Panel */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-slate-400" />
            <h3 className="font-semibold text-slate-700">تتبع الترحيل المحاسبي (GL Trace)</h3>
            {traceData && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                traceData.summary.traceability_pct >= 95 ? 'bg-green-100 text-green-700 border-green-200' :
                traceData.summary.traceability_pct >= 80 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                'bg-red-100 text-red-700 border-red-200'
              }`}>
                {traceData.summary.traceability_pct}% قابل للتتبع
              </span>
            )}
          </div>
          {/* Summary chips */}
          {traceData && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {traceData.summary.ghost_posted > 0 && (
                <span className="px-2 py-0.5 rounded-full border bg-orange-100 text-orange-700 border-orange-200 font-semibold">
                  {traceData.summary.ghost_posted} غير مرتبط
                </span>
              )}
              {traceData.summary.pending > 0 && (
                <span className="px-2 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200">
                  {traceData.summary.pending} قيد الانتظار
                </span>
              )}
              {traceData.summary.failed > 0 && (
                <span className="px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200 font-semibold">
                  {traceData.summary.failed} فشل
                </span>
              )}
              <span className="px-2 py-0.5 rounded-full border bg-green-100 text-green-700 border-green-200">
                {traceData.summary.clean_posted} مرحّل ✓
              </span>
            </div>
          )}
        </div>

        {/* Filter tabs */}
        <div className="px-4 pt-3 pb-0 flex gap-1.5 flex-wrap">
          {FILTER_OPTS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setTraceFilter(opt.key)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                traceFilter === opt.key
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {opt.label}
              {traceData && opt.key === 'ghost_posted' && traceData.summary.ghost_posted > 0 && (
                <span className="ml-1 bg-orange-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {traceData.summary.ghost_posted}
                </span>
              )}
              {traceData && opt.key === 'failed' && traceData.summary.failed > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {traceData.summary.failed}
                </span>
              )}
            </button>
          ))}
        </div>

        {traceLoading ? (
          <div className="p-10 text-center text-slate-400 animate-pulse">جاري تحميل بيانات الترحيل...</div>
        ) : !traceData || traceData.rows.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle size={24} className="text-green-400 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">لا توجد حركات في هذه الفئة ✓</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 border-t border-t-slate-100">
                <tr>
                  {['#', 'التاريخ', 'المخزن', 'النوع', 'الصنف', 'الكمية', 'القيمة', 'حالة GL', 'قيد محاسبي', 'الصندوق', 'إجراء'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {traceData.rows.map(row => {
                  const isGhost = row.gl_posting_status === 'posted' && !row.journal_entry_id
                  const statusMeta = GL_STATUS_LABELS[row.gl_posting_status] ?? { label: row.gl_posting_status, cls: 'bg-slate-100 text-slate-500 border-slate-200' }
                  const movValue = row.value_in > 0 ? row.value_in : row.value_out
                  return (
                    <tr key={row.id} className={`transition-colors ${isGhost ? 'bg-orange-50/50' : row.gl_posting_status === 'failed' ? 'bg-red-50/40' : 'hover:bg-slate-50'}`}>
                      <td className="px-3 py-2.5 text-xs text-slate-400 font-mono">{row.id}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{row.movement_date}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{row.warehouse}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{row.movement_type}</td>
                      <td className="px-3 py-2.5 text-xs">
                        <span className="text-slate-700">{row.item_name ?? `#${row.item_code}`}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 text-left ltr">{row.quantity.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold text-brand-700 text-left ltr">
                        {movValue > 0 ? EGP(movValue) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${statusMeta.cls}`}>
                          {isGhost && <AlertTriangle size={10} />}
                          {statusMeta.label}
                          {isGhost && <span className="text-[10px] opacity-70">بدون قيد</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {row.journal_entry_id ? (
                          <span className="font-mono text-green-700">{row.je_number ?? `#${row.journal_entry_id}`}</span>
                        ) : row.gl_posting_error ? (
                          <span className="text-red-500 truncate max-w-[160px] block" title={row.gl_posting_error}>
                            {row.gl_posting_error.slice(0, 40)}...
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {row.outbox_status ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${
                            row.outbox_status === 'pending' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                            row.outbox_status === 'processing' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                            'bg-slate-50 text-slate-400 border-slate-200'
                          }`}>
                            {row.outbox_status} {row.outbox_attempts != null ? `(${row.outbox_attempts}×)` : ''}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {(isGhost || row.gl_posting_status === 'failed' || row.gl_posting_status === 'pending') && (
                          <div className="flex gap-1">
                            {/* Exempt: only for zero-value movements */}
                            {(isGhost || row.gl_posting_status === 'pending') && (row.value_in + row.value_out) === 0 && (
                              <button
                                onClick={() => resolveMut.mutate({ id: row.id, action: 'exempt', reason: 'zero_value_manual_exempt' })}
                                disabled={resolveMut.isPending}
                                title="تعيين كمعفى (قيمة صفرية)"
                                className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded"
                              >
                                <Ban size={13} />
                              </button>
                            )}
                            {/* Retry: enqueue in outbox */}
                            {(isGhost || row.gl_posting_status === 'failed') && (
                              <button
                                onClick={() => resolveMut.mutate({ id: row.id, action: 'retry' })}
                                disabled={resolveMut.isPending}
                                title="إعادة المحاولة عبر الصندوق"
                                className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
                              >
                                <RefreshCw size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Full matrix table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">مصفوفة التغطية الكاملة</h3>
        </div>
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 animate-pulse">جاري التحميل...</div>
        ) : health.length === 0 ? (
          <div className="p-12 text-center text-slate-400">لا توجد حركات مخزنية بعد</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['المخزن', 'IPG', 'مجموعة PPG', 'عدد الحركات', 'إجمالي القيمة', 'الحالة', 'الفجوات'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {health.map((row, i) => (
                  <tr key={i} className={`${!row.is_covered ? 'bg-red-50/50' : row.has_fallback_setup ? 'bg-amber-50/30' : 'hover:bg-slate-50'} transition-colors`}>
                    <td className="px-4 py-3 font-medium text-slate-700">{row.warehouse}</td>
                    <td className="px-4 py-3">
                      {row.ipg
                        ? <span className="text-xs font-mono bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{row.ipg}</span>
                        : <span className="text-xs text-red-500">بدون IPG</span>}
                    </td>
                    <td className="px-4 py-3">
                      {row.ppg
                        ? <span className="text-xs font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{row.ppg}</span>
                        : <span className="text-xs text-red-500">بدون PPG</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.movement_count.toLocaleString()}</td>
                    <td className="px-4 py-3 font-semibold text-brand-700">{EGP(row.total_value ?? 0)}</td>
                    <td className="px-4 py-3">
                      {!row.is_covered ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold border border-red-200">
                          <AlertTriangle size={10} /> مفقود
                        </span>
                      ) : row.has_fallback_setup ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">
                          ⚡ احتياطي
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold border border-green-200">
                          <CheckCircle size={10} /> مطابق
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.gaps.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.gaps.map((g, gi) => (
                            <span key={gi} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{g}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
