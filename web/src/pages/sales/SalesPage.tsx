import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShoppingCart, Plus, X, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { salesApi, type CreateSaleBody, type SaleOrder } from '../../api/sales'
import { inventoryApi } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)

const DATE = (s: string) =>
  new Date(s).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })

type PaymentMethod = 'cash' | 'card' | 'credit'

interface SaleLineForm {
  item_code: string
  quantity: string
  unit_price: string
  discount_pct: string
}

const EMPTY_LINE: SaleLineForm = { item_code: '', quantity: '', unit_price: '', discount_pct: '0' }

function StatusBadge({ status }: { status: string }) {
  if (status === 'paid') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle size={10} /> مدفوع
    </span>
  )
  if (status === 'voided') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
      <XCircle size={10} /> ملغى
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      مفتوح
    </span>
  )
}

export default function SalesPage() {
  const qc = useQueryClient()
  const { canWrite: _canWrite } = usePermission()
  const canWrite = _canWrite('inventory')

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState<{
    sale_date: string
    warehouse_id: string
    payment_method: PaymentMethod
    notes: string
    lines: SaleLineForm[]
  }>({
    sale_date: new Date().toISOString().slice(0, 10),
    warehouse_id: '',
    payment_method: 'cash',
    notes: '',
    lines: [{ ...EMPTY_LINE }],
  })
  const [formErr, setFormErr] = useState<string | null>(null)

  const { data: salesData, isLoading } = useQuery({
    queryKey: ['sales'],
    queryFn:  () => salesApi.listSales({ size: 100 }),
  })

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn:  () => inventoryApi.warehouses(),
  })

  const createMut = useMutation({
    mutationFn: (body: CreateSaleBody) => salesApi.createSale(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['warehouse-balances'] })
      setShowNew(false)
      setForm({ sale_date: new Date().toISOString().slice(0, 10), warehouse_id: '', payment_method: 'cash', notes: '', lines: [{ ...EMPTY_LINE }] })
      setFormErr(null)
    },
    onError: (err: any) => setFormErr(err.message ?? 'حدث خطأ'),
  })

  const voidMut = useMutation({
    mutationFn: (id: number) => salesApi.voidSale(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })

  function addLine() {
    setForm(f => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }))
  }

  function removeLine(idx: number) {
    setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))
  }

  function setLine(idx: number, field: keyof SaleLineForm, value: string) {
    setForm(f => {
      const lines = [...f.lines]
      lines[idx] = { ...lines[idx], [field]: value }
      return { ...f, lines }
    })
  }

  function handleSubmit() {
    setFormErr(null)
    if (!form.warehouse_id) { setFormErr('المخزن مطلوب'); return }
    if (!form.sale_date)    { setFormErr('التاريخ مطلوب'); return }
    if (!form.lines.length) { setFormErr('أضف صنفاً واحداً على الأقل'); return }

    const items = form.lines.map((l, i) => {
      const code = Number(l.item_code)
      const qty  = Number(l.quantity)
      const price = Number(l.unit_price)
      const disc  = Number(l.discount_pct)
      if (!code || !qty || qty <= 0 || price < 0) {
        throw Object.assign(new Error(`السطر ${i + 1}: بيانات غير صحيحة`), {})
      }
      return { item_code: code, quantity: qty, unit_price: price, discount_pct: disc }
    })

    createMut.mutate({
      sale_date:      form.sale_date,
      warehouse_id:   Number(form.warehouse_id),
      payment_method: form.payment_method,
      notes:          form.notes.trim() || undefined,
      items,
    })
  }

  const orders: SaleOrder[] = (salesData as any)?.data ?? salesData ?? []

  const warehouses: Array<{ id: number; name: string }> =
    (warehousesData as any)?.data ?? (Array.isArray(warehousesData) ? warehousesData : [])

  return (
    <div className="space-y-6 p-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShoppingCart size={22} className="text-[#0F2D5C]" />
          <h1 className="text-xl font-bold text-slate-800">المبيعات</h1>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 bg-[#0F2D5C] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1a3f7a] transition-colors"
          >
            <Plus size={16} /> بيع جديد
          </button>
        )}
      </div>

      {/* Sales list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-slate-400" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">لا توجد مبيعات مسجلة</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">#</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">التاريخ</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">العميل</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">المخزن</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">الإجمالي</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">الدفع</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">الحالة</th>
                {canWrite && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{o.id}</td>
                  <td className="px-4 py-3 text-slate-700">{DATE(o.order_date)}</td>
                  <td className="px-4 py-3 text-slate-700">{o.customer_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{o.warehouse_name ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{EGP(o.total)}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    {o.payment_method === 'cash' ? 'نقدي' : o.payment_method === 'card' ? 'بطاقة' : 'آجل'}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  {canWrite && (
                    <td className="px-4 py-3">
                      {o.status !== 'voided' && (
                        <button
                          onClick={() => { if (confirm('هل تريد إلغاء هذا الأمر؟')) voidMut.mutate(o.id) }}
                          className="text-xs text-rose-600 hover:text-rose-800 font-medium"
                        >
                          إلغاء
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New sale modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-10 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">بيع جديد</h2>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Header fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">التاريخ</label>
                  <input
                    type="date"
                    value={form.sale_date}
                    onChange={e => setForm(f => ({ ...f, sale_date: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">المخزن</label>
                  <select
                    value={form.warehouse_id}
                    onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]"
                  >
                    <option value="">اختر المخزن</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">طريقة الدفع</label>
                  <select
                    value={form.payment_method}
                    onChange={e => setForm(f => ({ ...f, payment_method: e.target.value as PaymentMethod }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]"
                  >
                    <option value="cash">نقدي</option>
                    <option value="card">بطاقة</option>
                    <option value="credit">آجل</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">ملاحظات</label>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]"
                    placeholder="اختياري"
                  />
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-600">الأصناف</span>
                  <button
                    onClick={addLine}
                    className="text-xs text-[#0F2D5C] font-medium hover:underline flex items-center gap-1"
                  >
                    <Plus size={13} /> إضافة صنف
                  </button>
                </div>
                <div className="space-y-2">
                  {form.lines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-center">
                      <input
                        type="number"
                        placeholder="كود الصنف"
                        value={line.item_code}
                        onChange={e => setLine(idx, 'item_code', e.target.value)}
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]"
                      />
                      <input
                        type="number"
                        placeholder="الكمية"
                        value={line.quantity}
                        onChange={e => setLine(idx, 'quantity', e.target.value)}
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]"
                      />
                      <input
                        type="number"
                        placeholder="السعر"
                        value={line.unit_price}
                        onChange={e => setLine(idx, 'unit_price', e.target.value)}
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]"
                      />
                      <input
                        type="number"
                        placeholder="خصم %"
                        value={line.discount_pct}
                        onChange={e => setLine(idx, 'discount_pct', e.target.value)}
                        min="0" max="100"
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]"
                      />
                      {form.lines.length > 1 && (
                        <button onClick={() => removeLine(idx)} className="text-rose-400 hover:text-rose-600">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {formErr && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-2">
                  {formErr}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowNew(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
              >
                إلغاء
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMut.isPending}
                className="flex items-center gap-2 bg-[#0F2D5C] text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#1a3f7a] disabled:opacity-60 transition-colors"
              >
                {createMut.isPending && <Loader2 size={14} className="animate-spin" />}
                تأكيد البيع
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
