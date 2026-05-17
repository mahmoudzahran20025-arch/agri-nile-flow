import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Phone, Mail, MapPin, FileText, CreditCard, Clock } from 'lucide-react'
import Modal from '../ui/Modal'
import { suppliersApi } from '../../api/client'
import { glApi } from '../../api/gl'
import { useToast } from '../../contexts/ToastContext'

interface Props { open: boolean; onClose: () => void }

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

export default function AddSupplierModal({ open, onClose }: Props) {
  const qc        = useQueryClient()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [activeSection, setActiveSection] = useState<'basic' | 'contact' | 'financial'>('basic')

  const [form, setForm] = useState({
    code: '', name: '', activity: '', supplier_type: 'supplier', notes: '',
    phone: '', email: '', address: '', tax_number: '',
    credit_limit: '', payment_terms: '30', bus_posting_group_code: '',
  })

  const { data: bpgList = [] } = useQuery({
    queryKey: ['posting-groups', 'business'],
    queryFn:  () => glApi.postingGroups('business'),
    enabled:  open,
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const resetForm = () => {
    setForm({
      code: '', name: '', activity: '', supplier_type: 'supplier', notes: '',
      phone: '', email: '', address: '', tax_number: '',
      credit_limit: '', payment_terms: '30', bus_posting_group_code: '',
    })
    setError('')
    setActiveSection('basic')
  }

  const handleClose = () => { resetForm(); onClose() }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.code)        { setError('كود المورد مطلوب'); return }
    if (!form.name.trim()) { setError('اسم المورد مطلوب'); return }
    if (Number(form.code) <= 0) { setError('الكود يجب أن يكون رقماً موجباً'); return }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('صيغة البريد الإلكتروني غير صحيحة'); return
    }

    setSaving(true)
    try {
      const res = await suppliersApi.create({
        code:                   Number(form.code),
        name:                   form.name.trim(),
        activity:               form.activity.trim() || undefined,
        supplier_type:          form.supplier_type,
        notes:                  form.notes.trim() || undefined,
        phone:                  form.phone.trim() || undefined,
        email:                  form.email.trim() || undefined,
        address:                form.address.trim() || undefined,
        tax_number:             form.tax_number.trim() || undefined,
        credit_limit:           form.credit_limit ? Number(form.credit_limit) : undefined,
        payment_terms:          Number(form.payment_terms) || 30,
        bus_posting_group_code: form.bus_posting_group_code || undefined,
      })
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
      toast(`تم إضافة ${form.name} بنجاح`, 'success')
      resetForm()
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال — تحقق من الشبكة وأعد المحاولة')
    } finally {
      setSaving(false)
    }
  }

  const SECTIONS = [
    { id: 'basic'     as const, label: 'البيانات الأساسية', icon: <Building2 size={14} /> },
    { id: 'contact'   as const, label: 'بيانات التواصل',     icon: <Phone     size={14} /> },
    { id: 'financial' as const, label: 'الشروط المالية',     icon: <CreditCard size={14}/> },
  ]

  return (
    <Modal open={open} title="إضافة مورد / عميل جديد" onClose={handleClose}>
      <form onSubmit={handleSubmit} dir="rtl">

        {/* Section tabs */}
        <div className="flex border-b border-slate-200 mb-5">
          {SECTIONS.map(s => (
            <button
              key={s.id} type="button" onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 transition-all -mb-px ${
                activeSection === s.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {s.icon}{s.label}
            </button>
          ))}
        </div>

        {/* ── Section: Basic ───────────────────────────── */}
        {activeSection === 'basic' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">الكود <span className="text-red-500">*</span></label>
                <input type="number" min="1" className="input" placeholder="رقم فريد مثال: 1001"
                  value={form.code} onChange={e => set('code', e.target.value)} required />
                <p className="text-[11px] text-slate-400 mt-1">لا يمكن تغييره لاحقاً</p>
              </div>
              <div>
                <label className="label">الاسم <span className="text-red-500">*</span></label>
                <input className="input" placeholder="الاسم الكامل للمورد أو العميل"
                  value={form.name} onChange={e => set('name', e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">النوع</label>
                <select className="input" value={form.supplier_type} onChange={e => set('supplier_type', e.target.value)}>
                  {SUPPLIER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">النشاط / التصنيف</label>
                <input className="input" placeholder="مثال: أسمدة / مبيدات / حصادات..."
                  value={form.activity} onChange={e => set('activity', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label flex items-center gap-1.5"><FileText size={13} />ملاحظات</label>
              <textarea className="input" rows={2} placeholder="أي معلومات إضافية..."
                value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        )}

        {/* ── Section: Contact ─────────────────────────── */}
        {activeSection === 'contact' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label flex items-center gap-1.5"><Phone size={13} />رقم الهاتف</label>
                <input className="input" placeholder="01xxxxxxxxx" dir="ltr"
                  value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div>
                <label className="label flex items-center gap-1.5"><Mail size={13} />البريد الإلكتروني</label>
                <input type="email" className="input" placeholder="name@company.com" dir="ltr"
                  value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label flex items-center gap-1.5"><MapPin size={13} />العنوان</label>
              <input className="input" placeholder="المحافظة / المدينة / الشارع"
                value={form.address} onChange={e => set('address', e.target.value)} />
            </div>
            <div>
              <label className="label">الرقم الضريبي</label>
              <input className="input font-mono" placeholder="000-000-000" dir="ltr"
                value={form.tax_number} onChange={e => set('tax_number', e.target.value)} />
            </div>
          </div>
        )}

        {/* ── Section: Financial ───────────────────────── */}
        {activeSection === 'financial' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label flex items-center gap-1.5"><CreditCard size={13} />حد الائتمان (ج.م)</label>
                <input type="number" min="0" step="1000" className="input"
                  placeholder="اختياري — 0 = بلا حد"
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
                <option value="">— بدون مجموعة (سيستخدم الافتراضي) —</option>
                {bpgList.filter(g => g.is_active === 1).map(g => (
                  <option key={g.code} value={g.code}>{g.code} — {g.name}</option>
                ))}
              </select>
              {!form.bus_posting_group_code && (
                <p className="text-[11px] text-amber-600 mt-1">⚠ بدون مجموعة، سيتم استخدام قاعدة الإعداد الافتراضية عند الترحيل.</p>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </div>
        )}

        {/* Actions */}
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
              <button type="button" className="btn-secondary" onClick={handleClose} disabled={saving}>إلغاء</button>
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? 'جاري الحفظ...' : 'إضافة المورد'}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}
