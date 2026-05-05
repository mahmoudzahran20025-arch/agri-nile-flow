import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, Mail, MapPin, CreditCard, Clock } from 'lucide-react'
import Modal from '../ui/Modal'
import { suppliersApi } from '../../api/client'
import { glApi } from '../../api/gl'
import { useToast } from '../../contexts/ToastContext'
import type { Supplier } from '../../types'

interface Props {
  open:         boolean
  onClose:      () => void
  supplier:     Supplier | null | undefined
}

const SUPPLIER_TYPES = [
  { value: 'supplier', label: 'مورد فقط' },
  { value: 'customer', label: 'عميل فقط' },
  { value: 'both',     label: 'مورد وعميل' },
]

const PAYMENT_TERMS_OPTIONS = [
  { value: 0,   label: 'فوري (نقداً)' },
  { value: 15,  label: '15 يوم' },
  { value: 30,  label: '30 يوم' },
  { value: 45,  label: '45 يوم' },
  { value: 60,  label: '60 يوم' },
  { value: 90,  label: '90 يوم' },
]

export default function EditSupplierModal({ open, onClose, supplier }: Props) {
  const qc        = useQueryClient()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [activeSection, setActiveSection] = useState<'basic' | 'contact' | 'financial'>('basic')

  const [form, setForm] = useState({
    name: '', activity: '', supplier_type: 'supplier', notes: '', is_active: '1',
    phone: '', email: '', address: '', tax_number: '',
    credit_limit: '', payment_terms: '30', bus_posting_group_code: '',
  })

  // Pre-fill form when supplier changes
  useEffect(() => {
    if (supplier) {
      setForm({
        name:                   supplier.name ?? '',
        activity:               supplier.activity ?? '',
        supplier_type:          supplier.supplier_type ?? 'supplier',
        notes:                  supplier.notes ?? '',
        is_active:              String(supplier.is_active ?? 1),
        phone:                  supplier.phone ?? '',
        email:                  supplier.email ?? '',
        address:                supplier.address ?? '',
        tax_number:             supplier.tax_number ?? '',
        credit_limit:           supplier.credit_limit != null ? String(supplier.credit_limit) : '',
        payment_terms:          String(supplier.payment_terms ?? 30),
        bus_posting_group_code: supplier.bus_posting_group_code ?? '',
      })
      setError('')
      setActiveSection('basic')
    }
  }, [supplier])

  const { data: bpgList = [] } = useQuery({
    queryKey: ['posting-groups', 'business'],
    queryFn:  () => glApi.postingGroups('business'),
    enabled:  open,
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplier) return
    setError('')

    if (!form.name.trim()) { setError('اسم المورد مطلوب'); return }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('صيغة البريد الإلكتروني غير صحيحة'); return
    }

    setSaving(true)
    try {
      const res = await suppliersApi.update(supplier.code, {
        name:                   form.name.trim(),
        activity:               form.activity.trim() || null,
        supplier_type:          form.supplier_type,
        notes:                  form.notes.trim() || null,
        is_active:              Number(form.is_active),
        phone:                  form.phone.trim() || null,
        email:                  form.email.trim() || null,
        address:                form.address.trim() || null,
        tax_number:             form.tax_number.trim() || null,
        credit_limit:           form.credit_limit ? Number(form.credit_limit) : null,
        payment_terms:          Number(form.payment_terms) || 30,
        bus_posting_group_code: form.bus_posting_group_code || null,
      })
      if ((res as { success: boolean }).success === false) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['supplier', String(supplier.code)] })
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
      toast(`تم تحديث بيانات ${form.name} بنجاح`, 'success')
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال — تحقق من الشبكة وأعد المحاولة')
    } finally {
      setSaving(false)
    }
  }

  const SECTIONS = [
    { id: 'basic'     as const, label: 'البيانات الأساسية' },
    { id: 'contact'   as const, label: 'بيانات التواصل' },
    { id: 'financial' as const, label: 'الشروط المالية' },
  ]

  return (
    <Modal open={open} title={`تعديل المورد — ${supplier?.name ?? ''}`} onClose={onClose}>
      <form onSubmit={handleSubmit} dir="rtl">

        {/* Section tabs */}
        <div className="flex border-b border-slate-200 mb-5">
          {SECTIONS.map(s => (
            <button
              key={s.id} type="button" onClick={() => setActiveSection(s.id)}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all -mb-px ${
                activeSection === s.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Basic ──────────────────────────────────── */}
        {activeSection === 'basic' && (
          <div className="space-y-4">
            <div>
              <label className="label">الاسم <span className="text-red-500">*</span></label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">النوع</label>
                <select className="input" value={form.supplier_type} onChange={e => set('supplier_type', e.target.value)}>
                  {SUPPLIER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">الحالة</label>
                <select className="input" value={form.is_active} onChange={e => set('is_active', e.target.value)}>
                  <option value="1">نشط</option>
                  <option value="0">موقوف</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">النشاط / التصنيف</label>
              <input className="input" placeholder="مثال: أسمدة / مبيدات..." value={form.activity} onChange={e => set('activity', e.target.value)} />
            </div>
            <div>
              <label className="label">ملاحظات</label>
              <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        )}

        {/* ── Contact ───────────────────────────────── */}
        {activeSection === 'contact' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label flex items-center gap-1.5"><Phone size={13} />رقم الهاتف</label>
                <input className="input" placeholder="01xxxxxxxxx" dir="ltr" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div>
                <label className="label flex items-center gap-1.5"><Mail size={13} />البريد الإلكتروني</label>
                <input type="email" className="input" placeholder="name@company.com" dir="ltr" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label flex items-center gap-1.5"><MapPin size={13} />العنوان</label>
              <input className="input" value={form.address} onChange={e => set('address', e.target.value)} />
            </div>
            <div>
              <label className="label">الرقم الضريبي</label>
              <input className="input font-mono" dir="ltr" value={form.tax_number} onChange={e => set('tax_number', e.target.value)} />
            </div>
          </div>
        )}

        {/* ── Financial ─────────────────────────────── */}
        {activeSection === 'financial' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label flex items-center gap-1.5"><CreditCard size={13} />حد الائتمان (ج.م)</label>
                <input type="number" min="0" step="1000" className="input"
                  value={form.credit_limit} onChange={e => set('credit_limit', e.target.value)} />
              </div>
              <div>
                <label className="label flex items-center gap-1.5"><Clock size={13} />شروط السداد</label>
                <select className="input" value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)}>
                  {PAYMENT_TERMS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">مجموعة الترحيل التجاري (BPG)</label>
              <select className="input" value={form.bus_posting_group_code} onChange={e => set('bus_posting_group_code', e.target.value)}>
                <option value="">— بدون مجموعة —</option>
                {bpgList.filter(g => g.is_active === 1).map(g => (
                  <option key={g.code} value={g.code}>{g.code} — {g.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-5 mt-5 border-t border-slate-100">
          {activeSection !== 'basic' && (
            <button type="button" className="btn-secondary"
              onClick={() => setActiveSection(activeSection === 'financial' ? 'contact' : 'basic')}>
              ← السابق
            </button>
          )}
          {activeSection !== 'financial' ? (
            <button type="button" className="btn-primary flex-1"
              onClick={() => setActiveSection(activeSection === 'basic' ? 'contact' : 'financial')}>
              التالي →
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}
