import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardList, Warehouse, CheckCircle, AlertTriangle,
  ChevronLeft, ChevronRight, ArrowUpDown, Info,
} from 'lucide-react'
import { inventoryApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'

// ─── Types ────────────────────────────────────────────────────

interface CountLine {
  item_code: number
  item_name: string
  unit: string | null
  theoretical_qty: number
  counted_qty: string   // string for controlled input
}

type Step = 1 | 2 | 3

// ─── Helpers ──────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)
const NUM   = (n: number, dp = 3) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: dp }).format(n)

// ─── Step Indicator ───────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'اختيار المخزن' },
  { n: 2, label: 'ورقة الجرد' },
  { n: 3, label: 'مراجعة وترحيل' },
]

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center mb-6 select-none">
      {STEPS.map((s, idx) => (
        <div key={s.n} className="flex items-center flex-1 last:flex-none">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all
            ${current === s.n
              ? 'bg-brand-600 text-white shadow-sm'
              : current > s.n
              ? 'bg-green-500 text-white'
              : 'bg-slate-100 text-slate-400'}`}>
            <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs font-bold shrink-0">
              {current > s.n ? '✓' : s.n}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {idx < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-1.5 rounded transition-colors ${current > s.n ? 'bg-green-400' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────

export default function PhysicalCountPage() {
  const qc       = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [step,         setStep]         = useState<Step>(1)
  const [warehouse,    setWarehouse]    = useState('')
  const [warehouseId,  setWarehouseId]  = useState<number | null>(null)
  const [countDate,    setCountDate]    = useState(today())
  const [notes,        setNotes]        = useState('')
  const [lines,        setLines]        = useState<CountLine[]>([])
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [adjId,        setAdjId]        = useState<number | null>(null)
  const [posted,       setPosted]       = useState(false)
  const [onlyVariance, setOnlyVariance] = useState(false)

  // ─── Queries ─────────────────────────────────────────────

  const { data: warehouseEntities = [] } = useQuery({
    queryKey: ['warehouses-setup'],
    queryFn:  async () => {
      const res = await inventoryApi.warehousesSetup()
      return (res as unknown as { entities: Array<{ id: number; name: string }> }).entities ?? []
    },
    staleTime: 60_000,
  })

  const {
    data: balancesResp,
    isFetching: loadingStock,
  } = useQuery({
    queryKey: ['inventory', 'stock-balances', warehouse, 'physical-count'],
    queryFn:  () => inventoryApi.balancesList({ warehouse, size: 2000 }),
    enabled:  step >= 2 && !!warehouse,
    staleTime: 0,
  })

  const balanceData = (balancesResp as unknown as { data?: Array<{ item_code: number; item_name: string; unit: string | null; balance_qty: number }> })?.data ?? []

  // Populate lines when balance data arrives (query fires after step transitions to 2)
  useEffect(() => {
    if (step === 2 && balanceData.length > 0 && lines.length === 0) {
      setLines(balanceData.map(b => ({
        item_code:       b.item_code,
        item_name:       b.item_name,
        unit:            b.unit,
        theoretical_qty: b.balance_qty,
        counted_qty:     String(b.balance_qty),
      })))
    }
  }, [balancesResp, step]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Variance computations ────────────────────────────────

  const computedLines = useMemo(() =>
    lines.map(l => ({
      ...l,
      counted:    Number(l.counted_qty) || 0,
      difference: (Number(l.counted_qty) || 0) - l.theoretical_qty,
    })),
  [lines])

  const withVariance = computedLines.filter(l => l.difference !== 0)
  const profitLines  = withVariance.filter(l => l.difference > 0)
  const lossLines    = withVariance.filter(l => l.difference < 0)

  const displayLines = onlyVariance ? computedLines.filter(l => l.difference !== 0) : computedLines

  // ─── Navigation ──────────────────────────────────────────

  const goToStep2 = () => {
    if (!warehouse || !warehouseId) { setError('اختر المخزن أولاً'); return }
    if (!countDate) { setError('التاريخ مطلوب'); return }
    setError('')
    setLines([])   // cleared — useEffect will repopulate when query resolves
    setStep(2)
  }

  const goToStep3 = () => {
    setError('')
    setStep(3)
  }

  // ─── Submit: create adjustment + lines ───────────────────

  const handleSaveDraft = async () => {
    if (!warehouseId) return
    setSaving(true); setError('')
    try {
      const payload = {
        warehouse_id:    warehouseId,
        adjustment_date: countDate,
        notes:           notes || 'جرد مخزني دوري',
        lines: lines.map(l => ({
          item_code:       l.item_code,
          theoretical_qty: l.theoretical_qty,
          counted_qty:     Number(l.counted_qty) || 0,
          notes:           undefined,
        })),
      }
      const res = await inventoryApi.createAdjustment(payload) as { success: boolean; id: number; error?: string }
      if (!res.success) { setError(res.error ?? 'حدث خطأ'); return }
      setAdjId(res.id)
      toast('تم حفظ ورقة الجرد كمسودة بنجاح', 'success')
    } catch {
      setError('خطأ في الاتصال بالخادم')
    } finally {
      setSaving(false)
    }
  }

  const handlePost = async () => {
    if (!adjId) return
    setSaving(true); setError('')
    try {
      const res = await inventoryApi.postAdjustment(adjId) as { success: boolean; error?: string }
      if (!res.success) { setError(res.error ?? 'فشل الترحيل'); return }
      setPosted(true)
      await qc.invalidateQueries({ queryKey: ['inventory'], refetchType: 'active' })
      toast('تم ترحيل تسوية الجرد بنجاح — تم تحديث الأرصدة', 'success')
    } catch {
      setError('خطأ في الاتصال بالخادم')
    } finally {
      setSaving(false)
    }
  }

  // ─── Post directly after create (single action) ───────────

  const handleCreateAndPost = async () => {
    if (!warehouseId) return
    setSaving(true); setError('')
    try {
      const payload = {
        warehouse_id:    warehouseId,
        adjustment_date: countDate,
        notes:           notes || 'جرد مخزني دوري',
        lines: lines.map(l => ({
          item_code:       l.item_code,
          theoretical_qty: l.theoretical_qty,
          counted_qty:     Number(l.counted_qty) || 0,
        })),
      }
      const createRes = await inventoryApi.createAdjustment(payload) as { success: boolean; id: number; error?: string }
      if (!createRes.success) { setError(createRes.error ?? 'حدث خطأ في الإنشاء'); return }

      const postRes = await inventoryApi.postAdjustment(createRes.id) as { success: boolean; error?: string }
      if (!postRes.success) {
        setError(`تم الحفظ (ID: ${createRes.id}) لكن فشل الترحيل: ${postRes.error ?? ''}`)
        setAdjId(createRes.id)
        return
      }
      setAdjId(createRes.id)
      setPosted(true)
      await qc.invalidateQueries({ queryKey: ['inventory'], refetchType: 'active' })
      toast('تم ترحيل تسوية الجرد بنجاح — تم تحديث الأرصدة', 'success')
    } catch {
      setError('خطأ في الاتصال بالخادم')
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
          <ClipboardList size={20} className="text-brand-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">جرد المخزون (Physical Count)</h1>
          <p className="text-sm text-slate-500">أدخل الكميات الفعلية لكل صنف — النظام يحسب الفروقات ويرحلها تلقائياً</p>
        </div>
      </div>

      <StepBar current={step} />

      {/* ───── STEP 1: Setup ─────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">المخزن <span className="text-red-500">*</span></label>
              <select
                className="input"
                value={warehouse}
                onChange={e => {
                  const w = e.target.value
                  setWarehouse(w)
                  const entity = warehouseEntities.find(x => x.name === w)
                  setWarehouseId(entity?.id ?? null)
                }}
              >
                <option value="">-- اختر المخزن --</option>
                {warehouseEntities.map(w => (
                  <option key={w.id} value={w.name}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">تاريخ الجرد <span className="text-red-500">*</span></label>
              <input
                type="date"
                className="input"
                value={countDate}
                onChange={e => setCountDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">ملاحظات (اختياري)</label>
            <input
              type="text"
              className="input"
              placeholder="مثال: جرد نهاية الموسم، تسوية فصلية..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 flex items-start gap-2 text-sm text-blue-800">
            <Info size={15} className="shrink-0 mt-0.5" />
            <span>
              سيتم تحميل الأرصدة الحالية لجميع أصناف المخزن المختار.
              أدخل الكميات الفعلية المحسوبة — النظام يحسب الفروقات ويرحل تسوية <strong>ADJUSTMENT_PROFIT/LOSS</strong> تلقائياً.
            </span>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertTriangle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              className="btn-primary gap-1.5"
              onClick={goToStep2}
              disabled={!warehouse || !warehouseId || loadingStock}
            >
              {loadingStock ? 'جاري تحميل الأرصدة...' : <>تحميل ورقة الجرد <ChevronLeft size={15} /></>}
            </button>
          </div>
        </div>
      )}

      {/* ───── STEP 2: Count Sheet ───────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Context bar */}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-3 text-sm">
              <Warehouse size={15} className="text-brand-500" />
              <span className="font-semibold text-slate-700">{warehouse}</span>
              <span className="text-slate-400">{countDate}</span>
              <span className="text-slate-500">{lines.length} صنف</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyVariance}
                onChange={e => setOnlyVariance(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              عرض الفروقات فقط
            </label>
          </div>

          {/* Column headers */}
          <div
            className="grid text-xs font-semibold text-slate-400 uppercase tracking-wide px-3"
            style={{ gridTemplateColumns: '2fr 80px 110px 110px 100px' }}
          >
            <span>الصنف</span>
            <span className="text-center">الوحدة</span>
            <span className="text-center">الرصيد النظري</span>
            <span className="text-center">الكمية المحسوبة</span>
            <span className="text-center">الفرق</span>
          </div>

          {/* Lines */}
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {displayLines.map((cl) => {
              const diff    = cl.difference
              const isProfit = diff > 0
              const isLoss   = diff < 0
              return (
                <div
                  key={cl.item_code}
                  className={`grid gap-2 items-center px-3 py-2.5 rounded-xl border transition-colors
                    ${isProfit ? 'border-green-200 bg-green-50' : isLoss ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  style={{ gridTemplateColumns: '2fr 80px 110px 110px 100px' }}
                >
                  <span className="text-sm font-medium text-slate-700">{cl.item_name}</span>
                  <span className="text-xs text-slate-400 text-center">{cl.unit ?? '—'}</span>
                  <span className="text-sm text-center text-slate-600">{NUM(cl.theoretical_qty)}</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="input text-sm py-1.5 text-center w-full"
                    value={cl.counted_qty}
                    onChange={e => setLines(ls => ls.map(l =>
                      l.item_code === cl.item_code
                        ? { ...l, counted_qty: e.target.value }
                        : l
                    ))}
                  />
                  <div className={`text-sm font-bold text-center
                    ${diff === 0 ? 'text-slate-400' : isProfit ? 'text-green-700' : 'text-red-700'}`}>
                    {diff === 0 ? '—' : `${isProfit ? '+' : ''}${NUM(diff)}`}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Variance summary */}
          {withVariance.length > 0 && (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <div className="text-xs text-slate-500 mb-1">أصناف بفروقات</div>
                <div className="text-lg font-bold text-slate-700">{withVariance.length}</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <div className="text-xs text-green-600 mb-1">زيادة (ADJUSTMENT_PROFIT)</div>
                <div className="text-lg font-bold text-green-700">{profitLines.length} صنف</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                <div className="text-xs text-red-600 mb-1">نقص (ADJUSTMENT_LOSS)</div>
                <div className="text-lg font-bold text-red-700">{lossLines.length} صنف</div>
              </div>
            </div>
          )}

          {withVariance.length === 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
              <CheckCircle size={15} className="shrink-0" />
              لا توجد فروقات — الجرد مطابق للنظام
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button className="btn-secondary gap-1.5" onClick={() => { setStep(1); setError('') }}>
              <ChevronRight size={15} /> السابق
            </button>
            <button className="btn-primary gap-1.5" onClick={goToStep3}>
              مراجعة وتأكيد <ChevronLeft size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ───── STEP 3: Review & Post ─────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          {posted ? (
            // Success state
            <div className="bg-white border border-green-200 rounded-2xl p-8 text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-green-700 mb-1">تم الترحيل بنجاح</h2>
                <p className="text-slate-500 text-sm">تم تحديث أرصدة المخزون — التسوية رقم <strong>#{adjId}</strong></p>
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  className="btn-secondary"
                  onClick={() => navigate('/inventory/adjustments')}
                >
                  عرض التسويات
                </button>
                <button
                  className="btn-primary"
                  onClick={() => navigate('/inventory')}
                >
                  العودة لأرصدة المخزون
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <ClipboardList size={15} /> ملخص الجرد
                </h3>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                  <div className="flex gap-2"><span className="text-slate-500">المخزن:</span><span className="font-medium">{warehouse}</span></div>
                  <div className="flex gap-2"><span className="text-slate-500">التاريخ:</span><span className="font-medium">{countDate}</span></div>
                  <div className="flex gap-2"><span className="text-slate-500">إجمالي الأصناف:</span><span className="font-medium">{lines.length}</span></div>
                  <div className="flex gap-2"><span className="text-slate-500">أصناف بفروقات:</span><span className={`font-bold ${withVariance.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>{withVariance.length}</span></div>
                  {profitLines.length > 0 && <div className="flex gap-2"><span className="text-slate-500">زيادة (+):</span><span className="font-bold text-green-700">{profitLines.length} صنف</span></div>}
                  {lossLines.length > 0 && <div className="flex gap-2"><span className="text-slate-500">نقص (−):</span><span className="font-bold text-red-700">{lossLines.length} صنف</span></div>}
                </div>
              </div>

              {/* Variance detail table */}
              {withVariance.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <ArrowUpDown size={12} /> الأصناف ذات الفروقات
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">الصنف</th>
                        <th className="text-center py-2 px-3 text-slate-400 font-medium">نظري</th>
                        <th className="text-center py-2 px-3 text-slate-400 font-medium">محسوب</th>
                        <th className="text-center py-2 px-3 text-slate-400 font-medium">الفرق</th>
                        <th className="text-center py-2 px-3 text-slate-400 font-medium">نوع التسوية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {withVariance.map(l => (
                        <tr key={l.item_code} className={`border-t border-slate-100 ${l.difference > 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                          <td className="py-2 px-3 font-medium">{l.item_name}</td>
                          <td className="py-2 px-3 text-center text-slate-600">{NUM(l.theoretical_qty)}</td>
                          <td className="py-2 px-3 text-center text-slate-600">{NUM(l.counted)}</td>
                          <td className={`py-2 px-3 text-center font-bold ${l.difference > 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {l.difference > 0 ? '+' : ''}{NUM(l.difference)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full
                              ${l.difference > 0 ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                              {l.difference > 0 ? 'PROFIT +' : 'LOSS −'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {withVariance.length === 0 && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
                  <CheckCircle size={15} className="shrink-0" />
                  لا توجد فروقات — الجرد مطابق للنظام. يمكنك حفظ ورقة الجرد كسجل.
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-2">
                <button className="btn-secondary gap-1.5" onClick={() => { setStep(2); setError('') }} disabled={saving}>
                  <ChevronRight size={15} /> تعديل الكميات
                </button>
                <div className="flex gap-2">
                  {/* Save draft (no GL posting) */}
                  {!adjId && (
                    <button
                      className="btn-secondary gap-1.5"
                      onClick={handleSaveDraft}
                      disabled={saving}
                    >
                      {saving ? 'جاري الحفظ...' : 'حفظ كمسودة فقط'}
                    </button>
                  )}
                  {/* Post existing draft */}
                  {adjId && !posted && (
                    <button
                      className="btn-primary gap-1.5"
                      onClick={handlePost}
                      disabled={saving}
                    >
                      {saving
                        ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span> جاري الترحيل...</>
                        : <><CheckCircle size={15} /> ترحيل المسودة #{adjId}</>
                      }
                    </button>
                  )}
                  {/* Save + Post immediately */}
                  {!adjId && (
                    <button
                      className="btn-primary gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      onClick={handleCreateAndPost}
                      disabled={saving}
                    >
                      {saving
                        ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span> جاري الترحيل...</>
                        : <><CheckCircle size={15} /> حفظ وترحيل فوراً</>
                      }
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
