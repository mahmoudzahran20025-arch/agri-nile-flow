import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../../api/client'
import {
  Building2, Database, Users, CheckCircle2,
  ChevronRight, ChevronLeft, Loader2, AlertTriangle,
  Layers, UserPlus,
} from 'lucide-react'

// ── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: 'معلومات الشركة',   icon: Building2,   desc: 'الاسم والكود والمعلومات الأساسية' },
  { id: 2, title: 'دليل الحسابات',    icon: Database,    desc: 'تهيئة تلقائية من النموذج الافتراضي' },
  { id: 3, title: 'دعوة مستخدم أول', icon: UserPlus,    desc: 'إضافة مسؤول للشركة' },
  { id: 4, title: 'اكتمل الإعداد',   icon: CheckCircle2, desc: 'الشركة جاهزة للعمل' },
] as const

type StepId = typeof STEPS[number]['id']

interface CompanyForm {
  code:        string
  name:        string
  address:     string
  phone:       string
  fiscal_year: number
}

interface UserForm {
  email:     string
  full_name: string
  role:      string
}

interface SeedResult {
  id:      number
  seeding: Record<string, number | string>
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: StepId }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8" dir="ltr">
      {STEPS.map((s, i) => {
        const done    = s.id < current
        const active  = s.id === current
        const Icon    = s.icon
        return (
          <div key={s.id} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              done   ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              active ? 'bg-[#0F2D5C] text-white' :
                       'bg-slate-50 text-slate-400 border border-slate-200'
            }`}>
              {done ? <CheckCircle2 size={13} /> : <Icon size={13} />}
              <span className="hidden sm:block">{s.title}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-6 h-0.5 mx-1 ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep]           = useState<StepId>(1)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null)
  const [userResult, setUserResult] = useState<{ user_id: number; created_new_user: boolean } | null>(null)

  const [company, setCompany] = useState<CompanyForm>({
    code:        '',
    name:        '',
    address:     '',
    phone:       '',
    fiscal_year: new Date().getFullYear(),
  })

  const [user, setUser] = useState<UserForm>({
    email:     '',
    full_name: '',
    role:      'company_admin',
  })

  // ── Step 1 → 2: create company ─────────────────────────────────────────────
  async function handleCreateCompany() {
    if (!company.code.trim() || !company.name.trim()) {
      setError('الكود والاسم مطلوبان')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.createCompany({
        code:        company.code.trim().toUpperCase(),
        name:        company.name.trim(),
        address:     company.address || undefined,
        phone:       company.phone   || undefined,
        fiscal_year: company.fiscal_year,
      })
      setSeedResult(res)
      setStep(2)
    } catch (e: unknown) {
      setError((e as Error).message.replace(/^Error:\s*/i, ''))
    } finally {
      setLoading(false)
    }
  }

  // ── Step 3: invite user ────────────────────────────────────────────────────
  async function handleInviteUser() {
    if (!user.email.trim()) {
      setError('البريد الإلكتروني مطلوب')
      return
    }
    if (!seedResult) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.inviteUser(seedResult.id, {
        email:     user.email.trim().toLowerCase(),
        full_name: user.full_name.trim() || user.email.trim(),
        role:      user.role,
      })
      setUserResult(res)
      setStep(4)
    } catch (e: unknown) {
      setError((e as Error).message.replace(/^Error:\s*/i, ''))
    } finally {
      setLoading(false)
    }
  }

  const currentYear = new Date().getFullYear()

  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-6 pt-10">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-6" dir="rtl">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-[#0F2D5C] rounded-2xl mb-3">
            <Building2 size={22} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">إعداد شركة جديدة</h1>
          <p className="text-sm text-slate-500 mt-1">أدخل معلومات الشركة وسيتولى النظام تهيئة البنية المحاسبية تلقائياً</p>
        </div>

        <StepIndicator current={step} />

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">

          {/* ── Step 1: Company info ── */}
          {step === 1 && (
            <div className="space-y-5" dir="rtl">
              <div>
                <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                  <Building2 size={16} className="text-[#0F2D5C]" />
                  معلومات الشركة
                </h2>
                <p className="text-xs text-slate-500 mt-1">الكود يُستخدم كمعرّف فريد ولا يمكن تغييره لاحقاً</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">كود الشركة <span className="text-red-500">*</span></label>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20"
                    placeholder="مثال: AGN2"
                    value={company.code}
                    onChange={e => setCompany(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                    maxLength={10}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">السنة المالية</label>
                  <select
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20"
                    value={company.fiscal_year}
                    onChange={e => setCompany(p => ({ ...p, fiscal_year: Number(e.target.value) }))}
                  >
                    {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">اسم الشركة <span className="text-red-500">*</span></label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20"
                  placeholder="الاسم الكامل للشركة"
                  value={company.name}
                  onChange={e => setCompany(p => ({ ...p, name: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">العنوان</label>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20"
                    placeholder="العنوان (اختياري)"
                    value={company.address}
                    onChange={e => setCompany(p => ({ ...p, address: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">الهاتف</label>
                  <input
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20"
                    placeholder="رقم الهاتف (اختياري)"
                    value={company.phone}
                    onChange={e => setCompany(p => ({ ...p, phone: e.target.value }))}
                  />
                </div>
              </div>

              {/* What gets created */}
              <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-blue-800">سيتم إنشاء تلقائياً:</p>
                {[
                  'دليل الحسابات (نسخ من الشركة النموذجية)',
                  'مراكز التكلفة الافتراضية (7 مراكز)',
                  'أنواع الخدمات (ميكنة، عمالة، توريد…)',
                  `فترة مالية لسنة ${company.fiscal_year}`,
                ].map(item => (
                  <div key={item} className="flex items-center gap-1.5 text-xs text-blue-700">
                    <CheckCircle2 size={11} />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Seeding results ── */}
          {step === 2 && seedResult && (
            <div className="space-y-5" dir="rtl">
              <div>
                <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                  <Database size={16} className="text-emerald-600" />
                  تمت تهيئة البنية المحاسبية
                </h2>
                <p className="text-xs text-slate-500 mt-1">رقم الشركة: <span className="font-mono font-semibold">#{seedResult.id}</span></p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'coa_accounts',   label: 'حسابات دليل الأستاذ', icon: Database },
                  { key: 'cost_centers',   label: 'مراكز التكلفة',       icon: Layers },
                  { key: 'service_types',  label: 'أنواع الخدمات',       icon: CheckCircle2 },
                  { key: 'fiscal_year',    label: 'السنة المالية',        icon: CheckCircle2 },
                ].map(({ key, label, icon: Icon }) => {
                  const val = seedResult.seeding[key]
                  return (
                    <div key={key} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2">
                      <Icon size={14} className="text-emerald-600 shrink-0" />
                      <div>
                        <p className="text-xs text-emerald-700 font-medium">{label}</p>
                        <p className="text-xs text-emerald-600">{typeof val === 'number' ? `${val} سجل` : val}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-600">
                  الخطوة التالية: دعوة مسؤول الشركة حتى يتمكن من تسجيل الدخول وبدء العمل.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 3: Invite user ── */}
          {step === 3 && (
            <div className="space-y-5" dir="rtl">
              <div>
                <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                  <UserPlus size={16} className="text-[#0F2D5C]" />
                  دعوة مستخدم أول
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  سيتم إنشاء حساب المستخدم إذا لم يكن موجوداً، وربطه بالشركة الجديدة
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">البريد الإلكتروني <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20"
                  placeholder="user@example.com"
                  value={user.email}
                  onChange={e => setUser(p => ({ ...p, email: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">الاسم الكامل</label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20"
                  placeholder="الاسم (اختياري — يُستخدم البريد إذا تُرك فارغاً)"
                  value={user.full_name}
                  onChange={e => setUser(p => ({ ...p, full_name: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">الدور</label>
                <select
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20"
                  value={user.role}
                  onChange={e => setUser(p => ({ ...p, role: e.target.value }))}
                >
                  <option value="company_admin">مدير الشركة</option>
                  <option value="accountant">محاسب</option>
                  <option value="viewer">قارئ فقط</option>
                </select>
              </div>

              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-600 underline"
                onClick={() => setStep(4)}
              >
                تخطي هذه الخطوة
              </button>
            </div>
          )}

          {/* ── Step 4: Done ── */}
          {step === 4 && (
            <div className="text-center space-y-5 py-4" dir="rtl">
              <CheckCircle2 className="mx-auto text-emerald-500" size={48} />
              <div>
                <h2 className="text-lg font-bold text-slate-800">الشركة جاهزة!</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {company.name} مُهيَّأة وجاهزة للعمل.
                </p>
              </div>

              {userResult && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 text-right">
                  {userResult.created_new_user
                    ? `تم إنشاء حساب جديد للمستخدم ${user.email}`
                    : `تم ربط المستخدم الحالي ${user.email} بالشركة`
                  } بدور <strong>{user.role}</strong>.
                </div>
              )}

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => seedResult && navigate(`/admin`)}
                  className="w-full py-2.5 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium hover:bg-[#1a3d6b] transition-colors flex items-center justify-center gap-2"
                >
                  <Users size={15} />
                  الذهاب إلى لوحة الإدارة
                </button>
                <button
                  onClick={() => {
                    setStep(1)
                    setSeedResult(null)
                    setUserResult(null)
                    setError(null)
                    setCompany({ code: '', name: '', address: '', phone: '', fiscal_year: new Date().getFullYear() })
                    setUser({ email: '', full_name: '', role: 'company_admin' })
                  }}
                  className="w-full py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  إعداد شركة أخرى
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700" dir="rtl">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Navigation buttons */}
          {step < 4 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100" dir="ltr">
              <button
                onClick={() => { setError(null); setStep(s => (s > 1 ? (s - 1) as StepId : s)) }}
                disabled={step === 1 || step === 2}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-30 px-3 py-1.5 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <ChevronLeft size={14} />
                السابق
              </button>

              <button
                onClick={() => {
                  setError(null)
                  if (step === 1) handleCreateCompany()
                  else if (step === 2) setStep(3)
                  else if (step === 3) handleInviteUser()
                }}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 bg-[#0F2D5C] text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-[#1a3d6b] transition-colors"
              >
                {loading
                  ? <><Loader2 size={13} className="animate-spin" /> جارٍ المعالجة…</>
                  : step === 1 ? <><span>إنشاء الشركة</span><ChevronRight size={14} /></>
                  : step === 2 ? <><span>دعوة مستخدم</span><ChevronRight size={14} /></>
                  : <><span>إرسال الدعوة</span><ChevronRight size={14} /></>
                }
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
