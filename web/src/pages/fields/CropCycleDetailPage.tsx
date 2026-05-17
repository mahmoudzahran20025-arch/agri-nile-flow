import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, AlertTriangle, TrendingUp, Layers, Calendar, Wheat } from 'lucide-react'
import { cropCyclesApi, type WIPCategory, type CycleStatus } from '../../api/crop-cycles'
import { costCategoriesApi } from '../../api/cost-categories'
import { useToast } from '../../contexts/ToastContext'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { useAppStore } from '../../store/appStore'

const STATUS_CONFIG: Record<CycleStatus, { label: string; className: string }> = {
  active:      { label: 'نشطة',      className: 'bg-emerald-100 text-emerald-700' },
  harvested:   { label: 'محصودة',    className: 'bg-blue-100 text-blue-700' },
  abandoned:   { label: 'متروكة',    className: 'bg-amber-100 text-amber-700' },
  written_off: { label: 'مشطوبة',    className: 'bg-red-100 text-red-700' },
}

// Fallback labels for legacy cost_category enum values not yet in cost_categories table.
const CATEGORY_LABELS_FALLBACK: Record<WIPCategory, string> = {
  materials:    'مواد',
  labor:        'عمالة',
  equipment:    'معدات',
  overhead:     'مصاريف عامة',
  depreciation: 'إهلاك',
  irrigation:   'ري',
  land_rent:    'إيجار أرض',
  fuel:         'وقود',
  maintenance:  'صيانة',
  contractor:   'مقاول',
  transport:    'نقل',
  other:        'أخرى',
}

