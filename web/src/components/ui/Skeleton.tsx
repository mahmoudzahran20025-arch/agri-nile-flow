// ─── Primitive ────────────────────────────────────────────────
function Bone({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-slate-200 rounded-lg ${className}`} />
  )
}

// ─── KPI Card Skeleton ────────────────────────────────────────
export function KPICardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-${count} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5">
          <Bone className="h-3 w-24 mb-3" />
          <Bone className="h-7 w-32 mb-2" />
          <Bone className="h-2 w-16" />
        </div>
      ))}
    </div>
  )
}

// ─── Table Skeleton ───────────────────────────────────────────
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      {/* fake header */}
      <div className="bg-slate-50 px-5 py-3 flex gap-4 border-b border-slate-100">
        {Array.from({ length: cols }).map((_, i) => (
          <Bone key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* fake rows */}
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, ri) => (
          <div key={ri} className="px-5 py-3.5 flex gap-4 items-center">
            {Array.from({ length: cols }).map((_, ci) => (
              <Bone key={ci} className={`h-3 flex-1 ${ci === 0 ? 'max-w-[120px]' : ''}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Form Skeleton ────────────────────────────────────────────
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4 p-5">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i}>
          <Bone className="h-3 w-24 mb-1.5" />
          <Bone className="h-9 w-full" />
        </div>
      ))}
      <div className="flex gap-3 pt-2">
        <Bone className="h-9 flex-1" />
        <Bone className="h-9 flex-1" />
      </div>
    </div>
  )
}

// ─── Page Header Skeleton ─────────────────────────────────────
export function PageHeaderSkeleton() {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/60 bg-white shrink-0">
      <div>
        <Bone className="h-6 w-48 mb-2" />
        <Bone className="h-3 w-24" />
      </div>
      <Bone className="h-9 w-28" />
    </div>
  )
}

// ─── Full Page Skeleton (header + kpis + table) ───────────────
export function PageSkeleton({ kpis = 4, rows = 8 }: { kpis?: number; rows?: number }) {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <KPICardSkeleton count={kpis} />
      <TableSkeleton rows={rows} />
    </div>
  )
}
