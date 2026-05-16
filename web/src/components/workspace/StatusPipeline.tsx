import type { DraftStatus } from './types'

const STEPS: { key: DraftStatus; label: string }[] = [
  { key: 'draft',      label: 'مسودة'    },
  { key: 'posting',    label: 'جاري الاعتماد' },
  { key: 'posted',     label: 'معتمد'   },
]

const STATUS_ORDER: Record<DraftStatus, number> = {
  draft:      0,
  dirty:      0,
  saving:     0,
  saved:      0,
  recovery:   0,
  conflict:   0,
  failed:     0,
  posting:    1,
  posted:     2,
}

interface Props {
  status: DraftStatus
}

export default function StatusPipeline({ status }: Props) {
  const currentIdx = STATUS_ORDER[status]
  const isError    = status === 'failed' || status === 'conflict'

  return (
    <div className="flex items-center gap-1" role="status" aria-label="حالة المسودة">
      {STEPS.map((step, idx) => {
        const reached  = currentIdx >= idx
        const isCurrent = currentIdx === idx
        const spinning = isCurrent && status === 'posting'

        return (
          <div key={step.key} className="flex items-center gap-1">
            {idx > 0 && (
              <div
                className={`w-4 h-[2px] rounded-full transition-colors ${
                  reached ? 'bg-emerald-400' : 'bg-slate-200'
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                isError && idx === 0
                  ? 'bg-red-100 text-red-700 border border-red-200'
                  : isCurrent
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : reached
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-slate-50 text-slate-400'
              }`}
            >
              {spinning && (
                <span className="inline-block w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              )}
              {isError && idx === 0 ? 'خطأ' : step.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}
