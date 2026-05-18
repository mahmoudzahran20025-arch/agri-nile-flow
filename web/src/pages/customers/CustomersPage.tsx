import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Search, Edit2, Trash2, ChevronDown, ChevronUp, X, Loader2, AlertCircle } from 'lucide-react'
import { customersApi, type Customer } from '../../api/customers'
import { api, unwrap } from '../../api/core'
import { usePermission } from '../../hooks/usePermission'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)

const DATE = (s: string) =>
  new Date(s).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })

interface FormState {
  code:         string
  name:         string
  phone:        string
  credit_limit: string
  tier_id:      string
}

const EMPTY_FORM: FormState = { code: '', name: '', phone: '', credit_limit: '0', tier_id: '' }

function StatusBadge({ active }: { active: number }) {
  return active
    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">نشط</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">موقوف</span>
}

function LedgerDrawer({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-ledger', customer.id],
    queryFn:  () => customersApi.getLedger(customer.id),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{customer.name}</h2>
            <p className="text-sm text-slate-500">{customer.code} — حركات العميل</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-[#0F2D5C]" size={28} />
          </div>
        ) : (
          <>
            {data?.summary && (
              <div className="px-6 py-4 grid grid-cols-3 gap-4 border-b bg-slate-50">
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-0.5">إجمالي المبيعات</p>
                  <p className="font-bold text-emerald-700">{EGP(data.summary.total_spent)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-0.5">عدد الطلبات</p>
                  <p className="font-bold text-slate-800">{data.summary.order_count}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-0.5">الرصيد المديون</p>
                  <p className="font-bold text-slate-800">{EGP(customer.balance)}</p>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!data?.orders?.length ? (
                <p className="text-center text-slate-400 py-8">لا توجد طلبات بعد</p>
              ) : (
                data.orders.map(o => (
                  <div key={o.id} className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-slate-700">{DATE(o.order_date)}</span>
                      <span className="text-xs text-slate-400">{o.payment_method ?? '—'}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-800">{EGP(o.total)}</p>
                      <span className={`text-[11px] font-medium ${o.status === 'voided' ? 'text-rose-500' : 'text-emerald-600'}`}>
                        {o.status === 'voided' ? 'ملغى' : 'مدفوع'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CustomerModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = customer !== null
  const [form, setForm] = useState<FormState>(
    isEdit
      ? {
          code:         customer!.code,
          name:         customer!.name,
          phone:        customer!.phone ?? '',
          credit_limit: String(customer!.credit_limit),
          tier_id:      customer!.tier_id != null ? String(customer!.tier_id) : '',
        }
      : { ...EMPTY_FORM }
  )
  const [err, setErr] = useState<string | null>(null)

  const { data: tiersData } = useQuery({
    queryKey: ['pricing-tiers'],
    queryFn:  () => unwrap(api.get<{ data: { id: number; name: string }[] }>('/pricing/tiers')),
    staleTime: 300_000,
  })

  const createMut = useMutation({
    mutationFn: () => customersApi.create({
      code:         form.code.trim().toUpperCase(),
      name:         form.name.trim(),
      phone:        form.phone.trim() || undefined,
      credit_limit: Number(form.credit_limit) || 0,
      tier_id:      form.tier_id ? Number(form.tier_id) : null,
    }),
    onSuccess: () => { onSaved() },
    onError:   (e: Error) => setErr(e.message),
  })

  const updateMut = useMutation({
    mutationFn: () => customersApi.update(customer!.id, {
      name:         form.name.trim(),
      phone:        form.phone.trim() || null,
      credit_limit: Number(form.credit_limit) || 0,
      tier_id:      form.tier_id ? Number(form.tier_id) : null,
    }),
    onSuccess: () => { onSaved() },
    onError:   (e: Error) => setErr(e.message),
  })

  const isPending = createMut.isPending || updateMut.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!form.name.trim()) { setErr('الاسم مطلوب'); return }
    if (!isEdit && !form.code.trim()) { setErr('الكود مطلوب'); return }
    if (isEdit) updateMut.mutate()
    else createMut.mutate()
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
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                placeholder="CUST001"
                dir="ltr"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">الاسم *</label>
            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="اسم العميل"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف</label>
            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
              value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              placeholder="01XXXXXXXXX"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">حد الائتمان (ج.م)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
              value={form.credit_limit}
              onChange={e => setForm(p => ({ ...p, credit_limit: e.target.value }))}
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">شريحة الأسعار</label>
            <select
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
              value={form.tier_id}
              onChange={e => setForm(p => ({ ...p, tier_id: e.target.value }))}
            >
              <option value="">بدون شريحة</option>
              {tiersData?.data?.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {err && (
            <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 text-rose-700 rounded-xl text-sm">
              <AlertCircle size={14} /> {err}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2.5 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium hover:bg-[#0F2D5C]/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'حفظ التعديلات' : 'إضافة العميل'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CustomersPage() {
  const qc = useQueryClient()
  const { canWrite: _canWrite } = usePermission()
  const canWrite = _canWrite('sales')

  const [search, setSearch]     = useState('')
  const [debouncedQ, setDQ]     = useState('')
  const [showModal, setModal]   = useState<'new' | Customer | null>(null)
  const [ledgerFor, setLedger]  = useState<Customer | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [expandedId, setExpanded] = useState<number | null>(null)

  // Debounce search
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
    setModal(null)
  }

  const customers = data?.data ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
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
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded"
            />
            عرض الموقوفين
          </label>
          {canWrite && (
            <button
              onClick={() => setModal('new')}
              className="flex items-center gap-2 px-4 py-2 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium hover:bg-[#0F2D5C]/90"
            >
              <Plus size={16} /> عميل جديد
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="w-full border border-slate-200 rounded-xl pr-9 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30 bg-white"
          placeholder="بحث بالاسم أو الكود أو الهاتف..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-[#0F2D5C]" size={28} />
          </div>
        ) : customers.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Users size={32} className="mx-auto mb-3 opacity-30" />
            <p>لا يوجد عملاء</p>
          </div>
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
                        <button
                          onClick={() => setLedger(c)}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700"
                          title="كشف حساب"
                        >
                          {expandedId === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {canWrite && (
                          <>
                            <button
                              onClick={() => setModal(c)}
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600"
                              title="تعديل"
                            >
                              <Edit2 size={14} />
                            </button>
                            {c.code !== 'WALKIN' && c.is_active === 1 && (
                              <button
                                onClick={() => {
                                  if (confirm(`هل تريد إيقاف العميل "${c.name}"؟`)) deactivateMut.mutate(c.id)
                                }}
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
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-slate-400 text-xs">تاريخ الإنشاء</span>
                            <p className="font-medium text-slate-700">{DATE(c.created_at)}</p>
                          </div>
                          <div>
                            <span className="text-slate-400 text-xs">عدد الطلبات</span>
                            <p className="font-medium text-slate-700">{c.order_count ?? '—'}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setLedger(c)}
                              className="text-xs px-3 py-1.5 bg-[#0F2D5C] text-white rounded-lg hover:bg-[#0F2D5C]/90"
                            >
                              عرض كشف الحساب
                            </button>
                          </div>
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
        <CustomerModal
          customer={showModal === 'new' ? null : showModal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {ledgerFor && (
        <LedgerDrawer customer={ledgerFor} onClose={() => setLedger(null)} />
      )}
    </div>
  )
}
