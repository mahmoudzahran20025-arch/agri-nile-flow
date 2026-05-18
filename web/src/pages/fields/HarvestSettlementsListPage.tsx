import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Filter, ExternalLink, Plus } from 'lucide-react'
import { harvestSettlementsApi } from '../../api/harvest-settlements'
import { useToast } from '../../contexts/ToastContext'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { useAppStore } from '../../store/appStore'
import { CommandBar } from '../../components/ui/CommandBar'
import Modal from '../../components/ui/Modal'

function fmt(n: number) {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_OPTIONS = [
  { value: '', label: 'الكل' },
  { value: 'draft',    label: 'مسودة' },
  { value: 'posted',   label: 'مُرحَّل' },
  { value: 'reversed', label: 'معكوس' },
]

export default function HarvestSettlementsListPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { role } = useAppStore()
  const canWrite = role === 'super_admin' || role === 'company_admin' || role === 'accountant'

  const [statusFilter, setStatusFilter] = useState('')
  const [reverseId, setReverseId] = useState<number | null>(null)
  const [reverseReason, setReverseReason] = useState('')

  const { data: settlements, isLoading } = useQuery({
    queryKey: ['harvest-settlements-all', statusFilter],
    queryFn: () => harvestSettlementsApi.list({ status: statusFilter || undefined }),
  })

  const reverseMut = useMutation({
    mutationFn: (id: number) => harvestSettlementsApi.reverse(id, { reason: reverseReason || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['harvest-settlements-all'] })
      qc.invalidateQueries({ queryKey: ['crop-cycles'] })
      toast('تم عكس التسوية بنجاح', 'success')
      setReverseId(null)
      setReverseReason('')
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  return (
    <div className="flex flex-col h-full">
      <CommandBar
        title="تسويات الحصاد"
        subtitle={`${settlements?.length ?? 0} تسوية مسجلة`}
        actions={canWrite ? [{
          label: 'تسوية جديدة',
          icon: <Plus size={15} />,
          variant: 'primary',
          onClick: () => navigate('/fields/harvest-settlement'),
        }] : []}
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-5 max-w-6xl mx-auto w-full">

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter size={14} className="text-slate-400" />
        <div className="flex gap-2">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-[#0F2D5C] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={8} cols={7} />
      ) : !settlements || settlements.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-500 font-medium">لا توجد تسويات</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">التاريخ</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">المحصول / الحقل</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">الموسم</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">التصرف</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">تكلفة WIP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">الإيراد</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">الحالة</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlements.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{s.settlement_date}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-700">{s.crop_name ?? '—'}</div>
                      <div className="text-xs text-slate-400">{s.field_name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{s.season_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {s.disposition === 'stored' ? 'نقل إلى مخزون' : 'بيع مباشر'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(s.total_wip_cost)}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-700">
                      {s.revenue != null ? fmt(s.revenue) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        s.status === 'posted'   ? 'bg-emerald-100 text-emerald-700' :
                        s.status === 'reversed' ? 'bg-slate-100 text-slate-500' :
                                                  'bg-amber-100 text-amber-700'
                      }`}>
                        {s.status === 'posted' ? 'مُرحَّل' : s.status === 'reversed' ? 'معكوس' : 'مسودة'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/fields/crop-cycles/${s.crop_cycle_id}`}
                          className="text-blue-500 hover:text-blue-700 transition-colors"
                          title="عرض الدورة"
                        >
                          <ExternalLink size={13} />
                        </Link>
                        {canWrite && s.status === 'posted' && (
                          <button
                            onClick={() => setReverseId(s.id)}
                            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 transition-colors"
                          >
                            <RotateCcw size={12} />
                            عكس
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary strip */}
      {settlements && settlements.length > 0 && (
        <div className="flex gap-6 text-sm text-slate-500">
          <span>الإجمالي: <span className="font-semibold text-slate-700">{settlements.length}</span></span>
          <span>مُرحَّل: <span className="font-semibold text-emerald-700">{settlements.filter(s => s.status === 'posted').length}</span></span>
          <span>إجمالي تكاليف WIP: <span className="font-semibold text-slate-700">{fmt(settlements.reduce((s, r) => s + r.total_wip_cost, 0))} ج.م</span></span>
        </div>
      )}

      </div>{/* end scroll container */}

      <Modal open={reverseId !== null} onClose={() => { setReverseId(null); setReverseReason('') }} title="عكس تسوية الحصاد" size="sm">
        <p className="text-sm text-slate-500 mb-4">
          سيتم عكس القيود المحاسبية وإعادة رصيد WIP إلى الدورة. ستعود الدورة إلى حالة "نشطة".
        </p>
        <div>
          <label className="label">سبب العكس — اختياري</label>
          <textarea
            value={reverseReason}
            onChange={e => setReverseReason(e.target.value)}
            className="input resize-none"
            rows={2}
            placeholder="سبب عكس التسوية..."
          />
        </div>
        <div className="flex gap-3 justify-end mt-4">
          <button className="btn-secondary" onClick={() => { setReverseId(null); setReverseReason('') }}>
            إلغاء
          </button>
          <button
            onClick={() => reverseMut.mutate(reverseId!)}
            disabled={reverseMut.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            <RotateCcw size={13} />
            {reverseMut.isPending ? 'جاري العكس...' : 'تأكيد العكس'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
