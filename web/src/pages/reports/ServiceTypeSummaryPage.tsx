import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle, Download, Info } from 'lucide-react'
import { reportsApi } from '../../api/reports'
import { configApi } from '../../api/client'
import { TableSkeleton } from '../../components/ui/Skeleton'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

const PCT = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`

// Gap severity: ≤2% = green, ≤10% = amber, >10% = red, negative = blue (GL > ops, unusual)
function GapBadge({ gap, gap_pct, ops_total }: { gap: number; gap_pct: number; ops_total: number }) {
  if (ops_total === 0 && gap === 0) return <span className="text-xs text-slate-400">—</span>

  const absGapPct = Math.abs(gap_pct)
  const isNegative = gap < 0 // GL > ops

  if (isNegative)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
        <Info size={10} /> {PCT(gap_pct)}
      </span>
    )
  if (absGapPct <= 2)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
        <CheckCircle size={10} /> {PCT(gap_pct)}
      </span>
    )
  if (absGapPct <= 10)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
        <AlertTriangle size={10} /> {PCT(gap_pct)}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
      <AlertTriangle size={10} /> {PCT(gap_pct)}
    </span>
  )
}

function GapBar({ gap, ops_total }: { gap: number; ops_total: number }) {
  if (ops_total <= 0) return null
  const postedPct = Math.min(100, Math.max(0, ((ops_total - Math.max(0, gap)) / ops_total) * 100))
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 w-full min-w-[60px]">
      <div className="bg-emerald-400 h-full rounded-full" style={{ width: `${postedPct}%` }} />
    </div>
  )
}

function exportCsv(rows: ReturnType<typeof buildRows>) {
  const header = 'نوع الخدمة,المجموعة,إجمالي التشغيل,إجمالي GL,الفجوة,فجوة%,عدد العمليات'
  const lines = rows.map(r =>
    [r.service_type_code, r.service_group, r.ops_total, r.gl_total, r.gap, r.gap_pct, r.txn_count].join(',')
  )
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `service-type-summary-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

type ServiceTypeRow = {
  service_type_code: string; name_ar: string; service_group: string
  ops_total: number; gl_total: number; gap: number; gap_pct: number; txn_count: number
}

function buildRows(rows: ServiceTypeRow[]) { return rows }

const SERVICE_GROUP_LABELS: Record<string, string> = {
  MECHANIZATION: 'ميكنة',
  LABOR:         'عمالة',
  SUPPLY:        'مستلزمات',
  LOGISTICS:     'نقل ولوجستيات',
  SUPERVISION:   'إشراف',
  OTHER:         'أخرى',
}

