import type { LineItem } from './types'
import { isInboundType, type MovementType } from './types'

interface Props {
  lines:        LineItem[]
  movementType: MovementType
  dirty:        boolean
}

export default function SummaryFooter({ lines, movementType, dirty }: Props) {
  const filled   = lines.filter(l => l.item_code !== null)
  const totalQty = filled.reduce((s, l) => s + (l.quantity ?? 0), 0)
  // Prefer total_value if set directly; fall back to qty × unit_price
  const totalVal = filled.reduce((s, l) => {
    if (l.total_value != null) return s + l.total_value
    return s + (l.quantity ?? 0) * (l.unit_price ?? 0)
  }, 0)
  const errors   = lines.filter(l => l._error).length
  const warnings = lines.filter(l => l._warning).length
  const isIn     = isInboundType(movementType)

  const fmtNum = (n: number) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)
  const fmtEgp = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

  return (
    <div className="h-12 bg-white border-t border-slate-200 px-6 flex items-center justify-between text-[12px] shrink-0">
      {/* Left: counts */}
      <div className="flex items-center gap-4">
        <span className="text-slate-500">
          الأصناف: <span className="font-bold text-slate-800">{filled.length}</span>
          <span className="text-slate-300"> / {lines.length}</span>
        </span>
        <span className="text-slate-500">
          الكمية: <span className="font-bold text-slate-800">{fmtNum(totalQty)}</span>
        </span>
        {totalVal > 0 && (
          <span className="text-slate-500">
            القيمة: <span className={`font-bold ${isIn ? 'text-emerald-700' : 'text-red-600'}`}>
              {fmtEgp(totalVal)}
            </span>
          </span>
        )}
      </div>

      {/* Right: status indicators */}
      <div className="flex items-center gap-3">
        {errors > 0 && (
          <span className="flex items-center gap-1 text-red-600 font-semibold">
            ✗ {errors} خطأ
          </span>
        )}
        {warnings > 0 && (
          <span className="flex items-center gap-1 text-amber-600 font-semibold">
            ⚠ {warnings} تحذير
          </span>
        )}
        {errors === 0 && warnings === 0 && filled.length > 0 && (
          <span className="flex items-center gap-1 text-emerald-600 font-semibold">
            ✓ جاهز
          </span>
        )}
        {dirty && (
          <span className="text-amber-500 text-[10px] font-medium">
            تغييرات غير محفوظة
          </span>
        )}
      </div>
    </div>
  )
}
