import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, RefreshCw, AlertTriangle, CheckCircle, Clock, FileText, RotateCcw } from 'lucide-react'
import { inventoryApi } from '../../api/client'

const NUM = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)
const MONEY = (n: number) => new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2 }).format(n)

const GL_STATUS_META: Record<string, { label: string; cls: string }> = {
  posted:            { label: 'مُرحَّل',     cls: 'bg-green-100 text-green-700' },
  pending:           { label: 'في الانتظار', cls: 'bg-amber-100 text-amber-700' },
  failed:            { label: 'فشل',        cls: 'bg-red-100 text-red-700' },
  exempt_zero_value: { label: 'معفى (قيمة صفر)', cls: 'bg-slate-100 text-slate-500' },
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const [reversing, setReversing] = useState(false)
  const [reverseError, setReverseError] = useState<string | null>(null)
  const [reverseSuccess, setReverseSuccess] = useState(false)

  const handleReverse = useCallback(async (lines: Array<{ id: number }>) => {
    if (!window.confirm('هل تريد عكس هذه المعاملة بالكامل؟ سيتم إنشاء حركات عكسية لكل سطر.')) return
    setReversing(true)
    setReverseError(null)
    try {
      for (const line of lines) {
        await inventoryApi.reverseMovement(line.id)
      }
      setReverseSuccess(true)
      qc.invalidateQueries({ queryKey: ['inventory', 'transaction', id] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
    } catch (err: any) {
      setReverseError(err?.message ?? 'فشل العكس')
    } finally {
      setReversing(false)
    }
  }, [id, qc])

  const { data: txn, isLoading, isError, refetch } = useQuery({
    queryKey: ['inventory', 'transaction', id],
    queryFn: () => inventoryApi.transactionDetail(Number(id)),
    enabled: !!id,
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <RefreshCw size={20} className="animate-spin mr-2" /> جاري التحميل...
      </div>
    )
  }

  if (isError || !txn) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center space-y-3">
        <AlertTriangle size={32} className="text-red-400 mx-auto" />
        <p className="text-slate-600">تعذّر تحميل بيانات المعاملة</p>
        <div className="flex gap-2 justify-center">
          <button className="btn-secondary" onClick={() => refetch()}>إعادة المحاولة</button>
          <button className="btn-secondary" onClick={() => navigate(-1)}>رجوع</button>
        </div>
      </div>
    )
  }

  const totalQty   = txn.lines.reduce((s, l) => s + l.quantity, 0)
  const totalValue = txn.lines.reduce((s, l) => s + Math.max(l.value_in, l.value_out), 0)
  const allPosted  = txn.lines.every(l => l.gl_posting_status === 'posted' || l.gl_posting_status === 'exempt_zero_value')
  const anyFailed  = txn.lines.some(l => l.gl_posting_status === 'failed')

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* ── Breadcrumb / back ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button
          onClick={() => navigate('/inventory/transactions')}
          className="flex items-center gap-1 hover:text-brand-600 transition-colors"
        >
          <ArrowRight size={14} /> المعاملات
        </button>
        <span>/</span>
        <span className="text-slate-800 font-medium">#{txn.id}</span>
      </div>

      {/* ── Header card ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
              <FileText size={18} className="text-brand-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">
                {txn.transaction_type}
                {txn.document_number && <span className="text-slate-400 font-normal mr-2">#{txn.document_number}</span>}
              </h1>
              <p className="text-sm text-slate-400">{txn.movement_date} · {txn.warehouse}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {allPosted && !anyFailed
              ? <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700"><CheckCircle size={12} /> مُرحَّل بالكامل</span>
              : anyFailed
              ? <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700"><AlertTriangle size={12} /> يوجد أسطر فاشلة</span>
              : <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700"><Clock size={12} /> في انتظار الترحيل</span>
            }
            {!reverseSuccess && (
              <button
                onClick={() => handleReverse(txn.lines)}
                disabled={reversing}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                <RotateCcw size={12} />
                {reversing ? 'جاري العكس...' : 'عكس المعاملة'}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {[
            { label: 'عدد الأصناف',  value: txn.line_count },
            { label: 'إجمالي الكمية', value: NUM(totalQty) },
            { label: 'إجمالي القيمة', value: `${MONEY(totalValue)} ج.م` },
            { label: 'المخزن المصدر', value: txn.warehouse },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-50 rounded-xl p-3">
              <div className="text-[11px] text-slate-400 mb-0.5">{label}</div>
              <div className="text-sm font-bold text-slate-800">{value}</div>
            </div>
          ))}
        </div>

        {txn.to_warehouse && (
          <div className="text-sm text-slate-600">
            <span className="text-slate-400">إلى مخزن: </span>
            <span className="font-medium">{txn.to_warehouse}</span>
          </div>
        )}
        {txn.notes && (
          <p className="text-sm text-slate-500 italic border-t border-slate-100 pt-3">{txn.notes}</p>
        )}
      </div>

      {/* ── Reversal feedback ─────────────────────────────────────────────── */}
      {reverseSuccess && (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
          <CheckCircle size={16} className="shrink-0" />
          <span className="font-medium">تم إنشاء الحركات العكسية بنجاح.</span>
          <button
            onClick={() => navigate('/inventory/transactions')}
            className="mr-auto text-xs underline hover:no-underline"
          >
            عرض جميع المعاملات
          </button>
        </div>
      )}
      {reverseError && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          {reverseError}
        </div>
      )}

      {/* ── Lines table ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">أسطر الحركة</h2>
          <span className="text-xs text-slate-400">{txn.lines.length} سطر</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-right px-4 py-2.5 font-medium text-slate-500">الصنف</th>
                <th className="text-center px-3 py-2.5 font-medium text-slate-500">الكمية</th>
                <th className="text-center px-3 py-2.5 font-medium text-slate-500">سعر الوحدة</th>
                <th className="text-center px-3 py-2.5 font-medium text-slate-500">القيمة</th>
                <th className="text-center px-3 py-2.5 font-medium text-slate-500">رصيد ما بعد</th>
                <th className="text-center px-3 py-2.5 font-medium text-slate-500">حالة القيد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {txn.lines.map(line => {
                const value = Math.max(line.value_in, line.value_out)
                const statusMeta = GL_STATUS_META[line.gl_posting_status ?? 'pending'] ?? { label: line.gl_posting_status ?? '—', cls: 'bg-slate-100 text-slate-500' }
                return (
                  <tr key={line.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{line.item_name ?? `#${line.item_code}`}</div>
                      {line.unit && <div className="text-xs text-slate-400">{line.unit}</div>}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-slate-700">{NUM(line.quantity)}</td>
                    <td className="px-3 py-3 text-center text-slate-600">
                      {line.unit_price != null ? MONEY(line.unit_price) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center font-medium text-slate-700">{MONEY(value)}</td>
                    <td className="px-3 py-3 text-center text-slate-500">{NUM(line.balance_qty)}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusMeta.cls}`}>
                        {statusMeta.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
