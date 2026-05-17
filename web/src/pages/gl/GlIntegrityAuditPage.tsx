import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle,
  RefreshCw, Wrench, ChevronDown, ChevronUp,
} from 'lucide-react'
import { glApi } from '../../api/gl'

const EGP = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

function GapRow({ label, ops_total, gl_total, gap, ok }: {
  label: string; ops_total: number; gl_total: number; gap: number; ok: boolean
}) {
  return (
    <tr className={ok ? 'hover:bg-gray-50' : 'bg-red-50/40'}>
      <td className="px-4 py-2.5 text-sm text-gray-700">{label}</td>
      <td className="px-4 py-2.5 text-sm font-mono text-right">{EGP(ops_total)}</td>
      <td className="px-4 py-2.5 text-sm font-mono text-right">{EGP(gl_total)}</td>
      <td className="px-4 py-2.5 text-sm font-mono text-right">
        <span className={ok ? 'text-green-600' : 'text-red-600 font-semibold'}>
          {ok ? '✓ متطابق' : EGP(gap)}
        </span>
      </td>
    </tr>
  )
}

export default function GlIntegrityAuditPage() {
  const qc = useQueryClient()
  const [showUnbalanced, setShowUnbalanced] = useState(true)
  const [showPhantom, setShowPhantom]       = useState(true)
  const [tbFrom, setTbFrom]                 = useState('')
  const [tbTo, setTbTo]                     = useState('')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['gl-integrity-audit'],
    queryFn:  () => glApi.glIntegrity(),
    staleTime: 60_000,
  })

  const { data: tbData, isLoading: tbLoading, refetch: tbRefetch } = useQuery({
    queryKey: ['gl-trial-balance', tbFrom, tbTo],
    queryFn:  () => glApi.glTrialBalance({ from: tbFrom || undefined, to: tbTo || undefined }),
    enabled:  false,
    staleTime: 30_000,
  })

  const repairMut = useMutation({
    mutationFn: () => glApi.repairPhantomAccounts(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gl-integrity-audit'] }),
  })

  const backfillMut = useMutation({
    mutationFn: () => glApi.backfillAccountCodes(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gl-integrity-audit'] }),
  })

  const d = data

  const healthColor =
    d?.health === 'clean'    ? 'text-green-600 bg-green-50 border-green-200' :
    d?.health === 'warning'  ? 'text-amber-600 bg-amber-50 border-amber-200' :
                               'text-red-600 bg-red-50 border-red-200'

  const HealthIcon = d?.health === 'clean' ? ShieldCheck : ShieldAlert

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
            تدقيق سلامة القيود المحاسبية
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            5 فحوصات: توازن القيود · الحسابات الوهمية · فجوة العمليات/GL · القيود بدون فترة · الأحداث المكررة
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => backfillMut.mutate()}
            disabled={backfillMut.isPending}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            <Wrench className="w-4 h-4" />
            {backfillMut.isPending ? 'جاري التصحيح…' : 'تصحيح الحسابات الوهمية'}
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            تحديث
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400 animate-pulse">جاري تحليل البيانات...</div>
      ) : !d ? null : (
        <>
          {/* Backfill result */}
          {backfillMut.data && (
            <div className={`px-4 py-3 rounded-lg border text-sm ${
              backfillMut.data.total_lines_updated > 0
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-green-50 border-green-200 text-green-700'
            }`}>
              {backfillMut.data.message}
              {backfillMut.data.total_lines_updated > 0 && (
                <span className="mr-2 text-xs opacity-75">
                  ({backfillMut.data.detail.filter(d => d.rows_updated > 0).map(d => `${d.from}→${d.to}: ${d.rows_updated}`).join(' · ')})
                </span>
              )}
            </div>
          )}

          {/* Health Banner */}
          <div className={`flex items-center gap-3 px-5 py-4 rounded-xl border ${healthColor}`}>
            <HealthIcon className="w-6 h-6 shrink-0" />
            <div>
              <p className="font-semibold">
                {d.health === 'clean'   ? 'البيانات المحاسبية نظيفة — لا توجد مشاكل' :
                 d.health === 'warning' ? `تحذير — ${d.critical_issues} مشكلة تحتاج مراجعة` :
                                         `حرج — ${d.critical_issues} مشكلة تؤثر على دقة التقارير`}
              </p>
              <p className="text-xs opacity-75 mt-0.5">آخر فحص: {new Date(d.generated_at).toLocaleString('ar-EG')}</p>
            </div>
          </div>

          {/* 1. Unbalanced Entries */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <button
              onClick={() => setShowUnbalanced(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                {d.unbalanced_entries.count > 0
                  ? <AlertTriangle className="w-4 h-4 text-red-500" />
                  : <CheckCircle className="w-4 h-4 text-green-500" />}
                <span className="font-medium text-gray-800">قيود غير متوازنة</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
                  d.unbalanced_entries.count > 0
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : 'bg-green-100 text-green-700 border-green-200'
                }`}>{d.unbalanced_entries.count}</span>
              </div>
              {showUnbalanced ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showUnbalanced && d.unbalanced_entries.count > 0 && (
              <div className="border-t overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {['#', 'رقم القيد', 'التاريخ', 'البيان', 'المصدر', 'إجمالي مدين', 'إجمالي دائن', 'الفارق'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.unbalanced_entries.rows.map(r => (
                      <tr key={r.id} className="bg-red-50/30 hover:bg-red-50/60">
                        <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">{r.id}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{r.entry_number ?? '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{r.entry_date}</td>
                        <td className="px-4 py-2.5 text-xs max-w-[200px] truncate">{r.description ?? '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{r.source_module ?? '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-right">{EGP(r.total_dr)}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-right">{EGP(r.total_cr)}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-right text-red-600 font-semibold">{EGP(r.imbalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {showUnbalanced && d.unbalanced_entries.count === 0 && (
              <div className="border-t px-5 py-4 text-sm text-green-600">✓ كل القيود متوازنة (مدين = دائن)</div>
            )}
          </div>

          {/* 2. Phantom Accounts */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <button
              onClick={() => setShowPhantom(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                {d.phantom_accounts.count > 0
                  ? <AlertTriangle className="w-4 h-4 text-amber-500" />
                  : <CheckCircle className="w-4 h-4 text-green-500" />}
                <span className="font-medium text-gray-800">حسابات وهمية في سطور القيود</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
                  d.phantom_accounts.count > 0
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-green-100 text-green-700 border-green-200'
                }`}>{d.phantom_accounts.count}</span>
              </div>
              {showPhantom ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showPhantom && (
              <div className="border-t">
                {d.phantom_accounts.count > 0 ? (
                  <>
                    {d.phantom_accounts.note && (
                      <p className="px-5 py-3 text-xs text-amber-700 bg-amber-50 border-b">{d.phantom_accounts.note}</p>
                    )}
                    <div className="px-5 py-3 flex justify-end border-b">
                      <button
                        onClick={() => repairMut.mutate()}
                        disabled={repairMut.isPending}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-60"
                      >
                        <Wrench className="w-3.5 h-3.5" />
                        {repairMut.isPending ? 'جاري الإصلاح…' : 'إصلاح تلقائي (إدراج في شجرة الحسابات)'}
                      </button>
                    </div>
                    {repairMut.data && (
                      <p className="px-5 py-2 text-xs text-green-700 bg-green-50 border-b">{repairMut.data.message}</p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            {['كود الحساب', 'عدد السطور', 'صافي التأثير', 'أول ظهور', 'آخر ظهور'].map(h => (
                              <th key={h} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {d.phantom_accounts.rows.map(r => (
                            <tr key={r.account_code} className="hover:bg-amber-50/30">
                              <td className="px-4 py-2.5 font-mono font-semibold text-amber-700">{r.account_code}</td>
                              <td className="px-4 py-2.5 text-xs text-center">{r.line_count}</td>
                              <td className="px-4 py-2.5 font-mono text-xs text-right">{EGP(r.net_impact)}</td>
                              <td className="px-4 py-2.5 text-xs">{r.first_seen}</td>
                              <td className="px-4 py-2.5 text-xs">{r.last_seen}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="px-5 py-4 text-sm text-green-600">✓ كل الحسابات موجودة في شجرة الحسابات</div>
                )}
              </div>
            )}
          </div>

          {/* 3. Ops vs GL Gap */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center gap-2">
              {[d.ops_vs_gl.cash, d.ops_vs_gl.suppliers, d.ops_vs_gl.inventory].every(x => x.ok)
                ? <CheckCircle className="w-4 h-4 text-green-500" />
                : <AlertTriangle className="w-4 h-4 text-red-500" />}
              <span className="font-medium text-gray-800">مقارنة أرقام العمليات مع القيود المحاسبية</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['الوحدة', 'إجمالي العمليات المرحّلة', 'إجمالي GL', 'الفارق'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                <GapRow label="الخزينة (النقد)"    {...d.ops_vs_gl.cash}      />
                <GapRow label="الموردون"             {...d.ops_vs_gl.suppliers} />
                <GapRow label="المخزون"              {...d.ops_vs_gl.inventory} />
              </tbody>
            </table>
            <p className="px-5 py-2.5 text-xs text-gray-400 border-t">{d.ops_vs_gl.note}</p>
          </div>

          {/* 4. Missing Period + 5. Duplicate Events (side by side) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                {d.missing_period.entry_count > 0
                  ? <AlertTriangle className="w-4 h-4 text-amber-500" />
                  : <CheckCircle className="w-4 h-4 text-green-500" />}
                <span className="font-medium text-gray-800 text-sm">قيود بدون فترة محاسبية</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  d.missing_period.entry_count > 0
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-green-100 text-green-700 border-green-200'
                }`}>{d.missing_period.entry_count}</span>
              </div>
              {d.missing_period.entry_count > 0 ? (
                <>
                  <p className="text-sm font-mono text-gray-700">{EGP(d.missing_period.total_debit)} إجمالي مدين</p>
                  <p className="text-xs text-amber-600 mt-1">{d.missing_period.note}</p>
                </>
              ) : (
                <p className="text-sm text-green-600">✓ كل القيود مرتبطة بفترة محاسبية</p>
              )}
            </div>

            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                {d.duplicate_events.count > 0
                  ? <AlertTriangle className="w-4 h-4 text-red-500" />
                  : <CheckCircle className="w-4 h-4 text-green-500" />}
                <span className="font-medium text-gray-800 text-sm">أحداث محاسبية مكررة</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  d.duplicate_events.count > 0
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : 'bg-green-100 text-green-700 border-green-200'
                }`}>{d.duplicate_events.count}</span>
              </div>
              {d.duplicate_events.count > 0 ? (
                <div className="space-y-1">
                  {d.duplicate_events.rows.slice(0, 5).map((r, i) => (
                    <p key={i} className="text-xs text-gray-600 font-mono">
                      {r.source_module}/{r.event_type} id:{r.source_id} — {r.entry_count} قيود
                    </p>
                  ))}
                  {d.duplicate_events.note && (
                    <p className="text-xs text-red-600 mt-2">{d.duplicate_events.note}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-green-600">✓ لا توجد أحداث مرحّلة مرتين</p>
              )}
            </div>
          </div>

          {/* Trial Balance Section */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center justify-between">
              <span className="font-medium text-gray-800">ميزان المراجعة</span>
              <div className="flex items-center gap-2">
                <input
                  type="date" value={tbFrom} onChange={e => setTbFrom(e.target.value)}
                  className="text-xs px-2 py-1.5 border rounded-lg"
                />
                <span className="text-xs text-gray-400">إلى</span>
                <input
                  type="date" value={tbTo} onChange={e => setTbTo(e.target.value)}
                  className="text-xs px-2 py-1.5 border rounded-lg"
                />
                <button
                  onClick={() => tbRefetch()}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  عرض
                </button>
              </div>
            </div>

            {tbLoading ? (
              <div className="p-8 text-center text-gray-400 animate-pulse">جاري التحميل...</div>
            ) : tbData ? (
              <>
                <div className={`px-5 py-2.5 border-b flex items-center gap-3 text-sm ${
                  tbData.is_balanced ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {tbData.is_balanced
                    ? <><CheckCircle className="w-4 h-4" /> الميزان متوازن — مدين = دائن</>
                    : <><AlertTriangle className="w-4 h-4" /> الميزان غير متوازن!</>}
                  <span className="font-mono font-semibold">{EGP(tbData.totals.total_debit)}</span>
                  {tbData.phantom_count > 0 && (
                    <span className="mr-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                      {tbData.phantom_count} حساب وهمي
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        {['كود الحساب', 'اسم الحساب', 'النوع', 'مدين', 'دائن', 'صافي', 'عدد القيود'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {tbData.rows.map(r => (
                        <tr key={r.account_code} className={`hover:bg-gray-50 ${!r.account_name ? 'bg-amber-50/30' : ''}`}>
                          <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.account_code}</td>
                          <td className="px-4 py-2 text-xs">{r.account_name ?? <span className="text-amber-600 italic">وهمي</span>}</td>
                          <td className="px-4 py-2 text-xs text-gray-500">{r.account_type ?? '—'}</td>
                          <td className="px-4 py-2 font-mono text-xs text-right">{EGP(r.total_debit)}</td>
                          <td className="px-4 py-2 font-mono text-xs text-right">{EGP(r.total_credit)}</td>
                          <td className={`px-4 py-2 font-mono text-xs text-right font-semibold ${r.net_balance < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                            {EGP(r.net_balance)}
                          </td>
                          <td className="px-4 py-2 text-xs text-center text-gray-400">{r.entry_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="px-5 py-6 text-sm text-gray-400 text-center">
                اضغط "عرض" لتحميل ميزان المراجعة
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
