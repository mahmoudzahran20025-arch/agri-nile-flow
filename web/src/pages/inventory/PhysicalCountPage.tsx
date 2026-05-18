import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardList, Warehouse, CheckCircle, AlertTriangle,
  ChevronLeft, ChevronRight, ArrowUpDown, Save, Trash2,
} from 'lucide-react'
import { inventoryApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import { useMovementPostingPipeline } from '../../hooks/workspace/useMovementPostingPipeline'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CountLine {
  item_code:       number
  item_name:       string
  unit:            string | null
  theoretical_qty: number
  counted_qty:     string
}

type Step = 1 | 2 | 3

const today = () => new Date().toISOString().slice(0, 10)
const NUM   = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)

// ─── Draft persistence ────────────────────────────────────────────────────────

const DRAFT_KEY = 'physical_count_draft'

interface CountDraft {
  warehouseName: string
  warehouseId:   number
  countDate:     string
  notes:         string
  lines:         CountLine[]
  savedAt:       string
}

function loadDraft(): CountDraft | null {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') } catch { return null }
}
function saveDraft(d: CountDraft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* quota */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
}
function formatTimeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1)  return 'الآن'
  if (mins < 60) return `منذ ${mins} دقيقة`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `منذ ${hours} ساعة`
  return `منذ ${Math.floor(hours / 24)} يوم`
}

