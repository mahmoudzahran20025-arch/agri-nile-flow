import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Wheat, ChevronDown, Loader2, CheckCircle2, AlertTriangle,
  ArrowRight, Package, DollarSign, Scale,
} from 'lucide-react'
import { cropCyclesApi, type CropCycle } from '../../api/crop-cycles'
import { harvestSettlementsApi } from '../../api/harvest-settlements'
import { useToast } from '../../contexts/ToastContext'

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface FormState {
  disposition: 'stored' | 'sold' | ''
  settlement_date: string
  qty_tons: string
  // stored
  inventory_value: string
  // sold
  revenue: string
  buyer_name: string
  notes: string
}

const EMPTY: FormState = {
  disposition: '',
  settlement_date: new Date().toISOString().slice(0, 10),
  qty_tons: '',
  inventory_value: '',
  revenue: '',
  buyer_name: '',
  notes: '',
}

export default function HarvestSettlementPage() {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedCycleId, setSelectedCycleId] = useState<number | ''>('')
  const [draftId, setDraftId] = useState<number | null>(null)
  const [wipBalance, setWipBalance] = useState<number>(0)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [done, setDone] = useState(false)
  const [doneCycleName, setDoneCycleName] = useState('')

  // Active crop cycles only
  const { data: cycles = [], isLoading: cyclesLoading } = useQuery({
    queryKey: ['crop-cycles', { status: 'active' }],
    queryFn: () => cropCyclesApi.list({ status: 'active' }),
  })

  const selectedCycle = (cycles as CropCycle[]).find(c => c.id === selectedCycleId)

  // Create draft mutation
  const createDraft = useMutation({
    mutationFn: () => harvestSettlementsApi.create({
      crop_cycle_id:    selectedCycleId as number,
      disposition:      form.disposition as 'stored' | 'sold',
      settlement_date:  form.settlement_date || undefined,
      qty_tons:         form.qty_tons ? Number(form.qty_tons) : undefined,
      inventory_value:  form.inventory_value ? Number(form.inventory_value) : undefined,
      revenue:          form.revenue ? Number(form.revenue) : undefined,
      buyer_name:       form.buyer_name || undefined,
      notes:            form.notes || undefined,
    }),
    onSuccess: (data) => {
      setDraftId(data.id)
      setWipBalance(data.total_wip_cost)
      setStep(3)
    },
    onError: (e: any) => toast(e.message ?? 'فشل إنشاء المسودة', 'error'),
  })

  // Post mutation
  const postMut = useMutation({
    mutationFn: () => harvestSettlementsApi.post(draftId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crop-cycles'] })
      qc.invalidateQueries({ queryKey: ['harvest-settlements'] })
      setDoneCycleName(selectedCycle?.crop_name ?? '')
      setDone(true)
    },
    onError: (e: any) => toast(e.message ?? 'فشل ترحيل التسوية', 'error'),
  })

  function field<K extends keyof FormState>(k: K, val: FormState[K]) {
    setForm(f => ({ ...f, [k]: val }))
  }

  function resetAll() {
    setStep(1); setSelectedCycleId(''); setDraftId(null)
    setWipBalance(0); setForm(EMPTY); setDone(false); setDoneCycleName('')
  }

  const canProceedToConfirm = (() => {
    if (!form.disposition) return false
    if (form.disposition === 'stored' && !form.inventory_value) return false
    if (form.disposition === 'sold'   && !form.revenue) return false
    return true
  })()

  // ── Done screen ────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center py-20" dir="rtl">
        <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">تمت تسوية الحصاد</h2>
        <p className="text-gray-500 text-sm mb-6">
          دورة <span className="font-semibold text-gray-800">{doneCycleName}</span> تم ترحيلها بنجاح.
          رصيد WIP صُفِّر وحالة الدورة أصبحت <strong>محصودة</strong>.
        </p>
        <button
          onClick={resetAll}
          className="text-sm text-indigo-600 hover:text-indigo-700 underline"
        >
          تسوية دورة أخرى
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center shadow-sm">
          <Wheat size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تسوية الحصاد</h1>
          <p className="text-sm text-gray-500 mt-0.5">تحويل تكاليف WIP إلى مخزون أو إيراد بيع</p>
        </div>
      </div>

      {/* Step 1 — Select cycle */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>1</span>
          <h2 className="font-semibold text-gray-800">اختر دورة المحصول</h2>
        </div>

        {cyclesLoading ? (
          <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
        ) : (cycles as CropCycle[]).length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">لا توجد دورات نشطة حالياً</p>
        ) : (
          <div className="relative">
            <select
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 appearance-none"
              value={selectedCycleId}
              onChange={e => {
                setSelectedCycleId(e.target.value ? Number(e.target.value) : '')
                setStep(1); setDraftId(null); setForm(EMPTY)
              }}
            >
              <option value="">— اختر دورة —</option>
              {(cycles as CropCycle[]).map(c => (
                <option key={c.id} value={c.id}>
                  {c.crop_name} — {(c as any).field_name ?? `#${c.field_id}`} ({(c as any).season_name ?? `موسم ${c.season_id}`})
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}

        {/* Cycle info strip */}
        {selectedCycle && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-indigo-50 rounded-xl p-3 text-center">
              <p className="text-xs text-indigo-500 mb-0.5">المحصول</p>
              <p className="text-sm font-semibold text-indigo-800">{selectedCycle.crop_name}</p>
            </div>
            <div className="bg-indigo-50 rounded-xl p-3 text-center">
              <p className="text-xs text-indigo-500 mb-0.5">النوع</p>
              <p className="text-sm font-semibold text-indigo-800">{selectedCycle.crop_type}</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <p className="text-xs text-amber-600 mb-0.5">WIP الحالي</p>
              <p className="text-sm font-bold text-amber-800">
                {fmt(selectedCycle.wip_balance ?? 0)} ج.م
              </p>
            </div>
          </div>
        )}

        {selectedCycleId && step === 1 && (
          <button
            onClick={() => setStep(2)}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
          >
            التالي <ArrowRight size={15} />
          </button>
        )}
      </div>

      {/* Step 2 — Settlement details */}
      {step >= 2 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>2</span>
            <h2 className="font-semibold text-gray-800">بيانات التسوية</h2>
          </div>

          {/* Disposition */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">التصرف في المحصول *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => field('disposition', 'stored')}
                className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                  form.disposition === 'stored'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Package size={16} /> تخزين
              </button>
              <button
                type="button"
                onClick={() => field('disposition', 'sold')}
                className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                  form.disposition === 'sold'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <DollarSign size={16} /> بيع مباشر
              </button>
            </div>
          </div>

          {/* Common fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">تاريخ التسوية</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                value={form.settlement_date}
                onChange={e => field('settlement_date', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                <Scale size={11} className="inline mr-1" />الكمية (طن)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="اختياري"
                value={form.qty_tons}
                onChange={e => field('qty_tons', e.target.value)}
              />
            </div>
          </div>

          {/* Stored-specific */}
          {form.disposition === 'stored' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">قيمة المخزون (ج.م) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="القيمة الدفترية للمخزون"
                value={form.inventory_value}
                onChange={e => field('inventory_value', e.target.value)}
              />
              {form.inventory_value && selectedCycle?.wip_balance != null && (
                <p className="text-xs mt-1 text-gray-500">
                  التكلفة الفعلية: <span className="font-mono">{fmt(selectedCycle.wip_balance)}</span> ج.م —
                  الفرق: <span className={`font-mono font-semibold ${Number(form.inventory_value) - (selectedCycle.wip_balance ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmt(Number(form.inventory_value) - (selectedCycle.wip_balance ?? 0))}
                  </span> ج.م
                </p>
              )}
            </div>
          )}

          {/* Sold-specific */}
          {form.disposition === 'sold' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">إيراد البيع (ج.م) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="إجمالي قيمة البيع"
                  value={form.revenue}
                  onChange={e => field('revenue', e.target.value)}
                />
                {form.revenue && selectedCycle?.wip_balance != null && (
                  <p className="text-xs mt-1 text-gray-500">
                    هامش الربح المتوقع: <span className={`font-mono font-semibold ${Number(form.revenue) - (selectedCycle.wip_balance ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmt(Number(form.revenue) - (selectedCycle.wip_balance ?? 0))}
                    </span> ج.م
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">اسم المشتري</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="اختياري"
                  value={form.buyer_name}
                  onChange={e => field('buyer_name', e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ملاحظات</label>
            <textarea
              rows={2}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="اختياري"
              value={form.notes}
              onChange={e => field('notes', e.target.value)}
            />
          </div>

          <button
            onClick={() => createDraft.mutate()}
            disabled={!canProceedToConfirm || createDraft.isPending}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
          >
            {createDraft.isPending
              ? <><Loader2 size={15} className="animate-spin" /> جارٍ الإنشاء...</>
              : <>مراجعة وتأكيد <ArrowRight size={15} /></>
            }
          </button>
        </div>
      )}

      {/* Step 3 — Confirm & post */}
      {step === 3 && draftId != null && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">3</span>
            <h2 className="font-semibold text-gray-800">مراجعة القيود وترحيل التسوية</h2>
          </div>

          {/* GL preview */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-sm space-y-2">
            <p className="text-xs font-semibold text-slate-500 mb-3">القيود المحاسبية المتوقعة</p>

            {form.disposition === 'stored' ? (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-700">مخزون محاصيل (مدين)</span>
                  <span className="font-mono text-slateled-800">{fmt(Number(form.inventory_value))} ج.م</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-700">تكلفة الإنتاج الزراعي (دائن)</span>
                  <span className="font-mono text-slate-800">{fmt(wipBalance)} ج.م</span>
                </div>
                {Math.abs(Number(form.inventory_value) - wipBalance) > 0.01 && (
                  <div className="flex justify-between text-amber-700">
                    <span>{Number(form.inventory_value) > wipBalance ? 'فائض الإنتاج (دائن)' : 'خسارة إنتاج (مدين)'}</span>
                    <span className="font-mono">{fmt(Math.abs(Number(form.inventory_value) - wipBalance))} ج.م</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-700">تكلفة الإنتاج الزراعي (مدين)</span>
                  <span className="font-mono">{fmt(wipBalance)} ج.م</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-700">مخزون محاصيل (دائن)</span>
                  <span className="font-mono">{fmt(wipBalance)} ج.م</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 mt-2">
                  <span className="text-slate-700">نقدية/بنك (مدين)</span>
                  <span className="font-mono">{fmt(Number(form.revenue))} ج.م</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-700">إيراد محاصيل (دائن)</span>
                  <span className="font-mono">{fmt(Number(form.revenue))} ج.م</span>
                </div>
              </>
            )}
          </div>

          {wipBalance === 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>رصيد WIP يساوي صفر — سيتم الترحيل بدون تحريك مخزون WIP</span>
            </div>
          )}

          <button
            onClick={() => postMut.mutate()}
            disabled={postMut.isPending}
            className="w-full flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-bold transition-colors"
          >
            {postMut.isPending
              ? <><Loader2 size={16} className="animate-spin" /> جارٍ الترحيل...</>
              : <><CheckCircle2 size={16} /> ترحيل تسوية الحصاد</>
            }
          </button>

          <button
            onClick={() => { setStep(2); setDraftId(null) }}
            className="w-full text-sm text-gray-500 hover:text-gray-700 underline text-center"
          >
            العودة للتعديل
          </button>
        </div>
      )}

      {/* Empty state */}
      {!selectedCycleId && (
        <div className="text-center py-12 text-gray-400">
          <Wheat size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">اختر دورة محصول نشطة للبدء</p>
        </div>
      )}
    </div>
  )
}
