import { useEffect, useState } from 'react'
import { X, BookOpen, Package, Shield, ClipboardCheck, Loader2, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react'
import { useWorkspacePanelStore, type SidePanelTab } from '../../hooks/workspace/useWorkspacePanelStore'
import { inventoryApi } from '../../api/client'
import { validateDraftForSubmission } from './validateDraftForSubmission'
import type { MovementDraft } from './types'

// ─── Tab definitions ─────────────────────────────────────────────────────────

const TABS: { key: SidePanelTab; label: string; icon: React.ReactNode }[] = [
  { key: 'gl',         label: 'القيد المحاسبي', icon: <BookOpen size={14} />       },
  { key: 'stock',      label: 'الأرصدة',        icon: <Package size={14} />        },
  { key: 'health',     label: 'صحة الترحيل',    icon: <Shield size={14} />         },
  { key: 'validation', label: 'التحقق',          icon: <ClipboardCheck size={14} /> },
]

// ─── GL Preview Tab ───────────────────────────────────────────────────────────

function GlPreviewTab({ draft }: { draft: MovementDraft | null }) {
  type GlLine = { side: 'DR' | 'CR'; account_code: string; account_label: string; amount: number; narration: string }
  type GlPreviewResult = { item_name: string; item_unit: string | null; unit_price: number; value: number; is_balanced: boolean; warnings: string[]; lines: GlLine[] }

  const [result, setResult] = useState<GlPreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedLineIdx, setSelectedLineIdx] = useState(0)

  const filledLines = draft?.lines.filter(l => l.item_code != null && (l.quantity ?? 0) > 0) ?? []
  const activeLine = filledLines[selectedLineIdx]

  const movementType = draft?.header.movement_type ?? ''
  const warehouse = draft?.header.warehouse_id ?? null

  useEffect(() => {
    setSelectedLineIdx(0)
  }, [draft?.header.movement_type, draft?.header.warehouse_id])

  const fetch = async () => {
    if (!activeLine || !warehouse || !movementType) return
    setLoading(true)
    setError(null)
    try {
      const res = await inventoryApi.glPreview({
        warehouse: String(warehouse),
        item_code: activeLine.item_code!,
        movement_type: movementType as any,
        quantity: activeLine.quantity ?? 0,
        unit_price: activeLine.unit_price ?? undefined,
        center_code: draft?.dimensions.center_code ?? undefined,
      })
      setResult(res)
    } catch (e: any) {
      setError(e?.message ?? 'خطأ في جلب معاينة القيد')
    } finally {
      setLoading(false)
    }
  }

  // Auto-fetch when active line changes
  useEffect(() => {
    if (activeLine) fetch()
    else setResult(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLine?.item_code, activeLine?.quantity, activeLine?.unit_price, warehouse, movementType])

  if (!draft || filledLines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
        <BookOpen size={32} className="text-slate-200 mb-3" />
        <p className="text-sm text-slate-400">أضف صنفاً لمعاينة القيد المحاسبي</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Line selector */}
      {filledLines.length > 1 && (
        <div className="px-3 py-2 border-b border-slate-100 flex gap-1 overflow-x-auto">
          {filledLines.map((l, idx) => (
            <button
              key={l._key}
              onClick={() => setSelectedLineIdx(idx)}
              className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full font-semibold transition-colors ${
                idx === selectedLineIdx
                  ? 'bg-[#0F2D5C] text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {l.item_name || `#${l.item_code}`}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-slate-300" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-xs text-red-500">{error}</p>
            <button onClick={fetch} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
              <RefreshCw size={11} /> إعادة المحاولة
            </button>
          </div>
        ) : result ? (
          <>
            {/* Summary */}
            <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">الصنف</span>
                <span className="font-semibold text-slate-700">{result.item_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">القيمة</span>
                <span className="font-semibold text-slate-700">{result.value.toLocaleString('en-US')} ج.م</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">التوازن</span>
                {result.is_balanced ? (
                  <span className="text-green-600 font-semibold flex items-center gap-1"><CheckCircle size={11} /> متوازن</span>
                ) : (
                  <span className="text-red-500 font-semibold flex items-center gap-1"><AlertTriangle size={11} /> غير متوازن</span>
                )}
              </div>
            </div>

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <div className="space-y-1">
                {result.warnings.map((w, i) => (
                  <div key={i} className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5 flex items-start gap-2">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* Journal lines */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-3 bg-slate-100 px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <span>الحساب</span>
                <span className="text-center">مدين</span>
                <span className="text-center">دائن</span>
              </div>
              {result.lines.map((line, i) => (
                <div key={i} className="grid grid-cols-3 px-3 py-2 text-xs border-t border-slate-100 hover:bg-slate-50">
                  <div>
                    <div className="font-mono text-slate-500 text-[10px]">{line.account_code}</div>
                    <div className="text-slate-700 font-medium">{line.account_label}</div>
                  </div>
                  <div className="text-center font-mono text-slate-700">
                    {line.side === 'DR' ? line.amount.toLocaleString('en-US') : '—'}
                  </div>
                  <div className="text-center font-mono text-slate-700">
                    {line.side === 'CR' ? line.amount.toLocaleString('en-US') : '—'}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

// ─── Stock Balance Tab ────────────────────────────────────────────────────────

function StockBalanceTab({ draft }: { draft: MovementDraft | null }) {
  type BalanceRow = { warehouse: string; balance_qty: number; balance_value: number }
  type ItemBalance = { item_code: number; item_name: string; total_qty: number; by_warehouse: BalanceRow[] }

  const [balances, setBalances] = useState<ItemBalance[]>([])
  const [loading, setLoading] = useState(false)

  const filledLines = draft?.lines.filter(l => l.item_code != null && (l.quantity ?? 0) > 0) ?? []
  const uniqueCodes = [...new Set(filledLines.map(l => l.item_code!))]

  useEffect(() => {
    if (uniqueCodes.length === 0) { setBalances([]); return }
    let cancelled = false
    setLoading(true)
    Promise.all(
      uniqueCodes.map(code =>
        inventoryApi.itemStock(code).then(r => ({
          item_code: code,
          item_name: filledLines.find(l => l.item_code === code)?.item_name ?? String(code),
          total_qty: r.total_qty,
          by_warehouse: r.by_warehouse as BalanceRow[],
        }))
      )
    ).then(res => {
      if (!cancelled) setBalances(res)
    }).catch(() => {
      if (!cancelled) setBalances([])
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueCodes.join(',')])

  if (!draft || filledLines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
        <Package size={32} className="text-slate-200 mb-3" />
        <p className="text-sm text-slate-400">أضف صنفاً لعرض أرصدة المخزون</p>
      </div>
    )
  }

  const warehouseId = draft.header.warehouse_id

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-slate-300" />
        </div>
      ) : balances.map(item => {
        const requestedQty = filledLines
          .filter(l => l.item_code === item.item_code)
          .reduce((s, l) => s + (l.quantity ?? 0), 0)
        const warehouseBalance = (item.by_warehouse as BalanceRow[])
          .find(r => String(r.warehouse) === String(warehouseId))?.balance_qty ?? 0
        const wouldGoNegative = warehouseBalance < requestedQty

        return (
          <div key={item.item_code} className="border border-slate-200 rounded-xl overflow-hidden">
            <div className={`px-3 py-2 flex items-center justify-between text-xs font-semibold ${
              wouldGoNegative ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700'
            }`}>
              <span>{item.item_name}</span>
              <span className="font-mono">{item.total_qty.toLocaleString('en-US')}</span>
            </div>
            {(item.by_warehouse as BalanceRow[]).map(r => (
              <div key={r.warehouse} className="grid grid-cols-3 px-3 py-1.5 text-xs border-t border-slate-100">
                <span className="text-slate-500">{r.warehouse}</span>
                <span className="text-center font-mono text-slate-700">{r.balance_qty.toLocaleString('en-US')}</span>
                <span className="text-center font-mono text-slate-500">{r.balance_value.toLocaleString('en-US')} ج.م</span>
              </div>
            ))}
            {wouldGoNegative && (
              <div className="px-3 py-2 bg-red-50 text-[11px] text-red-600 flex items-center gap-1.5 border-t border-red-100">
                <AlertTriangle size={11} />
                الرصيد ({warehouseBalance.toLocaleString('en-US')}) أقل من الكمية المطلوبة ({requestedQty.toLocaleString('en-US')})
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Posting Health Tab ───────────────────────────────────────────────────────

function PostingHealthTab({ draft }: { draft: MovementDraft | null }) {
  type HealthRow = { warehouse: string; ipg: string | null; ppg: string | null; movement_count: number; total_value: number; is_covered: boolean; gaps: string[] }
  type HealthSummary = { total_combos: number; covered: number; missing_setup: number; health_pct: number }
  type HealthResponse = { data: HealthRow[]; summary: HealthSummary }

  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    inventoryApi.postingHealth().then(res => {
      if (!cancelled) setData(res)
    }).catch(() => {
      if (!cancelled) setData(null)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const filledLines = draft?.lines.filter(l => l.item_code != null) ?? []

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-slate-300" />
        </div>
      ) : data ? (
        <>
          {/* Summary card */}
          <div className={`rounded-xl p-3 text-xs space-y-1 ${
            data.summary.health_pct >= 100 ? 'bg-green-50' : data.summary.health_pct >= 80 ? 'bg-amber-50' : 'bg-red-50'
          }`}>
            <div className="flex justify-between">
              <span className="text-slate-500">نسبة التغطية</span>
              <span className={`font-bold text-sm ${
                data.summary.health_pct >= 100 ? 'text-green-700' : data.summary.health_pct >= 80 ? 'text-amber-700' : 'text-red-700'
              }`}>{data.summary.health_pct.toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">مجموعات ناقصة</span>
              <span className="font-semibold text-slate-700">{data.summary.missing_setup}</span>
            </div>
          </div>

          {/* Draft-relevant gaps */}
          {filledLines.length > 0 && (
            <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider px-1">
              تنبيهات الأصناف في المسودة
            </div>
          )}

          {/* All gap rows */}
          {(data.data as HealthRow[])
            .filter(r => !r.is_covered)
            .slice(0, 10)
            .map((r, i) => (
              <div key={i} className="border border-red-200 rounded-xl p-3 text-xs bg-red-50">
                <div className="flex justify-between mb-1">
                  <span className="font-semibold text-red-700">{r.warehouse}</span>
                  <span className="text-slate-400">PPG: {r.ppg ?? '—'} / IPG: {r.ipg ?? '—'}</span>
                </div>
                {r.gaps.map((g, j) => (
                  <div key={j} className="text-red-500 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-red-400 shrink-0" />
                    {g}
                  </div>
                ))}
              </div>
            ))}

          {(data.data as HealthRow[]).filter(r => !r.is_covered).length === 0 && (
            <div className="flex items-center gap-2 text-sm text-green-600 font-semibold p-3 bg-green-50 rounded-xl">
              <CheckCircle size={14} />
              جميع مجموعات الترحيل مغطاة
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-slate-400 text-center py-8">تعذّر تحميل بيانات الصحة</div>
      )}
    </div>
  )
}

// ─── Validation Tab ───────────────────────────────────────────────────────────

function ValidationTab({ draft }: { draft: MovementDraft | null }) {
  if (!draft) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
        <ClipboardCheck size={32} className="text-slate-200 mb-3" />
        <p className="text-sm text-slate-400">لا توجد مسودة نشطة</p>
      </div>
    )
  }

  const result = validateDraftForSubmission(draft)
  const readinessPct = result.errors.length === 0
    ? 100
    : Math.max(0, Math.round(100 - (result.errors.length / (result.errors.length + result.warnings.length + 1)) * 100))

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Readiness badge */}
      <div className={`rounded-xl p-3 text-center ${result.valid ? 'bg-green-50' : 'bg-red-50'}`}>
        <div className={`text-3xl font-black mb-1 ${result.valid ? 'text-green-600' : 'text-red-500'}`}>
          {readinessPct}%
        </div>
        <div className={`text-xs font-semibold ${result.valid ? 'text-green-600' : 'text-red-500'}`}>
          {result.valid ? 'جاهز للترحيل' : `${result.errors.length} خطأ يجب معالجته`}
        </div>
      </div>

      {/* Errors */}
      {result.errors.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-red-600 uppercase tracking-wider px-1">أخطاء ({result.errors.length})</div>
          {result.errors.map((e, i) => (
            <div key={i} className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={11} className="shrink-0 mt-0.5 text-red-500" />
              <span>{e.line_index != null ? `سطر ${e.line_index + 1}: ` : ''}{e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-amber-600 uppercase tracking-wider px-1">تحذيرات ({result.warnings.length})</div>
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={11} className="shrink-0 mt-0.5 text-amber-500" />
              <span>{w.line_index != null ? `سطر ${w.line_index + 1}: ` : ''}{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {result.valid && result.warnings.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-green-600 font-semibold p-3 bg-green-50 rounded-xl">
          <CheckCircle size={14} />
          لا توجد أخطاء أو تحذيرات
        </div>
      )}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface WorkspaceSidePanelProps {
  draft?: MovementDraft | null
}

export default function WorkspaceSidePanel({ draft = null }: WorkspaceSidePanelProps) {
  const open = useWorkspacePanelStore(s => s.open)
  const tab = useWorkspacePanelStore(s => s.activeTab)
  const width = useWorkspacePanelStore(s => s.width)
  const setOpen = useWorkspacePanelStore(s => s.setOpen)
  const setActiveTab = useWorkspacePanelStore(s => s.setActiveTab)

  if (!open) return null

  return (
    <div
      className="bg-white border-l border-slate-200 flex flex-col shrink-0 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.08)] z-10 h-full transition-all"
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
        <h3 className="text-[13px] font-bold text-slate-700">لوحة التفاصيل</h3>
        <button
          onClick={() => setOpen(false)}
          className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 bg-white shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold transition-colors relative ${
              tab === t.key
                ? 'text-[#0F2D5C]'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.icon}
            <span className="hidden lg:inline">{t.label}</span>
            {tab === t.key && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#0F2D5C] rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
        {tab === 'gl'         && <GlPreviewTab       draft={draft} />}
        {tab === 'stock'      && <StockBalanceTab     draft={draft} />}
        {tab === 'health'     && <PostingHealthTab    draft={draft} />}
        {tab === 'validation' && <ValidationTab       draft={draft} />}
      </div>
    </div>
  )
}
