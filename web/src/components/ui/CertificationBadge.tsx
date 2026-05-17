import { ShieldCheck, ShieldAlert, ShieldX, AlertCircle } from 'lucide-react'
import type { PostingMeta } from '../../api/gl'

interface Props {
  meta: PostingMeta | null | undefined
  /** Show the full degraded-reason string, default false */
  showReason?: boolean
  className?: string
}

/**
 * Displays the GL certification status from a PostingMeta envelope.
 * Rendered on any financial report page that returns a `meta` field.
 */
export default function CertificationBadge({ meta, showReason = false, className = '' }: Props) {
  if (!meta) return null

  const { certification_status, degraded_reason, data_source, strict_posting_active } = meta

  if (certification_status === 'certified') {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
          <ShieldCheck size={12} />
          معتمد من دفتر الأستاذ
        </span>
        {strict_posting_active && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border bg-blue-50 text-blue-700 border-blue-200">
            وضع صارم
          </span>
        )}
      </div>
    )
  }

  if (certification_status === 'degraded') {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-amber-50 text-amber-700 border-amber-200 w-fit">
          <ShieldAlert size={12} />
          وضع مخفّض — بيانات جزئية
        </div>
        {showReason && degraded_reason && (
          <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800" dir="rtl">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-600" />
            <span>{degraded_reason}</span>
          </div>
        )}
        {data_source === 'source_table_fallback' && (
          <span className="text-[10px] text-slate-400">المصدر: جداول المعاملات (لا دفتر الأستاذ)</span>
        )}
      </div>
    )
  }

  // blocked
  return (
    <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-red-50 text-red-700 border-red-200 ${className}`}>
      <ShieldX size={12} />
      محظور — النظام معطّل
    </div>
  )
}
