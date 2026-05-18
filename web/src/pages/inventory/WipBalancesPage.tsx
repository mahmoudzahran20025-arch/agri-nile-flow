import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, unwrap } from '../../api/core'
import { configApi } from '../../api/client'
import {
  AlertTriangle, CheckCircle, RefreshCw, ArrowRight,
  BookOpen, Clock,
} from 'lucide-react'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { CommandBar } from '../../components/ui/CommandBar'

interface WipBalance {
  id: number
  from_season_id: number
  from_season_name: string | null
  to_season_id: number | null
  to_season_name: string | null
  field_id: number
  field_name: string | null
  crop_name: string
  cost_balance: number
  journal_entry_id: number | null
  status: 'pending' | 'carried' | 'closed'
  created_at: string
}

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

const STATUS_CONFIG: Record<WipBalance['status'], { label: string; cls: string; icon: React.ReactNode }> = {
  pending: {
    label: 'معلق — بانتظار تخصيص الموسم',
    cls:   'bg-amber-50 text-amber-700 border border-amber-200',
    icon:  <Clock size={11} />,
  },
  carried: {
    label: 'محمول إلى موسم قادم',
    cls:   'bg-blue-50 text-blue-700 border border-blue-200',
    icon:  <ArrowRight size={11} />,
  },
  closed: {
    label: 'مغلق',
    cls:   'bg-slate-100 text-slate-500 border border-slate-200',
    icon:  <CheckCircle size={11} />,
  },
}