// ─── Step Bar ─────────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1 as Step, label: 'اختيار المخزن' },
  { n: 2 as Step, label: 'ورقة الجرد' },
  { n: 3 as Step, label: 'مراجعة وترحيل' },
]

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center mb-6 select-none">
      {STEPS.map((s, idx) => (
        <div key={s.n} className="flex items-center flex-1 last:flex-none">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all
            ${current === s.n ? 'bg-brand-600 text-white shadow-sm'
              : current > s.n ? 'bg-green-500 text-white'
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PhysicalCountPage() {
  const qc       = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [step,        setStep]        = useState<Step>(1)
  const [warehouseName, setWarehouseName] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [countDate,   setCountDate]   = useState(today())
  const [notes,       setNotes]       = useState('')
  const [lines,       setLines]       = useState<CountLine[]>([])
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [posted,      setPosted]      = useState(false)
  const [onlyVariance, setOnlyVariance] = useState(false)
  const [savedDraft,  setSavedDraft]  = useState<CountDraft | null>(() => loadDraft())

  // Auto-save whenever lines change in step 2
  useEffect(() => {
    if (step !== 2 || !warehouseName || !warehouseId || lines.length === 0) return
    const d: CountDraft = { warehouseName, warehouseId, countDate, notes, lines, savedAt: new Date().toISOString() }
    saveDraft(d)
  }, [lines, step, warehouseName, warehouseId, countDate, notes])

  const recoverDraft = useCallback((d: CountDraft) => {
    setWarehouseName(d.warehouseName)
    setWarehouseId(d.warehouseId)
    setCountDate(d.countDate)
    setNotes(d.notes)
    setLines(d.lines)
    setSavedDraft(null)
    setStep(2)
  }, [])

  const discardSavedDraft = useCallback(() => {
    clearDraft()
    setSavedDraft(null)
  }, [])

  // ─── Data ──────────────────────────────────────────────────────────────────

  const { data: warehouseEntities = [] } = useQuery({
    queryKey: ['warehouses-setup'],
    queryFn: async () => {
      const res = await inventoryApi.warehousesSetup()
      return (res as any).entities ?? []
    },
    staleTime: 60_000,
  })

  const { data: balancesResp, isFetching: loadingStock } = useQuery({
    queryKey: ['inventory', 'stock-balances', warehouseName, 'physical-count'],
    queryFn: () => inventoryApi.balancesList({ warehouse: warehouseName, size: 2000 }),
    enabled: step >= 2 && !!warehouseName,
    staleTime: 0,
  })

  useEffect(() => {
    const data = (balancesResp as any)?.data ?? []
    if (step === 2 && data.length > 0 && lines.length === 0) {
      setLines(data.map((b: any) => ({
        item_code:       b.item_code,
        item_name:       b.item_name,
        unit:            b.unit,
        theoretical_qty: b.balance_qty,
        counted_qty:     String(b.balance_qty),
      })))
    }
  }, [balancesResp, step]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Computed ──────────────────────────────────────────────────────────────

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

  // ─── Navigation ────────────────────────────────────────────────────────────

  const goToStep2 = () => {
    if (!warehouseName || !warehouseId) { setError('اختر المخزن أولاً'); return }
    if (!countDate) { setError('التاريخ مطلوب'); return }
    setError('')
    setLines([])
    setStep(2)
  }

  // ─── Posting ───────────────────────────────────────────────────────────────

  const { post } = useMovementPostingPipeline()

  const postBatch = async (type: 'ADJUSTMENT_PROFIT' | 'ADJUSTMENT_LOSS', batchLines: typeof profitLines) => {
    if (batchLines.length === 0) return
    const snapshot = {
      id:         `adj-${type}-${Date.now()}`,
      version:    1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      header: {
        movement_date:       countDate,
        warehouse_id:        warehouseId,
        movement_type:       type,
        notes:               notes || 'تسوية جرد آلي',
        payment_method:      'credit' as const,
        supplier_code:       null,
        document_number:     '',
        target_warehouse_id: null,
      },
      dimensions: {
        season_id: null, field_id: null, work_order_id: null,
        center_code: null, service_type_code: '', statement_text: '',
      },
      lines: batchLines.map(l => ({
        _key:             `line-${l.item_code}`,
        item_code:        l.item_code,
        item_name:        l.item_name,
        item_unit:        l.unit ?? '',
        package_type:     null,
        package_capacity: null,
        pack_count:       null,
        quantity:         Math.abs(l.difference),
        _qty_derived:     false,
        total_value:      null,
        unit_price:       null,
        notes:            '',
        _available:       null,
        _stockLoading:    false,
        _error:           null,
        _warning:         null,
      })),
      meta: {
        source: 'manual' as const,
        recovery_state: 'clean' as const,
        last_persist_duration_ms: 0,
        autosave_enabled: false,
      },
    }
    const res = await post(snapshot, () => {})
    if (!res.success) throw new Error(String(res.error || `فشل ترحيل ${type}`))
  }

  const handlePost = async () => {
    if (!warehouseId) return
    setSaving(true)
    setError('')
    try {
      await postBatch('ADJUSTMENT_PROFIT', profitLines)
      await postBatch('ADJUSTMENT_LOSS',   lossLines)
      clearDraft()
      setPosted(true)
      await qc.invalidateQueries({ queryKey: ['inventory'], refetchType: 'active' })
      toast('تم ترحيل التسوية بنجاح', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع')
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
          <ClipboardList size={20} className="text-brand-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">جرد المخزون</h1>
          <p className="text-sm text-slate-500">أدخل الكميات الفعلية — النظام يحسب الفروقات ويرحلها تلقائياً</p>
        </div>
      </div>

      <StepBar current={step} />

      {/* ── Draft recovery banner ─────────────────────────────────────────── */}
      {step === 1 && savedDraft && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <Save size={15} className="text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-amber-800">مسودة جرد محفوظة: </span>
            <span className="text-amber-700">{savedDraft.warehouseName} · {savedDraft.countDate} · {savedDraft.lines.length} صنف</span>
            <span className="text-amber-500 mr-1">
              ({formatTimeAgo(savedDraft.savedAt)})
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => recoverDraft(savedDraft)}
              className="px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors"
            >
              استعادة
            </button>
            <button
              onClick={discardSavedDraft}
              className="p-1.5 text-amber-400 hover:text-amber-600 transition-colors"
              title="حذف المسودة"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 1: Setup ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">المخزن <span className="text-red-500">*</span></label>
              <select
                className="input"
                value={warehouseName}
                onChange={e => {
                  const name = e.target.value
                  setWarehouseName(name)
                  const entity = (warehouseEntities as { id: number; name: string }[]).find(x => x.name === name)
                  setWarehouseId(entity?.id ?? null)
                }}
              >
                <option value="">-- اختر المخزن --</option>
                {(warehouseEntities as { id: number; name: string }[]).map(w => (
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
            <label className="label">ملاحظات</label>
            <input
              type="text"
              className="input"
              placeholder="مثال: جرد نهاية الموسم..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertTriangle size={15} className="shrink-0" /> {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              className="btn-primary gap-1.5"
              onClick={goToStep2}
              disabled={!warehouseName || !warehouseId || loadingStock}
            >
              {loadingStock ? 'جاري تحميل الأرصدة...' : <>تحميل ورقة الجرد <ChevronLeft size={15} /></>}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Count Sheet ───────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-3 text-sm">
              <Warehouse size={15} className="text-brand-500" />
              <span className="font-semibold text-slate-700">{warehouseName}</span>
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

          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {displayLines.map(cl => (
              <div
                key={cl.item_code}
                className={`grid gap-2 items-center px-3 py-2.5 rounded-xl border transition-colors
                  ${cl.difference > 0 ? 'border-green-200 bg-green-50'
                  : cl.difference < 0 ? 'border-red-200 bg-red-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'}`}
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
                    l.item_code === cl.item_code ? { ...l, counted_qty: e.target.value } : l
                  ))}
                />
                <div className={`text-sm font-bold text-center
                  ${cl.difference === 0 ? 'text-slate-400'
                  : cl.difference > 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {cl.difference === 0 ? '—' : `${cl.difference > 0 ? '+' : ''}${NUM(cl.difference)}`}
                </div>
              </div>
            ))}
          </div>

          {withVariance.length > 0 && (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <div className="text-xs text-slate-500 mb-1">أصناف بفروقات</div>
                <div className="text-lg font-bold text-slate-700">{withVariance.length}</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <div className="text-xs text-green-600 mb-1">زيادة</div>
                <div className="text-lg font-bold text-green-700">{profitLines.length} صنف</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                <div className="text-xs text-red-600 mb-1">نقص</div>
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
            <button className="btn-primary gap-1.5" onClick={() => setStep(3)}>
              مراجعة وتأكيد <ChevronLeft size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Review & Post ─────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          {posted ? (
            <div className="bg-white border border-green-200 rounded-2xl p-8 text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-green-700 mb-1">تم الترحيل بنجاح</h2>
                <p className="text-slate-500 text-sm">تم تحديث أرصدة المخزون</p>
              </div>
              <div className="flex gap-3 justify-center">
                <button className="btn-secondary" onClick={() => navigate('/inventory')}>
                  العودة لأرصدة المخزون
                </button>
                <button className="btn-primary" onClick={() => navigate('/inventory/movements')}>
                  عرض الحركات
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <ClipboardList size={15} /> ملخص الجرد
                </h3>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                  <div className="flex gap-2"><span className="text-slate-500">المخزن:</span><span className="font-medium">{warehouseName}</span></div>
                  <div className="flex gap-2"><span className="text-slate-500">التاريخ:</span><span className="font-medium">{countDate}</span></div>
                  <div className="flex gap-2"><span className="text-slate-500">إجمالي الأصناف:</span><span className="font-medium">{lines.length}</span></div>
                  <div className="flex gap-2">
                    <span className="text-slate-500">أصناف بفروقات:</span>
                    <span className={`font-bold ${withVariance.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                      {withVariance.length}
                    </span>
                  </div>
                </div>
              </div>

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
                              {l.difference > 0 ? 'زيادة +' : 'نقص −'}
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
                  لا توجد فروقات — يمكنك إغلاق هذه الصفحة
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button className="btn-secondary gap-1.5" onClick={() => { setStep(2); setError('') }} disabled={saving}>
                  <ChevronRight size={15} /> تعديل الكميات
                </button>
                <button
                  className="btn-primary gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  onClick={handlePost}
                  disabled={saving || withVariance.length === 0}
                >
                  {saving
                    ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> جاري الترحيل...</>
                    : <><CheckCircle size={15} /> ترحيل التسوية</>
                  }
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
