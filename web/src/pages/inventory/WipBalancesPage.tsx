import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../../api/core'
import { AlertTriangle, CheckCircle } from 'lucide-react'

interface WipBalance {
  id: number
  from_season_id: number
  from_season_name: string
  to_season_id: number | null
  to_season_name: string | null
  field_id: number
  field_name: string
  crop_name: string
  cost_balance: number
  status: 'pending' | 'carried' | 'closed'
  created_at: string
}

interface WipListResponse {
  balances: WipBalance[]
  total_cost: number
}

function formatEGP(v: number) {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2 }).format(v)
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'معلق',    cls: 'bg-yellow-100 text-yellow-700' },
  carried: { label: 'محمول',   cls: 'bg-blue-100 text-blue-700' },
  closed:  { label: 'مغلق',    cls: 'bg-gray-100 text-gray-500' },
}

export default function WipBalancesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['wip-balances'],
    queryFn: () => unwrap(api.get<WipListResponse>('/config/wip')),
  })

  const balances = data?.balances ?? []
  const totalCost = data?.total_cost ?? 0
  const pendingCount = balances.filter(b => b.status === 'pending').length

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0F2D5C]">أرصدة الإنتاج الجاري (WIP)</h1>
          <p className="text-sm text-gray-500 mt-1">
            تكاليف المحاصيل غير المكتملة المحمولة بين المواسم
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[#0F2D5C]">{formatEGP(totalCost)} ج.م</div>
          <div className="text-xs text-gray-500">إجمالي الأرصدة</div>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-800">
              {pendingCount} رصيد بحاجة إلى تخصيص موسم
            </p>
            <p className="text-xs text-yellow-700 mt-1">
              يجب تخصيص هذه الأرصدة للموسم القادم لإكمال دورة التكلفة.
              التخصيص يتم عند إغلاق الموسم من شاشة الإعدادات.
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
          <p>لا توجد أرصدة إنتاج جاري معلقة</p>
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
                <th className="text-right p-3">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {balances.map(b => {
                const s = STATUS_LABELS[b.status] ?? { label: b.status, cls: 'bg-gray-100' }
                return (
                  <tr key={b.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-medium">{b.field_name}</td>
                    <td className="p-3">{b.crop_name}</td>
                    <td className="p-3 text-gray-600">{b.from_season_name}</td>
                    <td className="p-3 text-gray-600">{b.to_season_name ?? '—'}</td>
                    <td className="p-3 font-mono font-semibold">{formatEGP(b.cost_balance)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="p-3 text-xs text-gray-400">{b.created_at.slice(0, 10)}</td>
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
