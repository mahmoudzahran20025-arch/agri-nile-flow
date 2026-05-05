import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShoppingCart, Plus, Loader2, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Truck, Send, X, Package,
  FileText, AlertTriangle, CheckCircle, AlertOctagon, RefreshCw,
} from 'lucide-react'
import {
  financeApi,
  type PurchaseOrder, type POItem, type MatchStatus,
} from '../../api/finance'
import { suppliersApi, configApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import { useToast } from '../../contexts/ToastContext'

// ── Helpers ───────────────────────────────────────────────────
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(n)
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:     { label: 'مسودة',         color: 'bg-gray-100 text-gray-600',       icon: <ShoppingCart size={11} /> },
  sent:      { label: 'مُرسل للمورد', color: 'bg-blue-100 text-blue-700',       icon: <Send size={11} /> },
  partial:   { label: 'استلام جزئي',  color: 'bg-amber-100 text-amber-700',     icon: <Package size={11} /> },
  received:  { label: 'مستلم كامل',   color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={11} /> },
  cancelled: { label: 'ملغي',          color: 'bg-red-100 text-red-600',         icon: <X size={11} /> },
  closed:    { label: 'مغلق',          color: 'bg-slate-100 text-slate-500',     icon: <CheckCircle2 size={11} /> },
}

