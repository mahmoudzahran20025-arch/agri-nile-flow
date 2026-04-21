import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShoppingCart, Plus, Loader2, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Truck, Send, X, Package,
} from 'lucide-react'
import { financeApi, type PurchaseOrder, type POItem } from '../../api/finance'
import Modal from '../../components/ui/Modal'

// ── Helpers ───────────────────────────────────────────────────
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2 }).format(n)
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:     { label: 'مسودة',         color: 'bg-gray-100 text-gray-600',    icon: <ShoppingCart size={11} /> },
  sent:      { label: 'مُرسل للمورد', color: 'bg-blue-100 text-blue-700',    icon: <Send size={11} /> },
  partial:   { label: 'استلام جزئي',  color: 'bg-amber-100 text-amber-700',  icon: <Package size={11} /> },
  received:  { label: 'مستلم كامل',   color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={11} /> },
  cancelled: { label: 'ملغي',          color: 'bg-red-100 text-red-600',      icon: <X size={11} /> },
  closed:    { label: 'مغلق',          color: 'bg-slate-100 text-slate-500',  icon: <CheckCircle2 size={11} /> },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, color: 'bg-gray-100 text-gray-500', icon: null }
  return (
    <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-medium ${s.color}`}>
      {s.icon} {s.label}
    </span>
  )
}

interface POFormItem {
  item_name: string; unit: string; qty_ordered: string; unit_price: string
}

const EMPTY_ITEM: POFormItem = { item_name: '', unit: 'قطعة', qty_ordered: '1', unit_price: '0' }

// ════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════
export default function PurchaseOrdersPage() {
  const qc = useQueryClient()
  const [filterStatus, setFilterStatus] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showReceive, setShowReceive] = useState<PurchaseOrder | null>(null)
  const [receiveItems, setReceiveItems] = useState<Array<{ item_id: number; item_name: string; qty_ordered: number; qty_received_so_far: number; qty_to_receive: string; warehouse: string }>>([])

  const [form, setForm] = useState({
    supplier_name: '', order_date: new Date().toISOString().slice(0, 10),
    expected_date: '', notes: '',
  })
  const [formItems, setFormItems] = useState<POFormItem[]>([{ ...EMPTY_ITEM }])

  const { data: poData, isLoading } = useQuery({
    queryKey: ['purchase-orders', filterStatus],
    queryFn:  () => financeApi.getPurchaseOrders(filterStatus ? { status: filterStatus } : undefined),
    staleTime: 30_000,
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['purchase-order', expandedId],
    queryFn:  () => financeApi.getPurchaseOrder(expandedId!),
    enabled:  !!expandedId,
  })

  const createMut = useMutation({
    mutationFn: () => financeApi.createPurchaseOrder({
      supplier_name: form.supplier_name || undefined,
      order_date:    form.order_date,
      expected_date: form.expected_date || undefined,
      notes:         form.notes || undefined,
      items: formItems
        .filter(i => i.item_name.trim())
        .map(i => ({
          item_name:   i.item_name,
          unit:        i.unit || undefined,
          qty_ordered: Number(i.qty_ordered) || 1,
          unit_price:  Number(i.unit_price) || 0,
        })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setShowCreate(false)
      setForm({ supplier_name: '', order_date: new Date().toISOString().slice(0, 10), expected_date: '', notes: '' })
      setFormItems([{ ...EMPTY_ITEM }])
    },
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes?: string }) =>
      financeApi.updatePOStatus(id, status, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['purchase-order', expandedId] })
    },
  })

  const receiveMut = useMutation({
    mutationFn: ({ poId, items }: { poId: number; items: Array<{ item_id: number; qty_received: number; warehouse?: string }> }) =>
      financeApi.receivePO(poId, items),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['purchase-order', expandedId] })
      setShowReceive(null)
    },
  })

  function openReceive(po: PurchaseOrder) {
    if (!detail?.items) return
    setReceiveItems(detail.items.map(i => ({
      item_id:             i.id,
      item_name:           i.item_name,
      qty_ordered:         i.qty_ordered,
      qty_received_so_far: i.qty_received,
      qty_to_receive:      String(i.qty_ordered - i.qty_received),
      warehouse:           i.warehouse ?? '',
    })))
    setShowReceive(po)
  }

  const orders: PurchaseOrder[] = poData ?? []
  const totalAmount = orders.reduce((s, o) => s + o.total_amount, 0)

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">طلبات الشراء</h1>
          <p className="text-sm text-gray-500 mt-0.5">إنشاء وإدارة أوامر الشراء من الموردين</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} /> طلب شراء جديد
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {['', 'draft', 'sent', 'partial', 'received'].map(s => {
          const count = s ? orders.filter(o => o.status === s).length : orders.length
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(s === filterStatus ? '' : s)}
              className={`
                p-3 rounded-xl border text-right transition-all
                ${filterStatus === s && s !== ''
                  ? 'border-brand-500 bg-brand-50 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-brand-200'}
              `}
            >
              <p className="text-xl font-bold text-gray-800">{count}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {s === '' ? 'إجمالي الطلبات' : STATUS_MAP[s]?.label ?? s}
              </p>
            </button>
          )
        })}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12 text-gray-400"><Loader2 className="animate-spin" size={32} /></div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">لا توجد طلبات شراء</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50">
            {orders.map(po => (
              <PORow
                key={po.id}
                po={po}
                expanded={expandedId === po.id}
                detail={expandedId === po.id ? detail ?? null : null}
                detailLoading={detailLoading && expandedId === po.id}
                onToggle={() => setExpandedId(expandedId === po.id ? null : po.id)}
                onStatus={(status, notes) => statusMut.mutate({ id: po.id, status, notes })}
                onReceive={() => openReceive(po)}
                statusPending={statusMut.isPending}
              />
            ))}
          </div>
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-between text-sm">
            <span className="text-gray-500">{orders.length} طلب</span>
            <span className="font-bold text-gray-800">الإجمالي: {fmtCurrency(totalAmount)} ج.م</span>
          </div>
        </div>
      )}

      {/* Create PO Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="طلب شراء جديد">
        <div className="space-y-4 p-1 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">اسم المورد</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                placeholder="اسم شركة / مورد"
                value={form.supplier_name}
                onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الطلب</label>
              <input type="date" value={form.order_date}
                onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ التسليم المتوقع</label>
              <input type="date" value={form.expected_date}
                onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">البنود</label>
              <button
                onClick={() => setFormItems(items => [...items, { ...EMPTY_ITEM }])}
                className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
              >
                <Plus size={12} /> إضافة بند
              </button>
            </div>

            {/* Items Header */}
            <div className="grid grid-cols-12 gap-1.5 text-xs text-gray-500 font-medium mb-1 px-1">
              <span className="col-span-4">الصنف</span>
              <span className="col-span-2">الوحدة</span>
              <span className="col-span-2">الكمية</span>
              <span className="col-span-3">سعر الوحدة</span>
              <span className="col-span-1"></span>
            </div>

            <div className="space-y-1.5">
              {formItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                  <input
                    className="col-span-4 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500"
                    placeholder="اسم الصنف"
                    value={item.item_name}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, item_name: e.target.value } : it))}
                  />
                  <input
                    className="col-span-2 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500"
                    placeholder="وحدة"
                    value={item.unit}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it))}
                  />
                  <input
                    type="number" min="0.01" step="any"
                    className="col-span-2 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500"
                    value={item.qty_ordered}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, qty_ordered: e.target.value } : it))}
                  />
                  <input
                    type="number" min="0" step="any"
                    className="col-span-3 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500"
                    value={item.unit_price}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, unit_price: e.target.value } : it))}
                  />
                  <button
                    onClick={() => setFormItems(items => items.filter((_, i) => i !== idx))}
                    disabled={formItems.length === 1}
                    className="col-span-1 flex justify-center text-gray-300 hover:text-red-400 disabled:opacity-20 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Total preview */}
            <div className="mt-3 flex justify-end text-sm font-bold text-gray-700">
              الإجمالي:{' '}
              {fmtCurrency(formItems.reduce((s, i) => s + (Number(i.qty_ordered) || 0) * (Number(i.unit_price) || 0), 0))} ج.م
            </div>
          </div>

          <div className="flex gap-3 pt-2 sticky bottom-0 bg-white pb-1">
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.order_date || formItems.every(i => !i.item_name.trim()) || createMut.isPending}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              إنشاء طلب الشراء
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          </div>
        </div>
      </Modal>

      {/* Receive Modal */}
      {showReceive && (
        <Modal open={!!showReceive} onClose={() => setShowReceive(null)} title={`استلام — ${showReceive.po_number}`}>
          <div className="space-y-4 p-1">
            <p className="text-sm text-gray-600">أدخل الكميات المستلمة فعلياً والمخزن لكل صنف:</p>
            <div className="space-y-3">
              {receiveItems.map((item, idx) => (
                <div key={item.item_id} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50">
                  <p className="text-sm font-medium text-gray-800">{item.item_name}</p>
                  <p className="text-xs text-gray-400">
                    مطلوب: {item.qty_ordered} · مستلم سابقاً: {item.qty_received_so_far}
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-28">
                      <label className="text-xs text-gray-500 mb-0.5 block">الكمية</label>
                      <input
                        type="number" min="0" step="any"
                        max={item.qty_ordered - item.qty_received_so_far}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 text-center"
                        value={item.qty_to_receive}
                        onChange={e => setReceiveItems(items => items.map((it, i) => i === idx ? { ...it, qty_to_receive: e.target.value } : it))}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-0.5 block">المخزن</label>
                      <input
                        type="text"
                        placeholder="مثال: مخزن رقم 1"
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-500"
                        value={item.warehouse}
                        onChange={e => setReceiveItems(items => items.map((it, i) => i === idx ? { ...it, warehouse: e.target.value } : it))}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => receiveMut.mutate({
                  poId: showReceive.id,
                  items: receiveItems
                    .filter(i => Number(i.qty_to_receive) > 0)
                    .map(i => ({
                      item_id:      i.item_id,
                      qty_received: Number(i.qty_to_receive),
                      warehouse:    i.warehouse || undefined,
                    })),
                })}
                disabled={receiveItems.every(i => !Number(i.qty_to_receive)) || receiveMut.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {receiveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                تسجيل الاستلام
              </button>
              <button onClick={() => setShowReceive(null)} className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── PO Row ────────────────────────────────────────────────────
function PORow({
  po, expanded, detail, detailLoading,
  onToggle, onStatus, onReceive, statusPending,
}: {
  po: PurchaseOrder
  expanded: boolean
  detail: (PurchaseOrder & { items: POItem[] }) | null
  detailLoading: boolean
  onToggle: () => void
  onStatus: (status: string, notes?: string) => void
  onReceive: () => void
  statusPending: boolean
}) {
  const canSend     = po.status === 'draft'
  const canReceive  = ['sent','partial'].includes(po.status)
  const canCancel   = ['draft','sent'].includes(po.status)

  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-4 px-5 py-4 text-right hover:bg-gray-50 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-800">{po.po_number}</span>
            <StatusBadge status={po.status} />
            {po.supplier_name && (
              <span className="text-sm text-gray-500">{po.supplier_name}</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {po.order_date}
            {po.expected_date && ` · تسليم: ${po.expected_date}`}
            {po.item_count != null && ` · ${po.item_count} صنف`}
          </p>
        </div>
        <div className="text-left shrink-0">
          <p className="font-bold text-gray-800">{fmtCurrency(po.total_amount)}</p>
          <p className="text-xs text-gray-400">ج.م</p>
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 bg-gray-50 border-t border-gray-100">
          {detailLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-gray-400" size={20} /></div>
          ) : (
            <>
              {/* Items table */}
              {detail?.items && detail.items.length > 0 && (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-xs text-gray-500 font-medium">
                      <th className="text-right pb-2">الصنف</th>
                      <th className="text-center pb-2">الوحدة</th>
                      <th className="text-center pb-2">مطلوب</th>
                      <th className="text-center pb-2">مستلم</th>
                      <th className="text-left pb-2">إجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail.items.map(item => {
                      const pct = item.qty_ordered > 0 ? (item.qty_received / item.qty_ordered) * 100 : 0
                      return (
                        <tr key={item.id}>
                          <td className="py-1.5 text-gray-800 font-medium">
                            {item.item_name}
                            {item.item_code && <span className="text-gray-400 text-xs mr-1">({item.item_code})</span>}
                          </td>
                          <td className="py-1.5 text-center text-gray-500">{item.unit ?? '—'}</td>
                          <td className="py-1.5 text-center">{item.qty_ordered}</td>
                          <td className="py-1.5 text-center">
                            <span className={pct >= 100 ? 'text-emerald-600 font-medium' : pct > 0 ? 'text-amber-600' : 'text-gray-400'}>
                              {item.qty_received}
                            </span>
                          </td>
                          <td className="py-1.5 text-left text-gray-700">{fmtCurrency(item.total_price)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                {canSend && (
                  <button
                    onClick={() => onStatus('sent')}
                    disabled={statusPending}
                    className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                  >
                    <Send size={12} /> إرسال للمورد
                  </button>
                )}
                {canReceive && (
                  <button
                    onClick={onReceive}
                    className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <Truck size={12} /> تسجيل استلام
                  </button>
                )}
                {canCancel && (
                  <button
                    onClick={() => onStatus('cancelled')}
                    disabled={statusPending}
                    className="flex items-center gap-1.5 text-xs border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <XCircle size={12} /> إلغاء الطلب
                  </button>
                )}
                {po.status === 'received' && (
                  <button
                    onClick={() => onStatus('closed')}
                    disabled={statusPending}
                    className="flex items-center gap-1.5 text-xs border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <CheckCircle2 size={12} /> إغلاق الطلب
                  </button>
                )}
              </div>

              {po.notes && (
                <p className="text-xs text-gray-400 mt-3 border-t border-gray-100 pt-2">ملاحظة: {po.notes}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
