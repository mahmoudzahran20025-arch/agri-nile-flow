import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Save, Loader2, CheckCircle, AlertCircle, Building2, Receipt, Warehouse, Lock } from 'lucide-react'
import { api, unwrap } from '../../api/core'

interface CompanySettings {
  company: {
    name:           string
    address:        string | null
    phone:          string | null
    vat_pct:        number
    vat_number:     string | null
    vat_registered: number
  } | null
  controls: {
    posting_mode:              string | null
    zero_value_require_reason: number | null
    zero_value_approval_roles: string | null
    locked_through_date:       string | null
  }
}

const fetchSettings = () => unwrap(api.get<CompanySettings>('/config/company-settings'))
const patchSettings = (body: Partial<{
  name: string; address: string | null; phone: string | null
  vat_pct: number; vat_number: string | null; vat_registered: 0 | 1
  posting_mode: string; zero_value_require_reason: 0 | 1
  zero_value_approval_roles: string | null; locked_through_date: string | null
}>) => unwrap(api.patch<{ success: boolean }>('/config/company-settings', body))

type Tab = 'company' | 'vat' | 'inventory' | 'lock'

export default function SettingsPage() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('company')
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn:  fetchSettings,
  })

  // Company Info
  const [companyForm, setCompany] = useState({ name: '', address: '', phone: '' })
  // VAT
  const [vatForm, setVat] = useState({ vat_pct: '0', vat_number: '', vat_registered: false })
  // Inventory controls
  const [invForm, setInv] = useState({
    posting_mode: 'auto',
    zero_value_require_reason: false,
    zero_value_approval_roles: '',
  })
  // Lock date
  const [lockForm, setLock] = useState({ locked_through_date: '' })

  useEffect(() => {
    if (!data) return
    const c = data.company
    const ctrl = data.controls
    if (c) {
      setCompany({ name: c.name, address: c.address ?? '', phone: c.phone ?? '' })
      setVat({ vat_pct: String(c.vat_pct), vat_number: c.vat_number ?? '', vat_registered: c.vat_registered === 1 })
    }
    setInv({
      posting_mode:              ctrl.posting_mode              ?? 'auto',
      zero_value_require_reason: ctrl.zero_value_require_reason === 1,
      zero_value_approval_roles: ctrl.zero_value_approval_roles ?? '',
    })
    setLock({ locked_through_date: ctrl.locked_through_date ?? '' })
  }, [data])

  const saveMut = useMutation({
    mutationFn: (body: Parameters<typeof patchSettings>[0]) => patchSettings(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-settings'] })
      setSaved(true)
      setErr(null)
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (e: Error) => setErr(e.message),
  })

  const handleSave = () => {
    setErr(null)
    const vatPct = Number(vatForm.vat_pct)
    if (isNaN(vatPct) || vatPct < 0 || vatPct >= 100) {
      setErr('نسبة الضريبة يجب أن تكون بين 0 و 99')
      return
    }

    saveMut.mutate({
      name:                      companyForm.name.trim() || undefined,
      address:                   companyForm.address.trim() || null,
      phone:                     companyForm.phone.trim() || null,
      vat_pct:                   vatPct,
      vat_number:                vatForm.vat_number.trim() || null,
      vat_registered:            vatForm.vat_registered ? 1 : 0,
      posting_mode:              invForm.posting_mode as 'auto' | 'manual' | 'batch',
      zero_value_require_reason: invForm.zero_value_require_reason ? 1 : 0,
      zero_value_approval_roles: invForm.zero_value_approval_roles.trim() || null,
      locked_through_date:       lockForm.locked_through_date || null,
    })
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'company',   label: 'بيانات الشركة',         icon: <Building2 size={16} /> },
    { id: 'vat',       label: 'ضريبة القيمة المضافة',   icon: <Receipt   size={16} /> },
    { id: 'inventory', label: 'إعدادات المخزون',        icon: <Warehouse size={16} /> },
    { id: 'lock',      label: 'قفل الفترة',              icon: <Lock      size={16} /> },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-[#0F2D5C]" size={32} />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0F2D5C]/10 flex items-center justify-center">
            <Settings size={20} className="text-[#0F2D5C]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">إعدادات الشركة</h1>
            <p className="text-sm text-slate-500">تهيئة البيانات الأساسية والضريبة والمخزون</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saveMut.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium hover:bg-[#0F2D5C]/90 disabled:opacity-50"
        >
          {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          حفظ الإعدادات
        </button>
      </div>

      {/* Status */}
      {saved && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-emerald-50 text-emerald-700 rounded-xl text-sm border border-emerald-200">
          <CheckCircle size={14} /> تم حفظ الإعدادات بنجاح
        </div>
      )}
      {err && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-rose-50 text-rose-700 rounded-xl text-sm border border-rose-200">
          <AlertCircle size={14} /> {err}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-white text-[#0F2D5C] shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">

        {/* Company Info */}
        {activeTab === 'company' && (
          <div className="space-y-5">
            <h2 className="text-base font-bold text-slate-700 pb-3 border-b border-slate-100">بيانات الشركة الأساسية</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الشركة</label>
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={companyForm.name}
                onChange={e => setCompany(p => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">العنوان</label>
              <textarea
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30 resize-none"
                value={companyForm.address}
                onChange={e => setCompany(p => ({ ...p, address: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم الهاتف</label>
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={companyForm.phone}
                onChange={e => setCompany(p => ({ ...p, phone: e.target.value }))}
                dir="ltr"
              />
            </div>
          </div>
        )}

        {/* VAT */}
        {activeTab === 'vat' && (
          <div className="space-y-5">
            <h2 className="text-base font-bold text-slate-700 pb-3 border-b border-slate-100">ضريبة القيمة المضافة (VAT)</h2>

            <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-xl border border-amber-200">
              <input
                id="vat_registered"
                type="checkbox"
                checked={vatForm.vat_registered}
                onChange={e => setVat(p => ({ ...p, vat_registered: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="vat_registered" className="text-sm font-medium text-amber-800 cursor-pointer">
                الشركة مسجلة في ضريبة القيمة المضافة
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">نسبة الضريبة (%)</label>
              <input
                type="number"
                min="0"
                max="99"
                step="0.5"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={vatForm.vat_pct}
                onChange={e => setVat(p => ({ ...p, vat_pct: e.target.value }))}
                dir="ltr"
              />
              <p className="text-xs text-slate-400 mt-1.5">أدخل 0 لتعطيل الضريبة. مثال: 14 يعني 14%</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">الرقم الضريبي (للفواتير)</label>
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={vatForm.vat_number}
                onChange={e => setVat(p => ({ ...p, vat_number: e.target.value }))}
                placeholder="000-000-000"
                dir="ltr"
              />
              <p className="text-xs text-slate-400 mt-1.5">يظهر على إيصالات نقطة البيع والفواتير</p>
            </div>
          </div>
        )}

        {/* Inventory Controls */}
        {activeTab === 'inventory' && (
          <div className="space-y-5">
            <h2 className="text-base font-bold text-slate-700 pb-3 border-b border-slate-100">إعدادات ترحيل المخزون</h2>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">وضع الترحيل</label>
              <select
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={invForm.posting_mode}
                onChange={e => setInv(p => ({ ...p, posting_mode: e.target.value }))}
              >
                <option value="auto">تلقائي — يُرحَّل فور الحفظ</option>
                <option value="manual">يدوي — يحتاج موافقة</option>
                <option value="batch">دفعي — ترحيل جماعي</option>
              </select>
            </div>

            <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <input
                id="zero_reason"
                type="checkbox"
                checked={invForm.zero_value_require_reason}
                onChange={e => setInv(p => ({ ...p, zero_value_require_reason: e.target.checked }))}
                className="rounded mt-0.5"
              />
              <div>
                <label htmlFor="zero_reason" className="text-sm font-medium text-slate-700 cursor-pointer block mb-0.5">
                  طلب سبب للحركات ذات القيمة الصفرية
                </label>
                <p className="text-xs text-slate-400">يُلزم المستخدم بإدخال تعليق عند تسجيل حركة بسعر صفر</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                أدوار الموافقة (للحركات الصفرية)
              </label>
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={invForm.zero_value_approval_roles}
                onChange={e => setInv(p => ({ ...p, zero_value_approval_roles: e.target.value }))}
                placeholder="company_admin,warehouse_manager"
                dir="ltr"
              />
              <p className="text-xs text-slate-400 mt-1.5">مفصول بفاصلة — اتركه فارغاً لتطبيقه على الجميع</p>
            </div>
          </div>
        )}

        {/* Lock Date */}
        {activeTab === 'lock' && (
          <div className="space-y-5">
            <h2 className="text-base font-bold text-slate-700 pb-3 border-b border-slate-100">قفل الفترة المحاسبية</h2>

            <div className="p-4 bg-rose-50 rounded-xl border border-rose-200 text-sm text-rose-800">
              <p className="font-semibold mb-1">تحذير</p>
              <p>تحديد تاريخ القفل سيمنع تسجيل أي حركات مخزون أو قيود محاسبية قبل هذا التاريخ. لا يمكن التراجع عن ذلك إلا بتغيير التاريخ.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">مقفل حتى تاريخ</label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30"
                value={lockForm.locked_through_date}
                onChange={e => setLock({ locked_through_date: e.target.value })}
                dir="ltr"
              />
              <p className="text-xs text-slate-400 mt-1.5">اتركه فارغاً لرفع القفل عن كل الفترات</p>
            </div>

            {lockForm.locked_through_date && (
              <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-sm text-amber-800">
                كل الفترات حتى <strong>{lockForm.locked_through_date}</strong> ستكون مقفلة
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end mt-6">
        <button
          onClick={handleSave}
          disabled={saveMut.isPending}
          className="flex items-center gap-2 px-6 py-2.5 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium hover:bg-[#0F2D5C]/90 disabled:opacity-50"
        >
          {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          حفظ الإعدادات
        </button>
      </div>
    </div>
  )
}