export default function ServiceTypeSummaryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const seasonId = searchParams.get('season_id') ? Number(searchParams.get('season_id')) : undefined

  const { data: seasons } = useQuery({ queryKey: ['seasons'], queryFn: configApi.seasons })

  const { data, isLoading, error } = useQuery({
    queryKey: ['service-type-summary', seasonId],
    queryFn:  () => reportsApi.serviceTypeSummary(seasonId!),
    enabled:  seasonId != null,
  })

  const rows    = data?.rows    ?? []
  const totals  = data?.totals
  const season  = data?.season

  const highGapCount  = rows.filter(r => r.gap_pct > 10).length
  const totalGapPct   = totals && totals.ops_total > 0
    ? ((totals.gap / totals.ops_total) * 100).toFixed(1)
    : '0.0'

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">ملخص التكاليف بنوع الخدمة</h1>
          <p className="text-sm text-slate-500 mt-1">
            مقارنة بين التكاليف التشغيلية والقيود المحاسبية لكل نوع خدمة — الفجوة تعني تكاليف لم تُرحَّل بعد
          </p>
        </div>
        <div className="flex gap-2">
          {rows.length > 0 && (
            <button
              onClick={() => exportCsv(rows)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Download size={13} /> تصدير CSV
            </button>
          )}
        </div>
      </div>

      {/* Season selector */}
      <div className="flex gap-3 flex-wrap">
        <select
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          value={seasonId ?? ''}
          onChange={e => setSearchParams(e.target.value ? { season_id: e.target.value } : {})}
        >
          <option value="">اختر الموسم</option>
          {(seasons as Array<{ id: number; name: string }> ?? []).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {!seasonId && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-400">
          اختر موسمًا لعرض تقرير التكاليف حسب نوع الخدمة
        </div>
      )}

      {seasonId && isLoading && <TableSkeleton rows={6} cols={6} />}

      {seasonId && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          تعذّر تحميل البيانات — تأكد من أن الموسم يحتوي على حركات مرحّلة
        </div>
      )}

      {/* KPI summary bar */}
      {totals && season && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'إجمالي التشغيل',      value: EGP(totals.ops_total) },
            { label: 'إجمالي GL',            value: EGP(totals.gl_total) },
            { label: 'إجمالي الفجوة',        value: EGP(totals.gap) },
            { label: 'نسبة الفجوة الإجمالية', value: `${totalGapPct}%` },
          ].map(kpi => (
            <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{kpi.label}</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* High-gap alert */}
      {highGapCount > 0 && (
        <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>
            <strong>{highGapCount}</strong> نوع خدمة بفجوة تتجاوز 10% — هذه التكاليف موجودة في التشغيل لكنها لم تُرحَّل إلى دفتر الأستاذ.{' '}
            يوصى بمراجعة قواعد الترحيل أو تشغيل عملية الترحيل الدُّفعي.
          </span>
        </div>
      )}

      {/* Main table */}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm text-right">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {['نوع الخدمة', 'المجموعة', 'إجمالي التشغيل', 'إجمالي GL', 'الفجوة', 'فجوة%', 'تغطية GL', 'عمليات'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => (
                <tr key={r.service_type_code} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {r.name_ar}
                    <span className="block text-[11px] font-mono text-slate-400">{r.service_type_code}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium whitespace-nowrap">
                      {SERVICE_GROUP_LABELS[r.service_group] ?? r.service_group}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">{EGP(r.ops_total)}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{EGP(r.gl_total)}</td>
                  <td className={`px-4 py-3 font-mono font-semibold ${r.gap > 0 ? 'text-red-600' : r.gap < 0 ? 'text-blue-600' : 'text-emerald-600'}`}>
                    {r.gap === 0 ? '—' : EGP(r.gap)}
                  </td>
                  <td className="px-4 py-3">
                    <GapBadge gap={r.gap} gap_pct={r.gap_pct} ops_total={r.ops_total} />
                  </td>
                  <td className="px-4 py-3 min-w-[80px]">
                    <GapBar gap={r.gap} ops_total={r.ops_total} />
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-500 text-xs">{r.txn_count}</td>
                </tr>
              ))}
            </tbody>

            {totals && (
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <td className="px-4 py-3" colSpan={2}>الإجمالي</td>
                  <td className="px-4 py-3 font-mono">{EGP(totals.ops_total)}</td>
                  <td className="px-4 py-3 font-mono">{EGP(totals.gl_total)}</td>
                  <td className={`px-4 py-3 font-mono ${totals.gap > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {totals.gap === 0 ? '—' : EGP(totals.gap)}
                  </td>
                  <td className="px-4 py-3">
                    {totals.ops_total > 0 && (
                      <GapBadge gap={totals.gap} gap_pct={Number(totalGapPct)} ops_total={totals.ops_total} />
                    )}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Legend */}
      {rows.length > 0 && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500 space-y-1">
          <p className="font-semibold text-slate-600 mb-1">دليل الألوان</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" /> فجوة ≤ 2% — مرحّل بالكامل</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" /> فجوة 2-10% — ترحيل جزئي</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> فجوة &gt; 10% — تحتاج مراجعة</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400" /> فجوة سالبة — GL أكبر من التشغيل (غير معتاد)</span>
          </div>
        </div>
      )}
    </div>
  )
}