function StatusBadge({ status }: { status: WipBalance['status'] }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.cls}`}>
      {cfg.icon} {STATUS_CONFIG[status].label.split(' — ')[0]}
    </span>
  )
}

function AssignSeasonCell({
  seasons, onAssign, saving,
}: {
  seasons: Array<{ id: number; name: string }>
  onAssign: (seasonId: number) => void
  saving: boolean
}) {
  const [val, setVal] = useState('')
  return (
    <div className="flex gap-1.5 items-center">
      <select
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs min-w-[130px]"
        value={val}
        onChange={e => setVal(e.target.value)}
      >
        <option value="">— اختر الموسم القادم —</option>
        {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button
        disabled={!val || saving}
        onClick={() => onAssign(Number(val))}
        className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors flex items-center gap-1"
      >
        {saving ? <RefreshCw size={10} className="animate-spin" /> : <ArrowRight size={10} />}
        تخصيص
      </button>
    </div>
  )
}

export default function WipBalancesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [selectedSeasonId, setSelectedSeasonId] = useState('')
  const [statusFilter, setStatusFilter]         = useState<'all' | 'pending' | 'carried' | 'closed'>('all')
  const [carrySeasonId, setCarrySeasonId]       = useState('')
  const [showCarryPanel, setShowCarryPanel]     = useState(false)

  const { data: seasons = [] } = useQuery({ queryKey: ['seasons'], queryFn: configApi.seasons })

  const qs = new URLSearchParams({ status: statusFilter })
  if (selectedSeasonId) qs.set('season_id', selectedSeasonId)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['wip-balances', selectedSeasonId, statusFilter],
    queryFn:  () => unwrap(api.get<{ data: WipBalance[]; total_cost: number }>(
      `/config/wip?${qs.toString()}`
    )),
  })

  const balances    = data?.data     ?? []
  const totalCost   = data?.total_cost ?? 0
  const pendingCount = balances.filter(b => b.status === 'pending').length
  const carriedCount = balances.filter(b => b.status === 'carried').length

  const carryMut = useMutation({
    mutationFn: (season_id: number) =>
      unwrap(api.post<{ entries_created: number; entries: unknown[] }>('/config/wip/carry-forward', { season_id })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wip-balances'] })
      setCarrySeasonId('')
    },
  })

  const assignMut = useMutation({
    mutationFn: ({ id, to_season_id }: { id: number; to_season_id: number }) =>
      unwrap(api.post<{ id: number; status: string }>(`/config/wip/${id}/assign`, { to_season_id })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wip-balances'] }),
  })

  return (
    <div className="flex flex-col h-full" dir="rtl">
      <CommandBar
        title="أرصدة الإنتاج الجاري (WIP)"
        subtitle="تكاليف المحاصيل غير المكتملة المحمولة بين المواسم"
        actions={[{
          label: showCarryPanel ? 'إخفاء الترحيل' : 'ترحيل WIP جديد',
          icon: <ArrowRight size={14} />,
          variant: showCarryPanel ? 'secondary' : 'primary',
          onClick: () => setShowCarryPanel(v => !v),
        }]}
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-5" dir="rtl">

      {/* Carry-forward panel */}
      {showCarryPanel && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-blue-900">إنشاء أرصدة WIP من موسم</p>
            <p className="text-xs text-blue-700 mt-1">
              تُحلَّل حقول الموسم المختار ويُنشأ رصيد WIP لكل حقل لم يُحصَد محصوله.
              العملية آمنة للتكرار — لن تُضاعَف القيود إذا نُفِّذت مرتين.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <select
              className="rounded-xl border border-blue-300 bg-white px-3 py-2 text-sm flex-1 max-w-xs"
              value={carrySeasonId}
              onChange={e => setCarrySeasonId(e.target.value)}
            >
              <option value="">— اختر الموسم المصدر —</option>
              {(seasons as Array<{ id: number; name: string }>).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              disabled={!carrySeasonId || carryMut.isPending}
              onClick={() => carryMut.mutate(Number(carrySeasonId))}
              className="px-4 py-2 bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-blue-800 transition-colors flex items-center gap-2"
            >
              {carryMut.isPending ? <RefreshCw size={13} className="animate-spin" /> : <ArrowRight size={13} />}
              تنفيذ الترحيل
            </button>
          </div>
          {carryMut.isSuccess && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
              <CheckCircle size={15} />
              تم إنشاء {carryMut.data?.entries_created} سجل WIP وقيودهم المحاسبية بنجاح
            </div>
          )}
          {carryMut.isError && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              <AlertTriangle size={15} />
              {(carryMut.error as Error)?.message?.replace(/^Error:\s*/i, '') ?? 'فشل الترحيل'}
            </div>
          )}
        </div>
      )}

      {/* Pending assignment alert */}
      {pendingCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {pendingCount} رصيد WIP لم يُخصَّص بعد لموسم قادم
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              خصّص كل رصيد للموسم القادم لإكمال دورة التكلفة وربط المصروفات بالمحصول الصحيح.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          value={selectedSeasonId}
          onChange={e => setSelectedSeasonId(e.target.value)}
        >
          <option value="">كل المواسم</option>
          {(seasons as Array<{ id: number; name: string }>).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">كل الحالات</option>
          <option value="pending">معلق ({pendingCount})</option>
          <option value="carried">محمول ({carriedCount})</option>
          <option value="closed">مغلق</option>
        </select>
      </div>

      {/* Content */}
      {isLoading && <TableSkeleton rows={5} cols={7} />}

      {isError && (
        <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          تعذّر تحميل أرصدة WIP — تأكد من صحة الاتصال وأذونات الوصول
        </div>
      )}

      {!isLoading && !isError && balances.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-12 text-center">
          <CheckCircle className="mx-auto w-10 h-10 text-emerald-400 mb-3" />
          <p className="text-sm font-medium text-slate-600">لا توجد أرصدة WIP في هذه الفترة</p>
          <p className="text-xs text-slate-400 mt-1">جميع المحاصيل إما مكتملة أو لم تبدأ بعد</p>
        </div>
      )}

      {balances.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm text-right">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {['الحقل', 'المحصول', 'من موسم', 'إلى موسم', 'رصيد التكلفة', 'القيد المحاسبي', 'الحالة', 'إجراء'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {balances.map(b => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{b.field_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{b.crop_name}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{b.from_season_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {b.to_season_name ?? <span className="text-amber-500">غير محدد</span>}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800">{EGP(b.cost_balance)}</td>
                  <td className="px-4 py-3">
                    {b.journal_entry_id ? (
                      <button
                        onClick={() => navigate(`/gl/entries?id=${b.journal_entry_id}`)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-mono hover:underline"
                        title="فتح القيد في دفتر الأستاذ"
                      >
                        <BookOpen size={11} />
                        #{b.journal_entry_id}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3">
                    {b.status === 'pending' && (
                      <AssignSeasonCell
                        seasons={seasons as Array<{ id: number; name: string }>}
                        onAssign={to => assignMut.mutate({ id: b.id, to_season_id: to })}
                        saving={assignMut.isPending}
                      />
                    )}
                    {b.status === 'carried' && (
                      <span className="text-xs text-slate-400">محمول — لا إجراء مطلوب</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50">
              <tr className="font-semibold text-slate-700">
                <td colSpan={4} className="px-4 py-3">الإجمالي ({balances.length} سجل)</td>
                <td className="px-4 py-3 font-mono">{EGP(totalCost)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      </div>{/* end scroll container */}
    </div>
  )
}
