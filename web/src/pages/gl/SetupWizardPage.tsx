import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { glApi } from '../../api/gl'
import PostingGroupSelector from '../../components/gl/PostingGroupSelector'
import AccountPicker from '../../components/gl/AccountPicker'
import JournalEntryPreview from '../../components/gl/JournalEntryPreview'

const STORAGE_KEY = 'gl-setup-wizard-draft'

const STEPS = [
  'مرحباً',
  'مراجعة المجموعات',
  'مراجعة الحسابات',
  'اختبار القيد',
  'الانطلاق',
]

export default function SetupWizardPage() {
  const [step, setStep] = useState(0)
  const [bpg, setBpg] = useState<string | null>(null)
  const [ppg, setPpg] = useState<string | null>(null)
  const [inventoryAccount, setInventoryAccount] = useState<string | null>('140701')
  const [receivableAccount, setReceivableAccount] = useState<string | null>('1403')
  const [amount, setAmount] = useState(1000)

  const { data: health } = useQuery({ queryKey: ['posting-setup-health'], queryFn: () => glApi.postingHealth() })
  const { data: preview } = useQuery({
    queryKey: ['wizard-preview', bpg, ppg, receivableAccount, amount],
    queryFn: () => glApi.validatePosting({ type: 'revenue', bpg_code: bpg, ppg_code: ppg, receivable_code: receivableAccount ?? undefined, amount }),
    enabled: step >= 3 && !!receivableAccount,
  })

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as { bpg: string | null; ppg: string | null; inventoryAccount: string | null; receivableAccount: string | null; amount: number; step: number }
      setBpg(draft.bpg)
      setPpg(draft.ppg)
      setInventoryAccount(draft.inventoryAccount)
      setReceivableAccount(draft.receivableAccount)
      setAmount(draft.amount)
      setStep(draft.step)
    } catch {
      // ignore invalid localStorage
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bpg, ppg, inventoryAccount, receivableAccount, amount, step }))
  }, [amount, bpg, inventoryAccount, ppg, receivableAccount, step])

  const completion = useMemo(() => Math.round(((step + 1) / STEPS.length) * 100), [step])

  return (
    <div className="animate-fade-in space-y-6">
      <div className="page-header">
        <h1 className="page-title">معالج إعداد الترحيل</h1>
        <p className="text-sm text-slate-500 mt-1">مسار سريع لإكمال الإعداد الأولي والتحقق قبل التشغيل الفعلي.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
          <span>الخطوة {step + 1} من {STEPS.length}</span>
          <span>{completion}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${completion}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {STEPS.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(index)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${index === step ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="card p-6 space-y-4">
          <p className="text-sm text-slate-600">
            هذا المعالج يساعدك على التأكد أن إعداد الترحيل جاهز: مجموعات الترحيل موجودة، الحسابات الأساسية واضحة، وتجربة القيد تنجح قبل العمل اليومي.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs text-slate-500">حالة الجاهزية</div>
              <div className="mt-2 text-lg font-bold text-slate-800">{health?.is_ready ? 'جاهز' : 'يحتاج مراجعة'}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs text-slate-500">المشكلات الحرجة</div>
              <div className="mt-2 text-lg font-bold text-slate-800">{health?.issues.length ?? 0}</div>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-6">
            <PostingGroupSelector
              type="business"
              value={bpg}
              onChange={setBpg}
              label="مجموعة الأعمال النموذجية"
              showRecent
              helpText="اختر مجموعة أعمال شائعة لاستخدامها كنموذج تجريبي داخل المعالج."
            />
          </div>
          <div className="card p-6">
            <PostingGroupSelector
              type="product"
              value={ppg}
              onChange={setPpg}
              label="مجموعة المنتج النموذجية"
              showRecent
              helpText="يمكن تركها فارغة لاختبار قاعدة الافتراضي NULL/NULL."
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-6">
            <AccountPicker
              value={inventoryAccount}
              onChange={setInventoryAccount}
              accountType="asset"
              label="حساب مخزون مرجعي"
              required
            />
          </div>
          <div className="card p-6">
            <AccountPicker
              value={receivableAccount}
              onChange={setReceivableAccount}
              accountType="asset"
              label="حساب مدينين مرجعي"
              required
            />
          </div>
          <div className="card p-6 col-span-2">
            <label className="label text-xs">قيمة اختبار القيد</label>
            <input className="input max-w-xs" type="number" value={amount} onChange={event => setAmount(Number(event.target.value) || 0)} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <JournalEntryPreview blueprint={preview ?? null} title="معاينة قيد إيراد تجريبي" />
          <div className="card p-5 text-sm text-slate-600">
            إذا ظهرت أخطاء هنا، ارجع إلى صفحة الإعداد أو لوحة الصحة قبل بدء الإدخال الحقيقي.
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card p-6 space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            انتهى المعالج. عند هذه النقطة يكون لديك مسار واضح: راجع الصحة، أكمل أي مجموعات ناقصة، ثم ابدأ إدخال البيانات الحقيقية.
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Link to="/gl/posting-setup/health" className="btn-secondary text-center">لوحة الصحة</Link>
            <Link to="/gl/posting-setup" className="btn-secondary text-center">صفحة الإعداد</Link>
            <Link to="/gl/posting-groups" className="btn-secondary text-center">إدارة المجموعات</Link>
            <Link to="/gl/entries" className="btn-secondary text-center">قيود اليومية</Link>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button type="button" className="btn-secondary" disabled={step === 0} onClick={() => setStep(current => Math.max(0, current - 1))}>السابق</button>
        <button type="button" className="btn-primary" disabled={step === STEPS.length - 1} onClick={() => setStep(current => Math.min(STEPS.length - 1, current + 1))}>التالي</button>
      </div>
    </div>
  )
}
