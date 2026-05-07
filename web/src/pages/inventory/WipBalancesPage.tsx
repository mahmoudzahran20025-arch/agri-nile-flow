import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '../../api/core'
import { configApi } from '../../api/client'
import { AlertTriangle, CheckCircle, RefreshCw, ArrowRight } from 'lucide-react'

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
  status: 'pending' | 'carried' | 'closed'
  created_at: string
}

function formatEGP(v: number) {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2 }).format(v)
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'معلق',   cls: 'bg-yellow-100 text-yellow-700' },
  carried: { label: 'محمول',  cls: 'bg-blue-100 text-blue-700' },
  closed:  { label: 'مغلق',   cls: 'bg-gray-100 text-gray-500' },
}

export default function WipBalancesPage() {
  const qc = useQueryClient()
  const [selectedSeasonId, setSelectedSeasonId] = useState('')
  const [carrySeasonId,    setCarrySeasonId]    = useState('')
  const [showCarryPanel,   setShowCarryPanel]   = useState(false)

  const { data: seasons = [] } = useQuery({ queryKey: ['seasons'], queryFn: configApi.seasons })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['wip-balances', selectedSeasonId],
    queryFn:  () => unwrap(api.get<{ data: WipBalance[]; total_cost: number }>(
      `/config/wip${selectedSeasonId ? `?season_id=${selectedSeasonId}&status=all` : '?status=all'}`
    )),
  })

  const balances   = data?.data   ?? []
  const totalCost  = data?.total_cost ?? 0
  const pendingCount = balances.filter(b => b.status === 'pending').length

  const carryMut = useMutation({
    mutationFn: (season_id: number) =>
      unwrap(api.post<{ entries_created: number; entries: unknown[] }>('/config/wip/carry-forward', { season_id })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wip-balances'] })
      setShowCarryPanel(false)
      setCarrySeasonId('')
    },
  })

  const assignMut = useMutation({
    mutationFn: ({ id, to_season_id }: { id: number; to_season_id: number }) =>
      unwrap(api.post<{ id: number; status: string }>(`/config/wip/${id}/assign`, { to_season_id })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wip-balances'] }),
  })

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F2D5C]">أرصدة الإنتاج الجاري (WIP)</h1>
          <p className="text-sm text-gray-500 mt-1">تكاليف المحاصيل غير المكتملة المحمولة بين المواسم</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold text-[#0F2D5C]">{formatEGP(totalCost)} ج.م</div>
            <div className="text-xs text-gray-500">إجمالي الأرصدة</div>
          </div>
          <button
            onClick={() => setShowCarryPanel(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-[#0F2D5C] text-white rounded-lg text-sm hover:bg-[#1a3d6b] transition-colors"
          >
            <ArrowRight size={15} />
            ترحيل WIP
          </button>
        </div>
      </div>

      {/* Carry-forward panel */}
      {showCarryPanel && (
        <div className="border border-indigo-200 bg-indigo-50 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-indigo-800">
            ترحيل أرصدة WIP من موسم منتهٍ
          </p>
          <p className="text-xs text-indigo-600">
            يُنشئ هذه العملية قيوداً محاسبية وسجلات WIP لكل حقل في الموسم المختار لم يُحصَد محصوله بعد.
            آمن للتكرار — القيد لن يُضاعَف.
          </p>
          <div className="flex gap-2">
            <select
              className="border border-indigo-300 rounded-lg px-3 py-2 text-sm flex-1"
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
              className="px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm disabled:opacity-40 hover:bg-indigo-800 transition-colors flex items-center gap-2"
            >
              {carryMut.isPending ? <RefreshCw size={13} className="animate-spin" /> : <ArrowRight size={13} />}
              تنفيذ
            </button>
          </div>
          {carryMut.isSuccess && (
            <p className="text-xs text-emerald-700 font-semibold">
              تم إنشاء {carryMut.data?.entries_created} سجل WIP بنجاح
            </p>
          )}
          {carryMut.isError && (
            <p className="text-xs text-red-600">{(carryMut.error as Error)?.message}</p>
          )}
        </div>
      )}

      {/* Filter by season */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600">فلتر بالموسم:</label>
        <select
          className="border rounded-lg px-3 py-1.5 text-sm"
          value={selectedSeasonId}
          onChange={e => setSelectedSeasonId(e.target.value)}
        >
          <option value="">كل المواسم</option>
          {(seasons as Array<{ id: number; name: string }>).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {pendingCount > 0 && (
        <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-800">
              {pendingCount} رصيد بحاجة إلى تخصيص موسم
            </p>
            <p className="text-xs text-yellow-700 mt-1">
              خصّص هذه الأرصدة للموسم القادم لإكمال دورة التكلفة.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-[#0F2D5C] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isError ? (
        <div className="text-center py-16 text-red-500">فشل تحميل البيانات</div>
      ) : balances.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-400 gap-3">
          <CheckCircle className="w-12 h-12 text-green-400" />
          <p>لا توجد أرصدة إنتاج جاري</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-right p-3">الحقل</th>
                <th className="text-right p-3">المحصول</th>
                <th className="text-right p-3">من موسم</th>
                <th className="text-right p-3">إلى موسم</th>
                <th className="text-right p-3">رصيد التكلفة</th>
                <th className="text-right p-3">الحالة</th>
                <th className="text-right p-3">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {balances.map(b => {
                const s = STATUS_LABELS[b.status] ?? { label: b.status, cls: 'bg-gray-100' }
                return (
                  <tr key={b.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-medium">{b.field_name ?? '—'}</td>
                    <td className="p-3">{b.crop_name}</td>
                    <td className="p-3 text-gray-600">{b.from_season_name ?? '—'}</td>
                    <td className="p-3 text-gray-600">{b.to_season_name ?? '—'}</td>
                    <td className="p-3 font-mono font-semibold">{formatEGP(b.cost_balance)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="p-3">
                      {b.status === 'pending' && (
                        <AssignSeasonCell
                          wipId={b.id}
                          seasons={seasons as Array<{ id: number; name: string }>}
                          onAssign={(to) => assignMut.mutate({ id: b.id, to_season_id: to })}
                          saving={assignMut.isPending}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold">
              <tr>
                <td colSpan={4} className="p-3 text-right">الإجمالي</td>
                <td className="p-3 font-mono">{formatEGP(totalCost)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function AssignSeasonCell({
  wipId, seasons, onAssign, saving,
}: {
  wipId: number
  seasons: Array<{ id: number; name: string }>
  onAssign: (seasonId: number) => void
  saving: boolean
}) {
  const [val, setVal] = useState('')
  return (
    <div className="flex gap-1 items-center">
      <select
        className="border rounded px-2 py-1 text-xs w-36"
        value={val}
        onChange={e => setVal(e.target.value)}
      >
        <option value="">— اختر الموسم —</option>
        {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button
        disabled={!val || saving}
        onClick={() => onAssign(Number(val))}
        className="px-2 py-1 bg-indigo-600 text-white rounded text-xs disabled:opacity-40 hover:bg-indigo-700"
      >
        تخصيص
      </button>
    </div>
  )
}