function fmt(n: number) {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CropCycleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const cycleId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role } = useAppStore()

  const [statusModal, setStatusModal] = useState<'abandoned' | 'written_off' | null>(null)
  const [statusNotes, setStatusNotes] = useState('')
  const [activeTab, setActiveTab] = useState<'ledger' | 'summary'>('ledger')

  const { data: cycle, isLoading } = useQuery({
    queryKey: ['crop-cycle', cycleId],
    queryFn: () => cropCyclesApi.get(cycleId),
  })

  const { data: wipSummary, isLoading: wipLoading } = useQuery({
    queryKey: ['crop-cycle-wip', cycleId],
    queryFn: () => cropCyclesApi.wipSummary(cycleId),
    enabled: activeTab === 'summary',
  })

  const { data: costCats } = useQuery({
    queryKey: ['cost-categories'],
    queryFn: () => costCategoriesApi.list(),
    staleTime: 5 * 60_000,
  })
  const catLabelMap = Object.fromEntries(
    (costCats ?? []).map(c => [c.code.toLowerCase(), c.name_ar])
  )

  const canWrite = role === 'super_admin' || role === 'company_admin' || role === 'field_supervisor' || role === 'accountant'

  const statusMut = useMutation({
    mutationFn: ({ status, notes }: { status: 'abandoned' | 'written_off'; notes?: string }) =>
      cropCyclesApi.setStatus(cycleId, status, notes),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['crop-cycle', cycleId] })
      qc.invalidateQueries({ queryKey: ['crop-cycles'] })
      if (res.wip_balance_warning) {
        toast(res.wip_balance_warning, 'warning')
      } else {
        toast('تم تحديث حالة الدورة', 'success')
      }
      setStatusModal(null)
      setStatusNotes('')
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <TableSkeleton rows={10} cols={6} />
      </div>
    )
  }

  if (!cycle) {
    return (
      <div className="p-6 text-center text-slate-500">
        <p>دورة المحصول غير موجودة</p>
        <button onClick={() => navigate('/fields/crop-cycles')} className="mt-3 text-blue-600 hover:underline text-sm">
          العودة للقائمة
        </button>
      </div>
    )
  }

  const statusCfg = STATUS_CONFIG[cycle.status]
  const ledger = cycle.ledger ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/fields/crop-cycles')}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <ArrowRight size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{cycle.crop_name}</h1>
            <p className="text-sm text-slate-500">{cycle.field_name} · {cycle.field_code} · {cycle.season_name}</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusCfg.className}`}>
          {statusCfg.label}
        </span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <TrendingUp size={14} />
            <span className="text-xs">إجمالي تكاليف WIP</span>
          </div>
          <p className="text-lg font-bold text-slate-800">{fmt(cycle.total_wip_cost)} <span className="text-xs font-normal text-slate-400">ج.م</span></p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <Layers size={14} />
            <span className="text-xs">إجمالي المُسوَّى</span>
          </div>
          <p className="text-lg font-bold text-slate-800">{fmt(cycle.total_settled)} <span className="text-xs font-normal text-slate-400">ج.م</span></p>
        </div>
        <div className={`bg-white rounded-xl border p-4 ${cycle.wip_balance > 0 ? 'border-amber-200' : 'border-slate-200'}`}>
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <AlertTriangle size={14} className={cycle.wip_balance > 0 ? 'text-amber-500' : ''} />
            <span className="text-xs">رصيد WIP</span>
          </div>
          <p className={`text-lg font-bold ${cycle.wip_balance > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
            {fmt(cycle.wip_balance)} <span className="text-xs font-normal text-slate-400">ج.م</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <Calendar size={14} />
            <span className="text-xs">تاريخ الزراعة</span>
          </div>
          <p className="text-sm font-semibold text-slate-800">{cycle.planting_date}</p>
          {cycle.expected_harvest_date && (
            <p className="text-xs text-slate-400 mt-0.5">المتوقع: {cycle.expected_harvest_date}</p>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-6 text-sm">
        <div>
          <span className="text-slate-400">نوع المحصول: </span>
          <span className="font-medium text-slate-700">
            {cycle.crop_type === 'annual' ? 'حولي' : cycle.crop_type === 'long_cycle' ? 'دورة طويلة' : 'معمر'}
          </span>
        </div>
        {cycle.area_feddan != null && (
          <div>
            <span className="text-slate-400">المساحة: </span>
            <span className="font-medium text-slate-700">{cycle.area_feddan} فدان</span>
          </div>
        )}
        {cycle.center_code != null && (
          <div>
            <span className="text-slate-400">مركز التكلفة: </span>
            <span className="font-medium text-slate-700">{cycle.center_code}</span>
          </div>
        )}
        {cycle.actual_harvest_date && (
          <div>
            <span className="text-slate-400">تاريخ الحصاد الفعلي: </span>
            <span className="font-medium text-slate-700">{cycle.actual_harvest_date}</span>
          </div>
        )}
        {cycle.notes && (
          <div className="w-full">
            <span className="text-slate-400">ملاحظات: </span>
            <span className="font-medium text-slate-700">{cycle.notes}</span>
          </div>
        )}
      </div>

      {/* Status actions */}
      {canWrite && cycle.status === 'active' && (
        <div className="flex gap-3">
          <button
            onClick={() => setStatusModal('abandoned')}
            className="px-4 py-2 text-sm rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors"
          >
            وضع علامة متروكة
          </button>
          <button
            onClick={() => setStatusModal('written_off')}
            className="px-4 py-2 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
          >
            شطب الدورة
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(['ledger', 'summary'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-[#0F2D5C] text-[#0F2D5C]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'ledger' ? 'دفتر WIP' : 'ملخص التكاليف'}
          </button>
        ))}
      </div>

      {/* Ledger tab */}
      {activeTab === 'ledger' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {ledger.length === 0 ? (
            <div className="p-12 text-center">
              <Wheat size={36} className="mx-auto mb-3 text-slate-300" />
              <p className="text-slate-500 font-medium">لا توجد قيود WIP بعد</p>
              <p className="text-xs text-slate-400 mt-1">ستظهر هنا تكاليف المواد والعمالة والمعدات عند ترحيلها على هذه الدورة</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">التاريخ</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">الفئة</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">الموسم</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">البيان</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">مدين</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">دائن</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">الرصيد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.map(row => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{row.transaction_date}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                          {catLabelMap[row.cost_category_code?.toLowerCase() ?? '']
                            ?? catLabelMap[row.cost_category?.toLowerCase() ?? '']
                            ?? CATEGORY_LABELS_FALLBACK[row.cost_category as WIPCategory]
                            ?? row.cost_category}
                        </span>
                        {row.subcategory_code && (
                          <span className="ml-1 text-xs text-slate-400">{row.subcategory_code}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{row.season_name}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{row.description ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-700">
                        {row.debit > 0 ? fmt(row.debit) : ''}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-red-600">
                        {row.credit > 0 ? fmt(row.credit) : ''}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-700">
                        {fmt(row.running_balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-slate-600">الإجمالي</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">
                      {fmt(ledger.reduce((s, r) => s + r.debit, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600">
                      {fmt(ledger.reduce((s, r) => s + r.credit, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                      {fmt(cycle.wip_balance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Summary tab */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          {wipLoading ? (
            <TableSkeleton rows={6} cols={4} />
          ) : !wipSummary ? null : (
            <>
              {/* By category */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-700">توزيع التكاليف حسب الفئة</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-right text-xs text-slate-500">الفئة</th>
                      <th className="px-4 py-2 text-left text-xs text-slate-500">إجمالي مدين</th>
                      <th className="px-4 py-2 text-left text-xs text-slate-500">إجمالي دائن</th>
                      <th className="px-4 py-2 text-left text-xs text-slate-500">الرصيد</th>
                      <th className="px-4 py-2 text-left text-xs text-slate-500">النسبة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {wipSummary.by_category.map(r => (
                      <tr key={r.cost_category} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-700">
                          {catLabelMap[r.cost_category?.toLowerCase() ?? '']
                            ?? CATEGORY_LABELS_FALLBACK[r.cost_category as WIPCategory]
                            ?? r.cost_category}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{fmt(r.total_debit)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-red-600">{fmt(r.total_credit)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-800">{fmt(r.balance)}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                          {wipSummary.total_wip > 0
                            ? `${((r.balance / wipSummary.total_wip) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td className="px-4 py-2.5 font-bold text-slate-700">الإجمالي</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700">
                        {fmt(wipSummary.by_category.reduce((s, r) => s + r.total_debit, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-red-600">
                        {fmt(wipSummary.by_category.reduce((s, r) => s + r.total_credit, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-800">
                        {fmt(wipSummary.total_wip)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-400">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* By season */}
              {wipSummary.by_season.length > 1 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-700">توزيع التكاليف حسب الموسم</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2 text-right text-xs text-slate-500">الموسم</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-500">إجمالي مدين</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-500">إجمالي دائن</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-500">الرصيد</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {wipSummary.by_season.map(r => (
                        <tr key={r.season_id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-medium text-slate-700">{r.season_name}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{fmt(r.total_debit)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-red-600">{fmt(r.total_credit)}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-800">{fmt(r.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Status transition modal */}
      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold text-slate-800 mb-1">
              {statusModal === 'abandoned' ? 'ترك الدورة' : 'شطب الدورة'}
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              {statusModal === 'abandoned'
                ? 'سيتم وضع علامة متروكة على هذه الدورة. إذا كان هناك رصيد WIP، ستحتاج إلى ترحيل قيد الشطب يدوياً.'
                : 'سيتم شطب هذه الدورة وإدراج الخسارة تحت حساب "خسارة محاصيل — هلاك وترك". إجراء لا يمكن التراجع عنه.'}
            </p>
            {cycle.wip_balance > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700 flex gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>رصيد WIP غير مصفى: {fmt(cycle.wip_balance)} ج.م — يتطلب قيد شطب يدوي</span>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات (اختياري)</label>
              <textarea
                value={statusNotes}
                onChange={e => setStatusNotes(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C] resize-none"
                rows={3}
                placeholder="سبب الترك أو الشطب..."
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setStatusModal(null); setStatusNotes('') }}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => statusMut.mutate({ status: statusModal, notes: statusNotes || undefined })}
                disabled={statusMut.isPending}
                className={`px-4 py-2 text-sm text-white rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  statusModal === 'abandoned'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {statusMut.isPending ? 'جاري...' : statusModal === 'abandoned' ? 'تأكيد الترك' : 'تأكيد الشطب'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
