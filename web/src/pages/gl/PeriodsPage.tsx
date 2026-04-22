import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { glApi } from '../../api/client'
import {
  Lock, Unlock, Plus, CalendarDays,
  Loader2, AlertTriangle,
} from 'lucide-react'
import Modal from '../../components/ui/Modal'

interface FinancialPeriod {
  id: number; company_id: number
  name: string; period_type: string
  start_date: string; end_date: string
  is_closed: number; closed_at?: string; closed_by?: number
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  monthly: 'شهرية', quarterly: 'ربع سنوية', annual: 'سنوية',
}

function statusChip(p: FinancialPeriod) {
  return p.is_closed
    ? <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
        <Lock size={11} /> مغلقة
      </span>
    : <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
        <Unlock size={11} /> مفتوحة
      </span>
}

const PERIOD_TYPES = ['monthly','quarterly','annual']

export default function PeriodsPage() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [confirmClose, setConfirmClose] = useState<FinancialPeriod | null>(null)
  const [form, setForm] = useState({
    name: '', period_type: 'monthly', start_date: '', end_date: '',
  })

  const { data: periods = [], isLoading } = useQuery({
    queryKey: ['gl-periods'],
    queryFn:  () => glApi.periods() as Promise<FinancialPeriod[]>,
  })

  const createMut = useMutation({
    mutationFn: () => glApi.createPeriod(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
      setShowAdd(false)
      setForm({ name: '', period_type: 'monthly', start_date: '', end_date: '' })
    },
  })

  const closeMut = useMutation({
    mutationFn: (id: number) => glApi.closePeriod(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
      setConfirmClose(null)
    },
  })

  const reopenMut = useMutation({
    mutationFn: (id: number) => glApi.reopenPeriod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gl-periods'] }),
  })

  // Quick-fill form for current month
  function prefillCurrentMonth() {
    const now = new Date()
    const y   = now.getFullYear()
    const m   = String(now.getMonth() + 1).padStart(2, '0')
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate()
    const monthNames = ['','يناير','فبراير','مارس','إبريل','مايو','يونيو',
                        'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']
    setForm({
      name: `${monthNames[now.getMonth() + 1]} ${y}`,
      period_type: 'monthly',
      start_date: `${y}-${m}-01`,
      end_date:   `${y}-${m}-${lastDay}`,
    })
  }

  const open   = periods.filter(p => !p.is_closed)
  const closed = periods.filter(p =>  p.is_closed)

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">الفترات المالية</h1>
          <p className="text-sm text-gray-500 mt-0.5 hidden sm:block">
            إدارة فتح وإغلاق الفترات المحاسبية — القيود محجوبة على الفترات المغلقة
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); prefillCurrentMonth() }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} /> <span className="hidden sm:inline">فترة جديدة</span><span className="sm:hidden">جديدة</span>
        </button>
      </div>

      {/* Alert: No open periods */}
      {!isLoading && open.length === 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle size={20} className="text-amber-500 shrink-0" />
          <div>
            <p className="font-semibold text-amber-800">لا توجد فترات مالية مفتوحة</p>
            <p className="text-sm text-amber-700">لن يتم قبول أي قيود أو معاملات حتى تفتح فترة جديدة</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-400">
          <Loader2 className="animate-spin" size={32} />
        </div>
      ) : (
        <>
          {/* Open periods */}
          {open.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Unlock size={14} className="text-emerald-500" /> الفترات المفتوحة
              </h2>
              <div className="space-y-2">
                {open.map(p => (
                  <PeriodRow
                    key={p.id} period={p}
                    onClose={() => setConfirmClose(p)}
                    onReopen={() => {/* already open */}}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Closed periods */}
          {closed.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Lock size={14} className="text-red-400" /> الفترات المغلقة ({closed.length})
              </h2>
              <div className="space-y-2">
                {closed.map(p => (
                  <PeriodRow
                    key={p.id} period={p}
                    onClose={() => {}}
                    onReopen={() => reopenMut.mutate(p.id)}
                    reopening={reopenMut.isPending}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Create Period Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="إضافة فترة مالية جديدة">
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">اسم الفترة</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              placeholder="مثال: يناير 2026"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">نوع الفترة</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
              value={form.period_type}
              onChange={e => setForm(f => ({ ...f, period_type: e.target.value }))}
            >
              {PERIOD_TYPES.map(t => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ البداية</label>
              <input
                type="date" value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ النهاية</label>
              <input
                type="date" value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.name || !form.start_date || !form.end_date || createMut.isPending}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              إنشاء الفترة
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Close Modal */}
      {confirmClose && (
        <Modal open={!!confirmClose} onClose={() => setConfirmClose(null)} title="تأكيد إغلاق الفترة المالية">
          <div className="space-y-4 p-1">
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">هذا الإجراء غير قابل للتراجع بسهولة</p>
                <p className="text-sm text-red-700 mt-1">
                  بعد إغلاق الفترة <strong>{confirmClose.name}</strong>، لن يُقبل أي قيد أو معاملة بتاريخ يقع ضمنها.
                  سيتطلب إعادة الفتح صلاحيات خاصة.
                </p>
              </div>
            </div>
            <div className="text-sm text-gray-600">
              <p><span className="font-medium">الفترة:</span> {confirmClose.name}</p>
              <p><span className="font-medium">من:</span> {confirmClose.start_date} <span className="font-medium mx-2">إلى:</span> {confirmClose.end_date}</p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => closeMut.mutate(confirmClose.id)}
                disabled={closeMut.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {closeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                نعم، أغلق الفترة
              </button>
              <button
                onClick={() => setConfirmClose(null)}
                className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Period Row Component ───────────────────────────────────────
function PeriodRow({
  period, onClose, onReopen, reopening,
}: {
  period: FinancialPeriod
  onClose:  () => void
  onReopen: () => void
  reopening?: boolean
}) {
  return (
    <div className={`
      flex items-start sm:items-center gap-3 p-4 rounded-xl border transition-all
      ${period.is_closed
        ? 'bg-gray-50 border-gray-200'
        : 'bg-white border-emerald-200 shadow-sm'}
    `}>
      <div className={`p-2 rounded-xl flex-shrink-0 ${period.is_closed ? 'bg-gray-100' : 'bg-emerald-50'}`}>
        <CalendarDays size={18} className={period.is_closed ? 'text-gray-400' : 'text-emerald-600'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-800">{period.name}</span>
          {statusChip(period)}
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-md">{TYPE_LABELS[period.period_type] ?? period.period_type}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          <span className="font-medium">{period.start_date}</span>
          <span className="mx-1.5 text-gray-300">→</span>
          <span className="font-medium">{period.end_date}</span>
          {period.closed_at && (
            <span className="mr-2 text-gray-400"> · أُغلقت {period.closed_at.slice(0,10)}</span>
          )}
        </p>
      </div>

      <div className="flex-shrink-0">
        {period.is_closed ? (
          <button
            onClick={onReopen}
            disabled={reopening}
            className="flex items-center gap-1.5 text-xs border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg px-3 py-2 transition-colors"
          >
            {reopening ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
            <span className="hidden sm:inline">إعادة فتح</span><span className="sm:hidden">فتح</span>
          </button>
        ) : (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 rounded-lg px-3 py-2 transition-colors"
          >
            <Lock size={12} />
            <span className="hidden sm:inline">إغلاق الفترة</span><span className="sm:hidden">إغلاق</span>
          </button>
        )}
      </div>
    </div>
  )
}
