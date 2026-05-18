/**
 * PosPage — Retail POS cashier interface.
 *
 * Flow:
 *   1. Open / resume a cashier session
 *   2. Add items (by item_code or list search) with quantity and price
 *   3. Select payment method, enter tendered amount for cash
 *   4. Confirm sale → receipt summary with change
 *   5. Close session with closing count
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShoppingBag, Plus, Minus, Trash2, CheckCircle,
  X, Loader2, DollarSign, CreditCard, FileText, Lock, Printer,
} from 'lucide-react'
import { posApi, type PosSaleResult } from '../../api/pos'
import { inventoryApi } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)

type PaymentMethod = 'cash' | 'card' | 'credit'

interface CartLine {
  item_code:   number
  item_name:   string
  unit:        string | null
  quantity:    number
  unit_price:  number
  discount_pct: number
}

export default function PosPage() {
  const qc = useQueryClient()
  usePermission() // ensure hook is called for future permission checks

  // Session state
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [warehouseId, setWarehouseId]         = useState('')
  const [openFloat, setOpenFloat]             = useState('')
  const [showCloseModal, setShowCloseModal]   = useState(false)
  const [closingCount, setClosingCount]       = useState('')

  // Cart state
  const [cart, setCart]               = useState<CartLine[]>([])
  const [itemCodeInput, setItemCodeInput] = useState('')
  const [qtyInput, setQtyInput]       = useState('1')
  const [priceInput, setPriceInput]   = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [tendered, setTendered]       = useState('')

  // Receipt state
  const [lastReceipt, setLastReceipt] = useState<PosSaleResult | null>(null)
  const [cartErr, setCartErr]         = useState<string | null>(null)

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn:  () => inventoryApi.warehouses(),
  })

  const warehouses: Array<{ id: number; name: string }> =
    (warehousesData as any)?.data ?? (Array.isArray(warehousesData) ? warehousesData : [])

  // Existing open session
  const { data: sessionsData } = useQuery({
    queryKey: ['pos-sessions', 'open'],
    queryFn:  () => posApi.listSessions({ status: 'open' }),
    enabled:  !activeSessionId,
  })

  const openSessions = (sessionsData as any)?.data ?? sessionsData ?? []

  const sessionSummary = useQuery({
    queryKey: ['pos-session-summary', activeSessionId],
    queryFn:  () => posApi.getSessionSummary(activeSessionId!),
    enabled:  !!activeSessionId,
    refetchInterval: 30_000,
  })

  const openSessionMut = useMutation({
    mutationFn: ({ opening_float }: { opening_float: number }) =>
      posApi.openSession({ opening_float }),
    onSuccess: (data) => {
      setActiveSessionId((data as any).session_id ?? data)
      qc.invalidateQueries({ queryKey: ['pos-sessions'] })
    },
  })

  const closeSessionMut = useMutation({
    mutationFn: () => posApi.closeSession(activeSessionId!, closingCount ? Number(closingCount) : undefined),
    onSuccess: () => {
      setActiveSessionId(null)
      setCart([])
      setShowCloseModal(false)
      qc.invalidateQueries({ queryKey: ['pos-sessions'] })
    },
  })

  const saleMut = useMutation({
    mutationFn: () =>
      posApi.createSale({
        session_id:    activeSessionId!,
        warehouse_id:  Number(warehouseId),
        payment_method: paymentMethod,
        tendered:      paymentMethod === 'cash' && tendered ? Number(tendered) : undefined,
        items: cart.map(l => ({
          item_code:    l.item_code,
          quantity:     l.quantity,
          unit_price:   l.unit_price,
          discount_pct: l.discount_pct,
        })),
      }),
    onSuccess: (result) => {
      setLastReceipt(result)
      setCart([])
      setTendered('')
      setCartErr(null)
      qc.invalidateQueries({ queryKey: ['pos-session-summary', activeSessionId] })
      qc.invalidateQueries({ queryKey: ['warehouse-balances'] })
    },
    onError: (err: any) => setCartErr(err.message ?? 'حدث خطأ'),
  })

  function addToCart() {
    const code  = Number(itemCodeInput)
    const qty   = Number(qtyInput)
    const price = Number(priceInput)
    if (!code || qty <= 0 || price < 0) {
      setCartErr('كود الصنف والكمية والسعر مطلوبون')
      return
    }
    setCartErr(null)
    const existing = cart.findIndex(l => l.item_code === code)
    if (existing >= 0) {
      const updated = [...cart]
      updated[existing] = { ...updated[existing], quantity: updated[existing].quantity + qty }
      setCart(updated)
    } else {
      setCart(c => [...c, {
        item_code: code, item_name: `صنف ${code}`,
        unit: null, quantity: qty, unit_price: price, discount_pct: 0,
      }])
    }
    setItemCodeInput('')
    setQtyInput('1')
    setPriceInput('')
  }

  function removeLine(idx: number) {
    setCart(c => c.filter((_, i) => i !== idx))
  }

  function adjustQty(idx: number, delta: number) {
    setCart(c => {
      const updated = [...c]
      const newQty = updated[idx].quantity + delta
      if (newQty <= 0) return c.filter((_, i) => i !== idx)
      updated[idx] = { ...updated[idx], quantity: newQty }
      return updated
    })
  }

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.unit_price * (1 - l.discount_pct / 100), 0)
  const total    = Math.round(subtotal * 100) / 100
  const change   = paymentMethod === 'cash' && tendered ? Math.round((Number(tendered) - total) * 100) / 100 : null

  const summary = (sessionSummary.data as any)?.data ?? sessionSummary.data

  // ── Render: no session ────────────────────────────────────────────────────────
  if (!activeSessionId) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6" dir="rtl">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 space-y-6">
          <div className="flex items-center gap-3">
            <ShoppingBag size={28} className="text-[#0F2D5C]" />
            <h1 className="text-xl font-bold text-slate-800">نقطة البيع</h1>
          </div>

          {openSessions.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-600">استئناف جلسة مفتوحة</p>
              {openSessions.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className="w-full flex items-center justify-between border border-slate-200 rounded-xl px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <span className="text-sm font-medium text-slate-700">جلسة #{s.id}</span>
                  <span className="text-xs text-slate-500">{s.opened_at?.slice(0, 16)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-600">فتح جلسة جديدة</p>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">المخزن</label>
              <select
                value={warehouseId}
                onChange={e => setWarehouseId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">اختر المخزن</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">رصيد افتتاحي (اختياري)</label>
              <input
                type="number" value={openFloat}
                onChange={e => setOpenFloat(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="0"
              />
            </div>
            <button
              onClick={() => openSessionMut.mutate({ opening_float: Number(openFloat) || 0 })}
              disabled={!warehouseId || openSessionMut.isPending}
              className="w-full bg-[#0F2D5C] text-white font-semibold py-3 rounded-xl hover:bg-[#1a3f7a] disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {openSessionMut.isPending && <Loader2 size={16} className="animate-spin" />}
              فتح الجلسة
            </button>
            {openSessionMut.error && (
              <p className="text-sm text-rose-600">{(openSessionMut.error as any).message}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Render: receipt modal ─────────────────────────────────────────────────────
  if (lastReceipt) {
    const r = lastReceipt.receipt
    const receiptDate = new Date().toLocaleString('ar-EG')
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 print:bg-white print:p-0 print:block" dir="rtl">
        {/* print:contents ensures only receipt-inner is rendered on print */}
        <style>{`@media print { body * { visibility: hidden } #pos-receipt, #pos-receipt * { visibility: visible } #pos-receipt { position: absolute; inset: 0; padding: 16px; } }`}</style>

        <div id="pos-receipt" className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 print:shadow-none print:rounded-none print:max-w-full">
          {/* Screen-only header with close icon */}
          <div className="flex items-center justify-between print:hidden">
            <div className="flex items-center gap-2">
              <CheckCircle size={22} className="text-emerald-600" />
              <span className="font-bold text-slate-800">تم البيع</span>
            </div>
            <span className="text-xs text-slate-500">أمر #{lastReceipt.order_id}</span>
          </div>

          {/* Print header */}
          <div className="hidden print:block text-center pb-2 border-b border-dashed border-slate-300">
            <p className="font-bold text-lg">فاتورة بيع</p>
            <p className="text-xs text-slate-500">رقم الأمر: #{lastReceipt.order_id}</p>
            <p className="text-xs text-slate-500">{receiptDate}</p>
          </div>

          <div className="border-t border-dashed border-slate-200 pt-3 space-y-1">
            {r.lines.map((l, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-slate-700">{l.item_name} × {l.qty}</span>
                <span className="font-medium">{EGP(l.total)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>المجموع قبل الضريبة</span>
              <span>{EGP(r.subtotal)}</span>
            </div>
            {(r.tax ?? 0) > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>ضريبة القيمة المضافة {r.vat_pct ? `(${r.vat_pct}%)` : ''}</span>
                <span>{EGP(r.tax)}</span>
              </div>
            )}
            {r.vat_number && (
              <div className="text-xs text-slate-400 print:block hidden">
                رقم تسجيل ضريبي: {r.vat_number}
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-slate-100 pt-1">
              <span>الإجمالي</span>
              <span>{EGP(r.total)}</span>
            </div>
            {r.tendered != null && (
              <>
                <div className="flex justify-between text-slate-600">
                  <span>المدفوع</span>
                  <span>{EGP(r.tendered)}</span>
                </div>
                {(r.change ?? 0) >= 0 && (
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>الباقي</span>
                    <span>{EGP(r.change ?? 0)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Print footer */}
          <div className="hidden print:block text-center pt-2 border-t border-dashed border-slate-300 text-xs text-slate-400">
            شكراً لتعاملكم معنا
          </div>

          <div className="flex gap-3 print:hidden">
            <button
              onClick={() => window.print()}
              className="flex-1 border border-slate-300 text-slate-700 font-semibold py-3 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-2"
            >
              <Printer size={16} /> طباعة
            </button>
            <button
              onClick={() => setLastReceipt(null)}
              className="flex-1 bg-[#0F2D5C] text-white font-semibold py-3 rounded-xl hover:bg-[#1a3f7a]"
            >
              بيع جديد
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: active session cashier ────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-slate-100 overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="bg-[#0F2D5C] text-white px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <ShoppingBag size={20} />
          <span className="font-bold">نقطة البيع — جلسة #{activeSessionId}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {summary && (
            <span className="opacity-80">
              مبيعات اليوم: {EGP((summary.totals?.gross_sales as number) ?? 0)}
            </span>
          )}
          <button
            onClick={() => setShowCloseModal(true)}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Lock size={14} /> إغلاق الجلسة
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Cart */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden border-l border-slate-200">
          <div className="p-4 border-b border-slate-100 flex-shrink-0">
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="كود الصنف"
                value={itemCodeInput}
                onChange={e => setItemCodeInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addToCart()}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="number"
                placeholder="الكمية"
                value={qtyInput}
                onChange={e => setQtyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addToCart()}
                className="w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="number"
                placeholder="السعر"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addToCart()}
                className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={addToCart}
                className="bg-[#0F2D5C] text-white px-3 py-2 rounded-lg hover:bg-[#1a3f7a]"
              >
                <Plus size={18} />
              </button>
            </div>
            {cartErr && <p className="text-xs text-rose-600 mt-1">{cartErr}</p>}
          </div>

          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                لم تتم إضافة أصناف بعد
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-right px-4 py-2 font-semibold text-slate-500">الصنف</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-500">الكمية</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-500">السعر</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-500">الإجمالي</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-700">{l.item_name}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => adjustQty(idx, -1)} className="p-1 rounded hover:bg-slate-100"><Minus size={12} /></button>
                          <span className="w-8 text-center font-medium">{l.quantity}</span>
                          <button onClick={() => adjustQty(idx, 1)} className="p-1 rounded hover:bg-slate-100"><Plus size={12} /></button>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-700">{EGP(l.unit_price)}</td>
                      <td className="px-4 py-2 font-semibold">{EGP(l.quantity * l.unit_price)}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => removeLine(idx)} className="text-rose-400 hover:text-rose-600"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Checkout panel */}
        <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col flex-shrink-0 p-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>المجموع الفرعي</span><span>{EGP(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>الضريبة</span><span>{EGP(0)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg border-t border-slate-100 pt-2">
              <span>الإجمالي</span><span className="text-[#0F2D5C]">{EGP(total)}</span>
            </div>
          </div>

          {/* Payment method */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500">طريقة الدفع</p>
            <div className="grid grid-cols-3 gap-1">
              {([['cash', 'نقدي', <DollarSign size={14} />], ['card', 'بطاقة', <CreditCard size={14} />], ['credit', 'آجل', <FileText size={14} />]] as const).map(([m, label, icon]) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    paymentMethod === m
                      ? 'bg-[#0F2D5C] text-white border-[#0F2D5C]'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'cash' && (
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">المبلغ المدفوع</label>
              <input
                type="number"
                value={tendered}
                onChange={e => setTendered(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder={String(total)}
              />
              {change != null && (
                <p className={`text-sm font-semibold mt-1 ${change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  الباقي: {EGP(change)}
                </p>
              )}
            </div>
          )}

          <div className="mt-auto space-y-2">
            <button
              onClick={() => saleMut.mutate()}
              disabled={cart.length === 0 || !warehouseId || saleMut.isPending}
              className="w-full bg-emerald-600 text-white font-bold py-4 rounded-xl hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-2 text-base"
            >
              {saleMut.isPending && <Loader2 size={18} className="animate-spin" />}
              تأكيد البيع
            </button>
            {!warehouseId && (
              <p className="text-xs text-amber-600 text-center">اختر المخزن عند فتح الجلسة</p>
            )}
            <button
              onClick={() => setCart([])}
              disabled={cart.length === 0}
              className="w-full text-slate-500 text-sm hover:text-slate-700 py-2 flex items-center justify-center gap-1.5"
            >
              <X size={14} /> مسح السلة
            </button>
          </div>
        </div>
      </div>

      {/* Close session modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-bold text-slate-800">إغلاق الجلسة</h2>
            {summary && (
              <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-1">
                <div className="flex justify-between"><span>إجمالي المبيعات</span><span className="font-semibold">{EGP((summary.totals?.gross_sales as number) ?? 0)}</span></div>
                <div className="flex justify-between"><span>عدد الفواتير</span><span>{summary.order_count}</span></div>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">رصيد إغلاق الخزينة (اختياري)</label>
              <input
                type="number" value={closingCount}
                onChange={e => setClosingCount(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCloseModal(false)} className="flex-1 border border-slate-300 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                إلغاء
              </button>
              <button
                onClick={() => closeSessionMut.mutate()}
                disabled={closeSessionMut.isPending}
                className="flex-1 bg-rose-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-rose-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {closeSessionMut.isPending && <Loader2 size={14} className="animate-spin" />}
                إغلاق الجلسة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
