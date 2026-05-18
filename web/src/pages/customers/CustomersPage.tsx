import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Plus, Search, Edit2, Trash2, ChevronDown, ChevronUp,
  X, Loader2, AlertCircle, Banknote, BarChart2, CheckCircle,
} from 'lucide-react'
import { customersApi, type Customer, type CustomerPayment } from '../../api/customers'
import { api, unwrap } from '../../api/core'
import { usePermission } from '../../hooks/usePermission'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)

const DATE = (s: string) =>
  new Date(s).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })

interface FormState { code: string; name: string; phone: string; credit_limit: string; tier_id: string }
const EMPTY_FORM: FormState = { code: '', name: '', phone: '', credit_limit: '0', tier_id: '' }

function StatusBadge({ active }: { active: number }) {
  return active
    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">نشط</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">موقوف</span>
}

// ── Collect Modal ─────────────────────────────────────────────────────────────
function CollectModal({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount]           = useState(customer.balance > 0 ? String(Math.round(customer.balance * 100) / 100) : '')
  const [method, setMethod]           = useState<'cash' | 'card' | 'bank_transfer' | 'cheque'>('cash')
  const [reference, setReference]     = useState('')
  const [notes, setNotes]             = useState('')
  const [date, setDate]               = useState(new Date().toISOString().slice(0, 10))
  const [err, setErr]                 = useState<string | null>(null)
  const [done, setDone]               = useState<{ new_balance: number } | null>(null)

  const mut = useMutation({
    mutationFn: () => customersApi.collect(customer.id, {
      amount:         Number(amount),
      payment_date:   date,
      payment_method: method,
      reference:      reference.trim() || undefined,
      notes:          notes.trim() || undefined,
    }),
    onSuccess: (res) => { setDone({ new_balance: res.new_balance }); onSaved() },
    onError:   (e: Error) => setErr(e.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const n = Number(amount)
    if (!n || n <= 0) { setErr('المبلغ يجب أن يكون أكبر من صفر'); return }
    if (n > customer.balance + 0.01) { setErr('المبلغ يتجاوز الرصيد المديون'); return }
    mut.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-slate-800">تحصيل دفعة</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <CheckCircle size={40} className="text-emerald-500 mx-auto mb-3" />
            <p className="font-bold text-slate-800 mb-1">تم تسجيل الدفعة</p>
            <p className="text-sm text-slate-500">الرصيد المتبقي: <span className="font-semibold text-amber-600">{EGP(done.new_balance)}</span></p>
            <button onClick={onClose} className="mt-4 px-6 py-2 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium">إغلاق</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-sm">
              <span className="text-amber-700">الرصيد المديون: </span>
              <span className="font-bold text-amber-800">{EGP(customer.balance)}</span>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">المبلغ (ج.م) *</label>
              <input
                type="number" min="0.01" step="0.01"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={amount} onChange={e => setAmount(e.target.value)} dir="ltr"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">طريقة الدفع</label>
              <select
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={method} onChange={e => setMethod(e.target.value as typeof method)}
              >
                <option value="cash">نقدي</option>
                <option value="card">بطاقة</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="cheque">شيك</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">تاريخ الدفع</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                  value={date} onChange={e => setDate(e.target.value)} dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">مرجع / رقم الشيك</label>
                <input
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                  value={reference} onChange={e => setReference(e.target.value)} dir="ltr"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات</label>
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={notes} onChange={e => setNotes(e.target.value)}
              />
            </div>

            {err && (
              <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 text-rose-700 rounded-xl text-sm">
                <AlertCircle size={14} /> {err}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50">إلغاء</button>
              <button
                type="submit" disabled={mut.isPending}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {mut.isPending && <Loader2 size={14} className="animate-spin" />}
                <Banknote size={14} /> تسجيل التحصيل
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Ledger Drawer ─────────────────────────────────────────────────────────────
function LedgerDrawer({
  customer, onClose, onCollect,
}: { customer: Customer; onClose: () => void; onCollect: () => void }) {
  const [tab, setTab] = useState<'orders' | 'payments'>('orders')

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['customer-ledger', customer.id],
    queryFn:  () => customersApi.getLedger(customer.id),
  })
  const { data: collections, isLoading: colLoading } = useQuery({
    queryKey: ['customer-collections', customer.id],
    queryFn:  () => customersApi.getCollections(customer.id),
  })

  const isLoading = tab === 'orders' ? ledgerLoading : colLoading

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[82vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{customer.name}</h2>
            <p className="text-sm text-slate-500">{customer.code}</p>
          </div>
          <div className="flex items-center gap-2">
            {customer.balance > 0.005 && (
              <button
                onClick={onCollect}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700"
              >
                <Banknote size={13} /> تحصيل
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
          </div>
        </div>

        {/* KPI row */}
        <div className="px-6 py-3 grid grid-cols-4 gap-3 border-b bg-slate-50 text-center">
          <div>
            <p className="text-[10px] text-slate-400 mb-0.5">إجمالي المبيعات</p>
            <p className="font-bold text-emerald-700 text-sm">{EGP(ledger?.summary?.total_spent ?? 0)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 mb-0.5">عدد الطلبات</p>
            <p className="font-bold text-slate-800 text-sm">{ledger?.summary?.order_count ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 mb-0.5">إجمالي التحصيل</p>
            <p className="font-bold text-blue-700 text-sm">{EGP(collections?.total_collected ?? 0)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 mb-0.5">الرصيد المديون</p>
            <p className={`font-bold text-sm ${customer.balance > 0 ? 'text-amber-600' : 'text-slate-500'}`}>{EGP(customer.balance)}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3">
          {(['orders', 'payments'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t ? 'bg-[#0F2D5C] text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {t === 'orders' ? 'الطلبات' : 'الدفعات المُحصَّلة'}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-[#0F2D5C]" size={28} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {tab === 'orders' ? (
              !ledger?.orders?.length ? (
                <p className="text-center text-slate-400 py-8">لا توجد طلبات بعد</p>
              ) : ledger.orders.map(o => (
                <div key={o.id} className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-sm font-medium text-slate-700">{DATE(o.order_date)}</span>
                    <span className="text-xs text-slate-400 mr-2">{o.payment_method ?? '—'}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-800">{EGP(o.total)}</p>
                    <span className={`text-[11px] font-medium ${o.status === 'voided' ? 'text-rose-500' : 'text-emerald-600'}`}>
                      {o.status === 'voided' ? 'ملغى' : 'مسجّل'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              !collections?.payments?.length ? (
                <p className="text-center text-slate-400 py-8">لا توجد دفعات مُحصَّلة</p>
              ) : collections.payments.map((p: CustomerPayment) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                  <div>
                    <span className="text-sm font-medium text-slate-700">{DATE(p.payment_date)}</span>
                    <span className="text-xs text-slate-400 mr-2">{
                      p.payment_method === 'cash'          ? 'نقدي'
                      : p.payment_method === 'card'        ? 'بطاقة'
                      : p.payment_method === 'bank_transfer' ? 'تحويل'
                      : 'شيك'
                    }</span>
                    {p.reference && <span className="text-xs text-slate-400 mr-1">({p.reference})</span>}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-emerald-700">{EGP(p.amount)}</p>
                    {p.journal_entry_id
                      ? <span className="text-[10px] text-emerald-600">مُرحَّل</span>
                      : <span className="text-[10px] text-amber-500">في الانتظار</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── AR Aging Panel ────────────────────────────────────────────────────────────
function ARAgingPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['ar-aging'],
    queryFn:  () => customersApi.arAging(),
    staleTime: 120_000,
  })

  if (isLoading) return null
  if (!data || data.total_ar < 0.01) return null

  const { total_ar, buckets } = data
  const pct = (v: number) => total_ar > 0 ? Math.round((v / total_ar) * 100) : 0

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 size={16} className="text-[#0F2D5C]" />
        <h3 className="text-sm font-bold text-slate-700">تحليل الذمم المدينة (AR Aging)</h3>
        <span className="mr-auto text-sm font-bold text-amber-600">{EGP(total_ar)}</span>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'جاري (≤30 يوم)', value: buckets.current,      color: 'emerald' },
          { label: '31–60 يوم',       value: buckets.days_31_60,   color: 'yellow'  },
          { label: '61–90 يوم',       value: buckets.days_61_90,   color: 'orange'  },
          { label: '90+ يوم',         value: buckets.days_91_plus,  color: 'rose'    },
        ].map(b => (
          <div key={b.label} className={`p-3 rounded-xl bg-${b.color}-50 border border-${b.color}-100`}>
            <p className={`text-[10px] text-${b.color}-600 mb-1 font-medium`}>{b.label}</p>
            <p className={`text-sm font-bold text-${b.color}-700`}>{EGP(b.value)}</p>
            <div className="mt-1.5 h-1 bg-white/60 rounded-full overflow-hidden">
              <div className={`h-full bg-${b.color}-400 rounded-full`} style={{ width: `${pct(b.value)}%` }} />
            </div>
            <p className={`text-[9px] text-${b.color}-500 mt-0.5`}>{pct(b.value)}%</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Customer Modal ────────────────────────────────────────────────────────────
function CustomerModal({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = customer !== null
  const [form, setForm] = useState<FormState>(
    isEdit
      ? { code: customer!.code, name: customer!.name, phone: customer!.phone ?? '', credit_limit: String(customer!.credit_limit), tier_id: customer!.tier_id != null ? String(customer!.tier_id) : '' }
      : { ...EMPTY_FORM }
  )
  const [err, setErr] = useState<string | null>(null)

  const { data: tiersData } = useQuery({
    queryKey: ['pricing-tiers'],
    queryFn:  () => unwrap(api.get<{ data: { id: number; name: string }[] }>('/pricing/tiers')),
    staleTime: 300_000,
  })

  const createMut = useMutation({
    mutationFn: () => customersApi.create({ code: form.code.trim().toUpperCase(), name: form.name.trim(), phone: form.phone.trim() || undefined, credit_limit: Number(form.credit_limit) || 0, tier_id: form.tier_id ? Number(form.tier_id) : null }),
    onSuccess: () => onSaved(),
    onError:   (e: Error) => setErr(e.message),
  })

  const updateMut = useMutation({
    mutationFn: () => customersApi.update(customer!.id, { name: form.name.trim(), phone: form.phone.trim() || null, credit_limit: Number(form.credit_limit) || 0, tier_id: form.tier_id ? Number(form.tier_id) : null }),
    onSuccess: () => onSaved(),
    onError:   (e: Error) => setErr(e.message),
  })

  const isPending = createMut.isPending || updateMut.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!form.name.trim()) { setErr('الاسم مطلوب'); return }
    if (!isEdit && !form.code.trim()) { setErr('الكود مطلوب'); return }
    if (isEdit) updateMut.mutate(); else createMut.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-slate-800">{isEdit ? 'تعديل العميل' : 'عميل جديد'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">الكود *</label>
              <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder="CUST001" dir="ltr" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">الاسم *</label>
            <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="اسم العميل" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف</label>
            <input className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="01XXXXXXXXX" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">حد الائتمان (ج.م)</label>
            <input type="number" min="0" step="0.01" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30" value={form.credit_limit} onChange={e => setForm(p => ({ ...p, credit_limit: e.target.value }))} dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">شريحة الأسعار</label>
            <select className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30" value={form.tier_id} onChange={e => setForm(p => ({ ...p, tier_id: e.target.value }))}>
              <option value="">بدون شريحة</option>
              {tiersData?.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {err && <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 text-rose-700 rounded-xl text-sm"><AlertCircle size={14} /> {err}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50">إلغاء</button>
            <button type="submit" disabled={isPending} className="flex-1 px-4 py-2.5 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium hover:bg-[#0F2D5C]/90 disabled:opacity-50 flex items-center justify-center gap-2">
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'حفظ التعديلات' : 'إضافة العميل'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const qc = useQueryClient()
  const { canWrite: _canWrite } = usePermission()
  const canWrite = _canWrite('sales')

  const [search, setSearch]       = useState('')
  const [debouncedQ, setDQ]       = useState('')
  const [showModal, setModal]     = useState<'new' | Customer | null>(null)
  const [ledgerFor, setLedger]    = useState<Customer | null>(null)
  const [collectFor, setCollect]  = useState<Customer | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [expandedId, setExpanded] = useState<number | null>(null)

  const handleSearch = (v: string) => {
    setSearch(v)
    clearTimeout((handleSearch as { _t?: ReturnType<typeof setTimeout> })._t)
    ;(handleSearch as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(() => setDQ(v), 300)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['customers', debouncedQ, showInactive],
    queryFn:  () => customersApi.list({ q: debouncedQ || undefined, is_active: showInactive ? 'all' : '1', limit: 100 }),
  })

  const deactivateMut = useMutation({
    mutationFn: (id: number) => customersApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  })

  const handleSaved = () => {
    qc.invalidateQueries({ queryKey: ['customers'] })
    qc.invalidateQueries({ queryKey: ['ar-aging'] })
    setModal(null)
  }

  const handleCollected = () => {
    qc.invalidateQueries({ queryKey: ['customers'] })
    qc.invalidateQueries({ queryKey: ['ar-aging'] })
    qc.invalidateQueries({ queryKey: ['customer-collections', collectFor?.id] })
  }

  const customers = data?.data ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0F2D5C]/10 flex items-center justify-center">
            <Users size={20} className="text-[#0F2D5C]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">إدارة العملاء</h1>
            <p className="text-sm text-slate-500">{data?.total ?? 0} عميل</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
            عرض الموقوفين
          </label>
          {canWrite && (
            <button onClick={() => setModal('new')} className="flex items-center gap-2 px-4 py-2 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium hover:bg-[#0F2D5C]/90">
              <Plus size={16} /> عميل جديد
            </button>
          )}
        </div>
      </div>

      {/* AR Aging Panel */}
      <ARAgingPanel />

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="w-full border border-slate-200 rounded-xl pr-9 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30 bg-white"
          placeholder="بحث بالاسم أو الكود أو الهاتف..."
          value={search} onChange={e => handleSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-[#0F2D5C]" size={28} /></div>
        ) : customers.length === 0 ? (
          <div className="text-center py-16 text-slate-400"><Users size={32} className="mx-auto mb-3 opacity-30" /><p>لا يوجد عملاء</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-right px-4 py-3 text-slate-500 font-medium">الكود</th>
                <th className="text-right px-4 py-3 text-slate-500 font-medium">الاسم</th>
                <th className="text-right px-4 py-3 text-slate-500 font-medium">الهاتف</th>
                <th className="text-right px-4 py-3 text-slate-500 font-medium">الشريحة</th>
                <th className="text-right px-4 py-3 text-slate-500 font-medium">حد الائتمان</th>
                <th className="text-right px-4 py-3 text-slate-500 font-medium">الرصيد</th>
                <th className="text-right px-4 py-3 text-slate-500 font-medium">الحالة</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <>
                  <tr
                    key={c.id}
                    className="border-b border-slate-50 hover:bg-slate-50/50 cursor-pointer transition-colors"
                    onClick={() => setExpanded(expandedId === c.id ? null : c.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      {c.tier_name
                        ? <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-100">{c.tier_name}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-mono text-xs">{EGP(c.credit_limit)}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <span className={c.balance > 0 ? 'text-amber-600 font-semibold' : 'text-slate-500'}>
                        {EGP(c.balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge active={c.is_active} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {canWrite && c.balance > 0.005 && (
                          <button
                            onClick={() => setCollect(c)}
                            className="p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-500 hover:text-emerald-700"
                            title="تحصيل دفعة"
                          >
                            <Banknote size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => setLedger(c)}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700"
                          title="كشف حساب"
                        >
                          {expandedId === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {canWrite && (
                          <>
                            <button onClick={() => setModal(c)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600" title="تعديل">
                              <Edit2 size={14} />
                            </button>
                            {c.code !== 'WALKIN' && c.is_active === 1 && (
                              <button
                                onClick={() => { if (confirm(`هل تريد إيقاف العميل "${c.name}"؟`)) deactivateMut.mutate(c.id) }}
                                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-600"
                                title="إيقاف"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr key={`${c.id}-detail`} className="bg-slate-50/50">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-slate-400 text-xs">تاريخ الإنشاء</span>
                            <p className="font-medium text-slate-700">{DATE(c.created_at)}</p>
                          </div>
                          <div>
                            <span className="text-slate-400 text-xs">عدد الطلبات</span>
                            <p className="font-medium text-slate-700">{c.order_count ?? '—'}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setLedger(c)} className="text-xs px-3 py-1.5 bg-[#0F2D5C] text-white rounded-lg hover:bg-[#0F2D5C]/90">
                              كشف الحساب
                            </button>
                          </div>
                          {canWrite && c.balance > 0.005 && (
                            <div className="flex items-center gap-2">
                              <button onClick={() => setCollect(c)} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1">
                                <Banknote size={12} /> تحصيل
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <CustomerModal customer={showModal === 'new' ? null : showModal} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}

      {ledgerFor && (
        <LedgerDrawer
          customer={ledgerFor}
          onClose={() => setLedger(null)}
          onCollect={() => { setCollect(ledgerFor); setLedger(null) }}
        />
      )}

      {collectFor && (
        <CollectModal
          customer={collectFor}
          onClose={() => setCollect(null)}
          onSaved={handleCollected}
        />
      )}
    </div>
  )
}
