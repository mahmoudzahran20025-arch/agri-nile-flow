import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { TrendingUp, TrendingDown, Minus, Download, AlertTriangle } from 'lucide-react'
import { reportsApi } from '../../api/reports'
import { configApi } from '../../api/client'
import { TableSkeleton } from '../../components/ui/Skeleton'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

const PCT = (n: number | null) =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`

const NUM = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)

type SortKey = 'cost_per_feddan' | 'margin_per_feddan' | 'total_cost' | 'total_revenue' | 'area_feddan'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'cost_per_feddan',   label: 'التكلفة / فدان' },
  { key: 'margin_per_feddan', label: 'الهامش / فدان' },
  { key: 'total_cost',        label: 'إجمالي التكلفة' },
  { key: 'total_revenue',     label: 'إجمالي الإيراد' },
  { key: 'area_feddan',       label: 'المساحة' },
]

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-400 text-xs">—</span>
  if (pct > 10)  return <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><TrendingUp size={12} />{PCT(pct)}</span>
  if (pct < 0)   return <span className="flex items-center gap-1 text-xs font-semibold text-red-500"><TrendingDown size={12} />{PCT(pct)}</span>
  return <span className="flex items-center gap-1 text-xs text-amber-500"><Minus size={12} />{PCT(pct)}</span>
}

function SourceBadge({ source }: { source: 'gl' | 'ops_fallback' }) {
  return source === 'gl'
    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">GL</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">تشغيلي</span>
}

function exportCsv(fields: ReturnType<typeof reportsApi.costPerFeddan> extends Promise<{ fields: infer F }> ? F : never) {
  const header = 'القطعة,المساحة,التكلفة الإجمالية,التكلفة/فدان,الإيراد الإجمالي,الهامش/فدان,هامش%,المصدر'
  const rows = (fields as Array<Record<string, unknown>>).map(f =>
    [
      f['field_name'], f['area_feddan'], f['total_cost'], f['cost_per_feddan'],
      f['total_revenue'], f['margin_per_feddan'], f['margin_pct'], f['cost_source'],
    ].join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `cost-per-feddan-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

export default function CostPerFeddanPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sort, setSort] = useState<SortKey>('cost_per_feddan')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const seasonId = searchParams.get('season_id') ? Number(searchParams.get('season_id')) : undefined

  const { data: seasons } = useQuery({ queryKey: ['seasons'], queryFn: configApi.seasons })

  const { data, isLoading, error } = useQuery({
    queryKey: ['cost-per-feddan', seasonId, sort],
    queryFn:  () => reportsApi.costPerFeddan(seasonId!, undefined, sort),
    enabled:  seasonId != null,
  })

  const fields = data?.fields ?? []
  const summary = data?.summary

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">التكلفة لكل فدان</h1>
          <p className="text-sm text-slate-500 mt-1">كفاءة التكلفة والإيراد لكل قطعة في الموسم</p>
        </div>
        <div className="flex gap-2 items-center">
          {fields.length > 0 && (
            <button
              onClick={() => exportCsv(fields as never)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Download size={13} /> تصدير CSV
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
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

        <select
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>

      {!seasonId && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-400">
          اختر موسمًا لعرض تقرير التكلفة لكل فدان
        </div>
      )}

      {seasonId && isLoading && <TableSkeleton rows={6} cols={7} />}

      {seasonId && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          تعذّر تحميل البيانات
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'إجمالي التكلفة', value: EGP(summary.total_cost) },
            { label: 'إجمالي الإيراد', value: EGP(summary.total_revenue) },
            { label: 'التكلفة / فدان', value: summary.cost_per_feddan != null ? EGP(summary.cost_per_feddan) : '—' },
            { label: 'هامش الموسم', value: PCT(summary.margin_pct) },
          ].map(kpi => (
            <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{kpi.label}</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* GL coverage warning */}
      {summary && summary.gl_coverage.ops_fallback_fields > 0 && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            {summary.gl_coverage.ops_fallback_fields} قطعة تعتمد على البيانات التشغيلية بدلاً من دفتر الأستاذ —
            تغطية GL: {summary.gl_coverage.coverage_pct}%
          </span>
        </div>
      )}

      {/* Table */}
      {fields.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm text-right">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {['القطعة', 'المساحة (ف)', 'التكلفة الإجمالية', 'التكلفة/فدان', 'الإيراد الإجمالي', 'هامش/فدان', 'هامش%', 'مصدر'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {fields.map(f => (
                <>
                  <tr
                    key={f.field_id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === f.field_id ? null : f.field_id)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {f.field_name}
                      {f.crop_name && <span className="block text-[11px] text-slate-400">{f.crop_name}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{NUM(f.area_feddan)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{EGP(f.total_cost)}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800">{f.cost_per_feddan != null ? EGP(f.cost_per_feddan) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{EGP(f.total_revenue)}</td>
                    <td className="px-4 py-3 font-mono">{f.margin_per_feddan != null ? EGP(f.margin_per_feddan) : '—'}</td>
                    <td className="px-4 py-3"><MarginBadge pct={f.margin_pct} /></td>
                    <td className="px-4 py-3"><SourceBadge source={f.cost_source} /></td>
                  </tr>

                  {/* Expanded ops breakdown */}
                  {expandedId === f.field_id && (
                    <tr key={`${f.field_id}-detail`}>
                      <td colSpan={8} className="bg-slate-50 px-6 py-4">
                        <div className="grid grid-cols-3 gap-x-8 gap-y-2 text-xs text-slate-600">
                          <div><span className="text-slate-400">مخزون: </span>{EGP(f.ops.inventory)}</div>
                          <div><span className="text-slate-400">عمالة: </span>{EGP(f.ops.labor)}</div>
                          <div><span className="text-slate-400">معدات: </span>{EGP(f.ops.equipment)}</div>
                          <div><span className="text-slate-400">نقدية: </span>{EGP(f.ops.cash_out)}</div>
                          <div><span className="text-slate-400">إيجار أرض: </span>{EGP(f.ops.land_rent)}</div>
                          {f.gl && (
                            <div><span className="text-slate-400">قيود GL: </span>{f.gl.entry_count}</div>
                          )}
                          {f.gl_gap.cost_gap > 0.01 && (
                            <div className="col-span-3 text-amber-600">
                              فجوة GL: {EGP(f.gl_gap.cost_gap)} من التكاليف غير مرحّلة
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>

            {/* Footer totals */}
            {summary && (
              <tfoot className="border-t border-slate-200 bg-slate-50">
                <tr className="font-semibold text-slate-700">
                  <td className="px-4 py-3">الإجمالي ({summary.field_count} قطعة)</td>
                  <td className="px-4 py-3 font-mono">{NUM(summary.total_area_feddan)}</td>
                  <td className="px-4 py-3 font-mono">{EGP(summary.total_cost)}</td>
                  <td className="px-4 py-3 font-mono">{summary.cost_per_feddan != null ? EGP(summary.cost_per_feddan) : '—'}</td>
                  <td className="px-4 py-3 font-mono">{EGP(summary.total_revenue)}</td>
                  <td className="px-4 py-3 font-mono">{summary.margin_per_feddan != null ? EGP(summary.margin_per_feddan) : '—'}</td>
                  <td className="px-4 py-3"><MarginBadge pct={summary.margin_pct} /></td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
