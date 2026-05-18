import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, BarChart3, TrendingDown, Package, Layers } from 'lucide-react'
import { cropCyclesApi } from '../../api/crop-cycles'
import { useAppStore } from '../../store/appStore'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)

const PCT = (part: number, total: number) =>
  total === 0 ? '0%' : `${((part / total) * 100).toFixed(1)}%`

const CATEGORY_AR: Record<string, string> = {
  materials: 'مستلزمات', labor: 'عمالة', equipment: 'معدات', overhead: 'مصروفات عامة',
  depreciation: 'استهلاك', irrigation: 'ري', land_rent: 'إيجار أرض', fuel: 'وقود',
  maintenance: 'صيانة', contractor: 'مقاولات', transport: 'نقل', other: 'أخرى',
}

const STATUS_AR: Record<string, string> = {
  active: 'نشط', harvested: 'محصود', abandoned: 'مُتخلى عنه', written_off: 'مشطوب', settled: 'مُسوَّى',
}

export default function SeasonRollupPage() {
  const seasons = useAppStore(s => s.seasons)
  const [seasonId, setSeasonId] = useState<string>('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['season-rollup', seasonId],
    queryFn:  () => cropCyclesApi.seasonRollup({ season_id: Number(seasonId) }),
    enabled:  Boolean(seasonId),
  })

  const [expandedCycle, setExpanded] = useState<number | null>(null)

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
          <BarChart3 size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">ملخص تكاليف الموسم</h1>
          <p className="text-sm text-slate-500">إجمالي WIP والتسويات حسب الموسم الزراعي</p>
        </div>
      </div>

      {/* Season selector */}
      <div className="mb-6">
        <select
          className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30 min-w-[220px]"
          value={seasonId}
          onChange={e => setSeasonId(e.target.value)}
        >
          <option value="">اختر الموسم...</option>
          {(seasons as { id: number; name: string }[] | undefined)?.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {!seasonId && (
        <div className="text-center py-16 text-slate-400">
          <Layers size={32} className="mx-auto mb-3 opacity-30" />
          <p>اختر موسماً لعرض الملخص</p>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-[#0F2D5C]" size={28} />
        </div>
      )}

      {isError && (
        <div className="text-center py-8 text-rose-500 text-sm">حدث خطأ في تحميل البيانات</div>
      )}

      {data && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-xs text-slate-400 mb-1">إجمالي التكاليف</p>
              <p className="text-2xl font-bold text-slate-800">{EGP(data.summary.total_cost)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-xs text-slate-400 mb-1">تكاليف مُسوَّاة</p>
              <p className="text-2xl font-bold text-emerald-700">{EGP(data.summary.settled_cost)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-xs text-slate-400 mb-1">WIP مفتوح</p>
              <p className="text-2xl font-bold text-amber-600">{EGP(data.summary.open_wip)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-xs text-slate-400 mb-1">عدد الدورات</p>
              <p className="text-2xl font-bold text-slate-800">{data.summary.cycle_count}</p>
            </div>
          </div>

          {/* By Category */}
          {data.by_category.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <h2 className="text-base font-bold text-slate-700 mb-4 flex items-center gap-2">
                <Package size={16} /> التكاليف حسب الفئة
              </h2>
              <div className="space-y-3">
                {data.by_category.map(cat => (
                  <div key={cat.cost_category} className="flex items-center gap-3">
                    <div className="w-28 text-sm text-slate-600 shrink-0">
                      {CATEGORY_AR[cat.cost_category] ?? cat.cost_category}
                    </div>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0F2D5C]/70 rounded-full"
                        style={{ width: PCT(cat.balance, data.summary.total_cost) }}
                      />
                    </div>
                    <div className="w-32 text-left font-mono text-sm font-medium text-slate-700">
                      {EGP(cat.balance)}
                    </div>
                    <div className="w-12 text-left text-xs text-slate-400">
                      {PCT(cat.balance, data.summary.total_cost)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By Cycle */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-700 flex items-center gap-2">
                <TrendingDown size={16} /> التفاصيل حسب الدورة الزراعية
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-right px-4 py-3 text-slate-500 font-medium">الدورة / الحقل</th>
                  <th className="text-right px-4 py-3 text-slate-500 font-medium">الحالة</th>
                  <th className="text-right px-4 py-3 text-slate-500 font-medium">إجمالي التكلفة</th>
                  <th className="text-right px-4 py-3 text-slate-500 font-medium">مُسوَّى</th>
                  <th className="text-right px-4 py-3 text-slate-500 font-medium">WIP مفتوح</th>
                </tr>
              </thead>
              <tbody>
                {data.by_cycle.map(cy => (
                  <tr
                    key={cy.crop_cycle_id}
                    className="border-b border-slate-50 hover:bg-slate-50/50 cursor-pointer"
                    onClick={() => setExpanded(expandedCycle === cy.crop_cycle_id ? null : cy.crop_cycle_id)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{cy.crop_name}</p>
                      <p className="text-xs text-slate-400">{cy.field_name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        cy.status === 'active' ? 'bg-emerald-50 text-emerald-700' :
                        cy.status === 'harvested' ? 'bg-blue-50 text-blue-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {STATUS_AR[cy.status] ?? cy.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">{EGP(cy.total_cost)}</td>
                    <td className="px-4 py-3 font-mono text-sm text-emerald-700">{EGP(cy.settled_cost)}</td>
                    <td className="px-4 py-3 font-mono text-sm">
                      <span className={cy.open_wip > 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                        {EGP(cy.open_wip)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={2} className="px-4 py-3 font-bold text-slate-700">الإجمالي</td>
                  <td className="px-4 py-3 font-bold font-mono text-slate-800">{EGP(data.summary.total_cost)}</td>
                  <td className="px-4 py-3 font-bold font-mono text-emerald-700">{EGP(data.summary.settled_cost)}</td>
                  <td className="px-4 py-3 font-bold font-mono text-amber-600">{EGP(data.summary.open_wip)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* By Source */}
          {data.by_source.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <h2 className="text-base font-bold text-slate-700 mb-4">التكاليف حسب المصدر</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {data.by_source.map(src => (
                  <div key={src.source_module} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <p className="text-xs text-slate-400 mb-0.5">{src.source_module}</p>
                    <p className="font-semibold text-slate-800">{EGP(src.balance)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
