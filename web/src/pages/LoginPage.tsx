import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Leaf, Loader2, Eye, EyeOff } from 'lucide-react'
import { authApi } from '../api/client'
import { useAppStore } from '../store/appStore'
import type { Company } from '../types'

type Step = 'email' | 'company' | 'password'

export default function LoginPage() {
  const navigate  = useNavigate()
  const { setAuth } = useAppStore()

  const [step, setStep]         = useState<Step>('email')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleEmailStep = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const list = await authApi.companies(email)
      if (!list.length) { setError('البريد الإلكتروني غير مسجل في النظام'); return }
      setCompanies(list as Company[])
      if (list.length === 1) { setSelectedCompany(list[0] as Company); setStep('password') }
      else setStep('company')
    } catch { setError('خطأ في الاتصال بالخادم') }
    finally { setLoading(false) }
  }

  const handleCompanyStep = (company: Company) => {
    setSelectedCompany(company)
    setStep('password')
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCompany) return
    setError(''); setLoading(true)
    try {
      const res = await authApi.login(email, password, selectedCompany.id)
      if (!res.success) { setError(res.error); return }
      setAuth(res.data.token, res.data.user as never, selectedCompany, res.data.user.role)
      navigate('/dashboard', { replace: true })
    } catch { setError('خطأ في الاتصال بالخادم') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700
                    flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10
                          rounded-2xl mb-4 backdrop-blur-sm">
            <Leaf size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">نواة المستقبل</h1>
          <p className="text-brand-200 text-sm mt-1">نظام إدارة الموارد الزراعية</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Step: Email */}
          {step === 'email' && (
            <form onSubmit={handleEmailStep} className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-1">تسجيل الدخول</h2>
                <p className="text-sm text-slate-500">أدخل بريدك الإلكتروني للمتابعة</p>
              </div>
              <div>
                <label className="label">البريد الإلكتروني</label>
                <input
                  type="email" required autoFocus
                  value={email} onChange={e => setEmail(e.target.value)}
                  className="input ltr"
                  placeholder="example@company.com"
                  dir="ltr"
                />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                متابعة
              </button>
            </form>
          )}

          {/* Step: Company selection */}
          {step === 'company' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-1">اختر الشركة</h2>
                <p className="text-sm text-slate-500">{email}</p>
              </div>
              <div className="space-y-2">
                {companies.map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleCompanyStep(c)}
                    className="w-full text-right px-4 py-3 rounded-xl border-2 border-slate-200
                               hover:border-brand-500 hover:bg-brand-50 transition-colors group"
                  >
                    <p className="font-semibold text-slate-800 group-hover:text-brand-700">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.code}</p>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep('email')} className="btn-ghost w-full justify-center text-sm">
                تغيير البريد الإلكتروني
              </button>
            </div>
          )}

          {/* Step: Password */}
          {step === 'password' && selectedCompany && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-1">{selectedCompany.name}</h2>
                <p className="text-sm text-slate-500">{email}</p>
              </div>
              <div>
                <label className="label">كلمة المرور</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'} required autoFocus
                    value={password} onChange={e => setPassword(e.target.value)}
                    className="input ltr pl-10"
                    placeholder="••••••••"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                دخول
              </button>
              <button
                type="button"
                onClick={() => { setStep(companies.length > 1 ? 'company' : 'email'); setPassword(''); setError('') }}
                className="btn-ghost w-full justify-center text-sm"
              >
                رجوع
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-brand-300 text-xs mt-6">
          Agri Nile Flow v1.0 — نواة المستقبل © 2025
        </p>
      </div>
    </div>
  )
}
