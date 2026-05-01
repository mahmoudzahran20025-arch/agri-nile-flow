import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Clock, Loader2, CheckCircle2, AlertTriangle,
  AlertOctagon, X, CreditCard, RefreshCw, ExternalLink,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { financeApi, type APAgingRow } from '../../api/finance'
import Modal from '../../components/ui/Modal'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'

// ── Helpers ───────────────────────────────────────────────────
function egp(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0 }).format(n)
}

function ageBucket(days: number): {
  label: string; color: string; bg: string; border: string; icon: React.ReactNode
} {
  if (days <= 0)  return { label: 'جاري (غير مستحق)', color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200', icon: <CheckCircle2 size={13} /> }
  if (days <= 30) return { label: '1–30 يوم',          color: 'text-blue-700',    bg: 'bg-blue-50',     border: 'border-blue-200',    icon: <Clock        size={13} /> }
  if (days <= 60) return { label: '31–60 يوم',         color: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200',   icon: <AlertTriangle size={13} /> }
  if (days <= 90) return { label: '61–90 يوم',         color: 'text-orange-700',  bg: 'bg-orange-50',   border: 'border-orange-200',  icon: <AlertTriangle size={13} /> }
  return               { label: '+90 يوم',             color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200',     icon: <AlertOctagon  size={13} /> }
}

// ════════════════════════════════════════════════════════════
export default function APAgingPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [payModal, setPayModal] = useState<APAgingRow | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ap-aging'],
    queryFn:  financeApi.getAPAging,
    staleTime: 30_000,
  })

  // Bucket totals
  const buckets = [
    { key: 'current', label: 'جاري',      filter: (r: APAgingRow) => r.days_overdue <= 0   },
    { key: '1-30',    label: '1–30 يوم',  filter: (r: APAgingRow) => r.days_overdue > 0  && r.days_overdue <= 30  },
    { key: '31-60',   label: '31–60 يوم', filter: (r: APAgingRow) => r.days_overdue > 30 && r.days_overdue <= 60  },
    { key: '61-90',   label: '61–90 يوم', filter: (r: APAgingRow) => r.days_overdue > 60 && r.days_overdue <= 90  },
    { key: '90+',     label: '+90 يوم',   filter: (r: APAgingRow) => r.days_overdue > 90 },
  ]

  const total = rows.reduce((s, r) => s + r.outstanding, 0)

  const bucketTotals = buckets.map(b => ({
    ...b,
    rows: rows.filter(b.filter),
    total: rows.filter(b.filter).reduce((s, r) => s + r.outstanding, 0),
  }))

  const kpis: KpiItem[] = [
    { id: 'total',   label: 'إجمالي المستحق',   value: egp(total),   variant: total > 0 ? 'warning' : 'success' },
    { id: 'current', label: 'جاري',              value: egp(bucketTotals[0].total), variant: 'success' },
    { id: '1-30',    label: '1–30 يوم',          value: egp(bucketTotals[1].total), variant: bucketTotals[1].total > 0 ? 'warning' : 'default' },
    { id: '31-90',   label: '31–90 يوم',         value: egp(bucketTotals[2].total + bucketTotals[3].total), variant: (bucketTotals[2].total + bucketTotals[3].total) > 0 ? 'warning' : 'default' },
    { id: '90+',     label: '+90 يوم',           value: egp(bucketTotals[4].total), variant: bucketTotals[4].total > 0 ? 'warning' : 'default' },
  ]

  const actions: CommandAction[] = [
    {
      id: 'refresh', label: isLoading ? 'Loading…' : 'تحديث',
      icon: <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />,
      onClick: () => qc.invalidateQueries({ queryKey: ['ap-aging'] }), variant: 'secondary',
    },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <CommandBar actions={actions} />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 animate-fade-in">
      <KpiStrip items={kpis} />

      {/* Table */}
      <SectionCard title="مستحقات الموردين" icon={<CreditCard size={15} />}>
      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-400">
          <Loader2 className="animate-spin" size={36} />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} className="text-emerald-500" />
          </div>
          <h3 className="text-lg font-bold text-gray-700 mb-1">لا توجد ذمم مستحقة</h3>
          <p className="text-sm text-gray-400">جميع فواتير الموردين مسددة بالكامل</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-semibold">
                  <th className="text-right px-5 py-3">المورد</th>
                  <th className="text-right px-4 py-3">الفاتورة</th>
                  <th className="text-center px-4 py-3">تاريخ الفاتورة</th>
                  <th className="text-center px-4 py-3">تاريخ الاستحقاق</th>
                  <th className="text-center px-4 py-3">الحالة</th>
                  <th className="text-left px-4 py-3">الإجمالي</th>
                  <th className="text-left px-4 py-3">مسدد</th>
                  <th className="text-left px-4 py-3">المتبقي</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(row => {
                  const bucket = ageBucket(row.days_overdue)
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">{row.supplier_name ?? '—'}</p>
                        {row.po_number && (
                          <p className="text-xs text-gray-400">{row.po_number}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{row.invoice_number}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{row.invoice_date}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{row.due_date}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 font-medium border ${bucket.bg} ${bucket.color} ${bucket.border}`}>
                          {bucket.icon}
                          {row.days_overdue > 0 ? `${row.days_overdue} يوم` : bucket.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left font-medium text-gray-800">{egp(row.total_amount)}</td>
                      <td className="px-4 py-3 text-left">
                        <span className={row.paid_amount > 0 ? 'text-emerald-600 font-medium' : 'text-gray-300'}>
                          {egp(row.paid_amount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left font-bold text-gray-900">{egp(row.outstanding)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPayModal(row)}
                          className="flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-2.5 py-1.5 transition-colors whitespace-nowrap"
                        >
                          <CreditCard size={11} /> تسجيل دفعة
                        </button>
                        <button
                          onClick={() => navigate(`/gl/entries?ref_type=supplier_transaction&source_code=${row.supplier_code}`)}
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-2.5 py-1.5 transition-colors whitespace-nowrap hover:bg-indigo-50"
                          title="View related GL entries"
                        >
                          <ExternalLink size={11} /> GL
                        </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-sm">
                  <td colSpan={5} className="px-5 py-3 text-gray-600">الإجمالي ({rows.length} فاتورة)</td>
                  <td className="px-4 py-3 text-left text-gray-800">{egp(rows.reduce((s,r)=>s+r.total_amount,0))}</td>
                  <td className="px-4 py-3 text-left text-emerald-700">{egp(rows.reduce((s,r)=>s+r.paid_amount,0))}</td>
                  <td className="px-4 py-3 text-left text-gray-900">{egp(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Pay modal */}
      {payModal && (
        <PayModal
          row={payModal}
          onClose={() => setPayModal(null)}
          onSuccess={() => {
            const code = payModal?.supplier_code
            setPayModal(null)
            qc.invalidateQueries({ queryKey: ['ap-aging'] })
            qc.invalidateQueries({ queryKey: ['treasury'] })
            if (code) {
              qc.invalidateQueries({ queryKey: ['supplier-statement', code] })
              qc.invalidateQueries({ queryKey: ['supplier-summary',   code] })
              qc.invalidateQueries({ queryKey: ['supplier',           code] })
            }
          }}
        />
      )}
      </SectionCard>
      </div>
    </div>
  )
}

// ── Pay Modal ─────────────────────────────────────────────────
function PayModal({
  row, onClose, onSuccess,
}: {
  row: APAgingRow; onClose: () => void; onSuccess: () => void
}) {
  const [amount,  setAmount]  = useState(String(row.outstanding))
  const [date,    setDate]    = useState(new Date().toISOString().slice(0, 10))
  const [ref,     setRef]     = useState('')

  const mut = useMutation({
    mutationFn: () => financeApi.payInvoice(row.id, {
      paid_amount:  Number(amount),
      payment_date: date,
      payment_ref:  ref || undefined,
    }),
    onSuccess,
  })

  const bucket = ageBucket(row.days_overdue)

  return (
    <Modal open onClose={onClose} title="تسجيل دفعة للمورد">
      <div className="space-y-5 p-1">
        {/* Invoice summary */}
        <div className={`flex items-start gap-3 p-4 rounded-xl border ${bucket.border} ${bucket.bg}`}>
          <div className={`mt-0.5 ${bucket.color}`}>{bucket.icon}</div>
          <div className="flex-1">
            <p className={`font-bold text-sm ${bucket.color}`}>
              {row.supplier_name ?? 'مورد'} — {row.invoice_number}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              تاريخ الاستحقاق: {row.due_date}
              {row.days_overdue > 0 && ` · متأخر ${row.days_overdue} يوم`}
            </p>
          </div>
          <div className="text-left shrink-0">
            <p className="text-xs text-gray-400">المتبقي</p>
            <p className="font-bold text-gray-900">{new Intl.NumberFormat('en-US',{minimumFractionDigits:0}).format(row.outstanding)} ج.م</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">مبلغ الدفعة *</label>
            <div className="flex items-center gap-2">
              <input
                type="number" min="0.01" step="any" max={row.outstanding}
                className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
              <button
                onClick={() => setAmount(String(row.outstanding))}
                className="text-xs text-indigo-600 hover:text-indigo-700 whitespace-nowrap px-2"
              >
                كل المبلغ
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الدفع</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">رقم المرجع</label>
              <input
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="شيك / تحويل"
                value={ref}
                onChange={e => setRef(e.target.value)}
              />
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
          سيُنشأ قيد محاسبي تلقائياً: مدين الموردون / دائن الخزينة
        </p>

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => mut.mutate()}
            disabled={!amount || Number(amount) <= 0 || mut.isPending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {mut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            تسجيل الدفعة
          </button>
          <button onClick={onClose} className="px-4 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1">
            <X size={13} /> إلغاء
          </button>
        </div>
      </div>
    </Modal>
  )
}