const MATCH_STATUS_CFG: Record<MatchStatus, { label: string; color: string; icon: React.ReactNode }> = {
  matched:         { label: 'مطابق',          color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle size={11} /> },
  price_variance:  { label: 'فرق سعر',        color: 'bg-amber-100 text-amber-700',    icon: <AlertTriangle size={11} /> },
  qty_variance:    { label: 'فرق كمية',       color: 'bg-orange-100 text-orange-700',  icon: <AlertTriangle size={11} /> },
  over_invoiced:   { label: 'زيادة فوترة',    color: 'bg-red-100 text-red-700',        icon: <AlertOctagon size={11} /> },
  pending_invoice: { label: 'ينتظر فاتورة',   color: 'bg-blue-100 text-blue-700',      icon: <FileText size={11} /> },
  no_gr:           { label: 'لم يُستلم',       color: 'bg-gray-100 text-gray-500',      icon: <Package size={11} /> },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, color: 'bg-gray-100 text-gray-500', icon: null }
  return (
    <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-medium ${s.color}`}>
      {s.icon} {s.label}
    </span>
  )
}

function MatchBadge({ status }: { status: MatchStatus }) {
  const cfg = MATCH_STATUS_CFG[status] ?? MATCH_STATUS_CFG.pending_invoice
  return (
    <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-medium ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

interface POFormItem { item_name: string; unit: string; qty_ordered: string; unit_price: string; center_code: string }
const EMPTY_ITEM: POFormItem = { item_name: '', unit: 'قطعة', qty_ordered: '1', unit_price: '0', center_code: '' }

// ── Three-Way Match Section ───────────────────────────────────
function ThreeWayMatchSection({ poId, onInvoice }: { poId: number; onInvoice: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['po-match', poId],
    queryFn:  () => financeApi.getPOMatch(poId),
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-4 text-gray-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }
  if (!data) return null

  const { match_rows, invoices, po } = data
  const canInvoice = ['partial', 'received'].includes(po.status)
  const allMatched = match_rows.every(r => r.match_status === 'matched')
  const hasVariance = match_rows.some(r => ['price_variance', 'qty_variance', 'over_invoiced'].includes(r.match_status))

  return (
    <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-800">مطابقة ثلاثية: PO → استلام → فاتورة</span>
          {allMatched && (
            <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-medium">✓ مطابق تام</span>
          )}
          {hasVariance && (
            <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">⚠ يوجد فروقات</span>
          )}
        </div>
        {canInvoice && (
          <button
            onClick={onInvoice}
            className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 transition-colors"
          >
            <Plus size={11} /> تسجيل فاتورة
          </button>
        )}
      </div>

      {/* Match table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-gray-500 font-medium border-b border-gray-100">
              <th className="text-right px-4 py-2">الصنف</th>
              <th className="text-center px-3 py-2">مطلوب</th>
              <th className="text-center px-3 py-2">مستلم</th>
              <th className="text-center px-3 py-2">مُفوتر</th>
              <th className="text-center px-3 py-2">سعر PO</th>
              <th className="text-center px-3 py-2">سعر فاتورة</th>
              <th className="text-center px-3 py-2">رقم الفاتورة</th>
              <th className="text-center px-4 py-2">الحالة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {match_rows.map(row => {
              const priceDiff = row.inv_unit_price > 0 ? row.inv_unit_price - row.po_unit_price : 0
              return (
                <tr key={row.po_item_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{row.item_name}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{row.qty_ordered} {row.unit ?? ''}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={row.qty_received >= row.qty_ordered ? 'text-emerald-600 font-medium' : row.qty_received > 0 ? 'text-amber-600' : 'text-gray-400'}>
                      {row.qty_received}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={row.qty_invoiced > 0 ? 'text-indigo-600 font-medium' : 'text-gray-400'}>
                      {row.qty_invoiced}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-gray-600">{fmtCurrency(row.po_unit_price)}</td>
                  <td className="px-3 py-2.5 text-center">
                    {row.inv_unit_price > 0 ? (
                      <span className={priceDiff !== 0 ? (priceDiff > 0 ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium') : 'text-gray-600'}>
                        {fmtCurrency(row.inv_unit_price)}
                        {priceDiff !== 0 && (
                          <span className="mr-1 text-[10px]">({priceDiff > 0 ? '+' : ''}{fmtCurrency(priceDiff)})</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center text-gray-500">
                    {row.invoice_number ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <MatchBadge status={row.match_status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Invoices list */}
      {invoices.length > 0 && (
        <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-500 font-medium mb-1.5">الفواتير المسجلة:</p>
          <div className="flex flex-wrap gap-2">
            {invoices.map(inv => (
              <span key={inv.id} className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-1 text-gray-700">
                <span className="font-medium">{inv.number}</span>
                <span className="text-gray-400 mr-1">· {inv.date} · {fmtCurrency(inv.total)} ج.م</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Invoice Modal ─────────────────────────────────────────────
interface InvItem { po_item_id: number; item_name: string; qty_invoiced: string; unit_price: string }

function InvoiceModal({
  poId, onClose, onSuccess,
}: {
  poId: number; onClose: () => void; onSuccess: () => void
}) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['po-match', poId],
    queryFn:  () => financeApi.getPOMatch(poId),
    staleTime: 30_000,
  })

  const [form, setForm] = useState({
    invoice_number: '',
    invoice_date: new Date().toISOString().slice(0, 10),
    notes: '',
  })
  const [items, setItems] = useState<InvItem[] | null>(null)

  // Pre-fill items once match data loads
  if (data && !items) {
    setItems(
      data.match_rows
        .filter(r => r.match_status !== 'no_gr')
        .map(r => ({
          po_item_id:   r.po_item_id,
          item_name:    r.item_name,
          qty_invoiced: String(Math.max(0, r.qty_received - r.qty_invoiced)),
          unit_price:   String(r.po_unit_price),
        }))
    )
  }

  const mut = useMutation({
    mutationFn: () => financeApi.createInvoice(poId, {
      invoice_number: form.invoice_number,
      invoice_date:   form.invoice_date,
      notes:          form.notes || undefined,
      items: (items ?? [])
        .filter(i => Number(i.qty_invoiced) > 0)
        .map(i => ({
          po_item_id:   i.po_item_id,
          qty_invoiced: Number(i.qty_invoiced),
          unit_price:   Number(i.unit_price),
        })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['po-match', poId] })
      onSuccess()
    },
  })

  const total = (items ?? []).reduce(
    (s, i) => s + (Number(i.qty_invoiced) || 0) * (Number(i.unit_price) || 0), 0
  )
  const hasAnyQty = (items ?? []).some(i => Number(i.qty_invoiced) > 0)

  return (
    <Modal open onClose={onClose} title="تسجيل فاتورة مورد">
      {isLoading || !items ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" size={24} /></div>
      ) : (
        <div className="space-y-4 p-1 max-h-[72vh] overflow-y-auto">
          {/* Header fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">رقم الفاتورة *</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="INV-2024-001"
                value={form.invoice_number}
                onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الفاتورة</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                value={form.invoice_date}
                onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="grid grid-cols-12 gap-1.5 text-xs text-gray-500 font-medium mb-1.5 px-1">
              <span className="col-span-4">الصنف</span>
              <span className="col-span-3 text-center">كمية مُفوترة</span>
              <span className="col-span-3 text-center">سعر الوحدة</span>
              <span className="col-span-2 text-left">الإجمالي</span>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.po_item_id} className="grid grid-cols-12 gap-1.5 items-center bg-gray-50 rounded-lg p-2">
                  <span className="col-span-4 text-sm text-gray-800 font-medium truncate">{item.item_name}</span>
                  <input
                    type="number" min="0" step="any"
                    className="col-span-3 border border-gray-300 rounded px-2 py-1.5 text-sm text-center focus:ring-1 focus:ring-indigo-500"
                    value={item.qty_invoiced}
                    onChange={e => setItems(its => its!.map((it, i) => i === idx ? { ...it, qty_invoiced: e.target.value } : it))}
                  />
                  <input
                    type="number" min="0" step="any"
                    className="col-span-3 border border-gray-300 rounded px-2 py-1.5 text-sm text-center focus:ring-1 focus:ring-indigo-500"
                    value={item.unit_price}
                    onChange={e => setItems(its => its!.map((it, i) => i === idx ? { ...it, unit_price: e.target.value } : it))}
                  />
                  <span className="col-span-2 text-left text-xs text-gray-600 font-medium">
                    {fmtCurrency((Number(item.qty_invoiced) || 0) * (Number(item.unit_price) || 0))}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end text-sm font-bold text-gray-800">
              إجمالي الفاتورة: {fmtCurrency(total)} ج.م
            </div>
          </div>

          {mut.isError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              فشل الحفظ — تأكد من رقم الفاتورة والكميات
            </p>
          )}

          <div className="flex gap-3 pt-2 sticky bottom-0 bg-white pb-1">
            <button
              onClick={() => mut.mutate()}
              disabled={!form.invoice_number.trim() || !hasAnyQty || mut.isPending}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {mut.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              حفظ الفاتورة
            </button>
            <button onClick={onClose} className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════
export default function PurchaseOrdersPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [filterStatus, setFilterStatus] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showReceive, setShowReceive] = useState<PurchaseOrder | null>(null)
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [receiveItems, setReceiveItems] = useState<Array<{
    po_item_id: number; item_name: string; qty_ordered: number
    qty_received_so_far: number; qty_to_receive: string; warehouse: string
  }>>([])
  const [showInvoice, setShowInvoice] = useState<number | null>(null)

  const [form, setForm] = useState({
    supplier_code: '' as string,
    supplier_name: '', order_date: new Date().toISOString().slice(0, 10),
    expected_date: '', notes: '',
  })
  const [formItems, setFormItems] = useState<POFormItem[]>([{ ...EMPTY_ITEM }])

  const { data: poData, isLoading } = useQuery({
    queryKey: ['purchase-orders', filterStatus],
    queryFn:  () => financeApi.getPurchaseOrders(filterStatus ? { status: filterStatus } : undefined),
    staleTime: 30_000,
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list-po'],
    queryFn:  () => suppliersApi.list({ size: 200 }),
    staleTime: 120_000,
  })

  const { data: costCentersData } = useQuery({
    queryKey: ['cost-centers'],
    queryFn:  () => configApi.costCenters(),
    staleTime: 300_000,
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['purchase-order', expandedId],
    queryFn:  () => financeApi.getPurchaseOrder(expandedId!),
    enabled:  !!expandedId,
  })

  const createMut = useMutation({
    mutationFn: () => financeApi.createPurchaseOrder({
      supplier_code:  form.supplier_code ? Number(form.supplier_code) : undefined,
      supplier_name:  form.supplier_name || undefined,
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
          center_code: i.center_code ? Number(i.center_code) : undefined,
        })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setShowCreate(false)
      setForm({ supplier_code: '', supplier_name: '', order_date: new Date().toISOString().slice(0, 10), expected_date: '', notes: '' })
      setFormItems([{ ...EMPTY_ITEM }])
      toast('تم إنشاء طلب الشراء بنجاح', 'success')
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل إنشاء طلب الشراء', 'error'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes?: string }) =>
      financeApi.updatePOStatus(id, status, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['purchase-order', expandedId] })
      toast('تم تحديث حالة الطلب', 'success')
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل تحديث الحالة', 'error'),
  })

  const receiveMut = useMutation({
    mutationFn: ({ poId, received_date, items }: { poId: number; received_date: string; items: Array<{ po_item_id: number; qty_received: number; warehouse: string }> }) =>
      financeApi.receivePO(poId, { received_date, items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['purchase-order', expandedId] })
      setShowReceive(null)
      toast('تم تسجيل الاستلام بنجاح', 'success')
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل تسجيل الاستلام', 'error'),
  })

  function openReceive(po: PurchaseOrder) {
    if (!detail?.items) return
    setReceiveItems(detail.items.map(i => ({
      po_item_id:          i.id,
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

  const kpis: KpiItem[] = [
    { id: 'total',    label: 'إجمالي الطلبات',  value: orders.length,                                          variant: 'default' },
    { id: 'draft',    label: 'مسودة',             value: orders.filter(o => o.status === 'draft').length,        variant: 'warning' },
    { id: 'sent',     label: 'مُرسل',             value: orders.filter(o => o.status === 'sent').length,         variant: 'default' },
    { id: 'received', label: 'مُستلم',           value: orders.filter(o => o.status === 'received').length,     variant: 'success' },
    { id: 'amount',   label: 'الإجمالي ج.م',       value: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(totalAmount), variant: 'default' },
  ]

  const actions: CommandAction[] = [
    {
      id: 'refresh', label: isLoading ? 'Loading…' : 'تحديث',
      icon: <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />,
      onClick: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }), variant: 'secondary',
    },
    {
      id: 'create', label: 'طلب شراء جديد',
      icon: <Plus size={14} />,
      onClick: () => setShowCreate(true),
      variant: 'primary',
    },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <CommandBar actions={actions} />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 animate-fade-in">
      <KpiStrip items={kpis} />

      {/* Status filter */}
      <div className="flex items-center gap-1 rounded-xl bg-white border border-gray-200 p-1 shadow-sm w-fit">
        {[
          { v: '',          l: 'الكل' },
          { v: 'draft',     l: 'مسودة' },
          { v: 'sent',      l: 'مُرسل' },
          { v: 'partial',   l: 'جزئي' },
          { v: 'received',  l: 'مُستلم' },
          { v: 'cancelled', l: 'ملغي' },
        ].map(({ v, l }) => (
          <button
            key={v}
            onClick={() => setFilterStatus(v)}
            className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
              filterStatus === v ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <SectionCard title="طلبات الشراء" icon={<ShoppingCart size={15} />}>

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
                onInvoice={() => setShowInvoice(po.id)}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">المورد</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                value={form.supplier_code}
                onChange={e => {
                  const sel = (suppliersData?.data as Array<{ code: number; name: string }> ?? []).find(s => String(s.code) === e.target.value)
                  setForm(f => ({ ...f, supplier_code: e.target.value, supplier_name: sel?.name ?? '' }))
                }}
              >
                <option value="">— اختر المورد —</option>
                {(suppliersData?.data as Array<{ code: number; name: string }> ?? []).map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
                <option value="__other__">مورد آخر (إدخال يدوي)</option>
              </select>
              {form.supplier_code === '__other__' && (
                <input
                  className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                  placeholder="اسم المورد"
                  value={form.supplier_name}
                  onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))}
                />
              )}
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

            <div className="grid grid-cols-12 gap-1.5 text-xs text-gray-500 font-medium mb-1 px-1">
              <span className="col-span-3">الصنف</span>
              <span className="col-span-2">الوحدة</span>
              <span className="col-span-2">الكمية</span>
              <span className="col-span-2">سعر الوحدة</span>
              <span className="col-span-2">مركز التكلفة</span>
              <span className="col-span-1"></span>
            </div>

            <div className="space-y-1.5">
              {formItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                  <input
                    className="col-span-3 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500"
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
                    className="col-span-2 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500"
                    value={item.unit_price}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, unit_price: e.target.value } : it))}
                  />
                  <select
                    className="col-span-2 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500 bg-white"
                    value={item.center_code}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, center_code: e.target.value } : it))}
                  >
                    <option value="">— مركز —</option>
                    {(costCentersData as Array<{ code: number; name: string }> ?? []).map(cc => (
                      <option key={cc.code} value={cc.code}>{cc.name}</option>
                    ))}
                  </select>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-0.5 block font-medium">تاريخ الاستلام</label>
                <input
                  type="date"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-500"
                  value={receiveDate}
                  onChange={e => setReceiveDate(e.target.value)}
                />
              </div>
              <div className="flex items-end text-xs text-gray-400 pb-2">
                سجل الكميات المستلمة والمخزن لكل صنف:
              </div>
            </div>
            <div className="space-y-3">
              {receiveItems.map((item, idx) => (
                <div key={item.po_item_id} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50">
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
                  received_date: receiveDate,
                  items: receiveItems
                    .filter(i => Number(i.qty_to_receive) > 0)
                    .map(i => ({
                      po_item_id:   i.po_item_id,
                      qty_received: Number(i.qty_to_receive),
                      warehouse:    i.warehouse || 'المخزن الرئيسي', // default if empty
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

      {/* Invoice Modal */}
      {showInvoice && (
        <InvoiceModal
          poId={showInvoice}
          onClose={() => setShowInvoice(null)}
          onSuccess={() => setShowInvoice(null)}
        />
      )}
      </SectionCard>
      </div>
    </div>
  )
}

// ── PO Row ────────────────────────────────────────────────────
function PORow({
  po, expanded, detail, detailLoading,
  onToggle, onStatus, onReceive, onInvoice, statusPending,
}: {
  po: PurchaseOrder
  expanded: boolean
  detail: (PurchaseOrder & { items: POItem[] }) | null
  detailLoading: boolean
  onToggle: () => void
  onStatus: (status: string, notes?: string) => void
  onReceive: () => void
  onInvoice: () => void
  statusPending: boolean
}) {
  const canSend    = po.status === 'draft'
  const canReceive = ['sent', 'partial'].includes(po.status)
  const canCancel  = ['draft', 'sent'].includes(po.status)
  const showMatch  = ['partial', 'received', 'closed'].includes(po.status)

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

              {/* 3-Way Match section */}
              {showMatch && (
                <ThreeWayMatchSection poId={po.id} onInvoice={onInvoice} />
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 mt-4">
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
