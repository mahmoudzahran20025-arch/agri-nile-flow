/**
 * BatchPostingCenterPage — FIN-EPIC-09
 * Enqueue, monitor, process, cancel, and retry GL batch posting jobs.
 * P0 sprint 3 delivery.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Play, StopCircle, RefreshCw, Plus, Loader2, CheckCircle2, XCircle,
  Clock, ChevronRight, X, RotateCcw, Layers, Info,
} from 'lucide-react'
import { glApi } from '../../api/client'
import type { BatchPostJobRow } from '../../api/gl'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import StatusBadge from '../../components/ui/StatusBadge'
import Modal from '../../components/ui/Modal'

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BatchPostJobRow['status'], {
  label: string; variant: Parameters<typeof StatusBadge>[0]['variant']; icon: React.ReactNode
}> = {
  pending:    { label: 'Pending',    variant: 'draft',    icon: <Clock       size={11} /> },
  processing: { label: 'Processing', variant: 'active',   icon: <Loader2     size={11} className="animate-spin" /> },
  completed:  { label: 'Completed',  variant: 'active',   icon: <CheckCircle2 size={11} /> },
  failed:     { label: 'Failed',     variant: 'voided',   icon: <XCircle     size={11} /> },
  cancelled:  { label: 'Cancelled',  variant: 'reversed', icon: <StopCircle  size={11} /> },
}

const EVENT_TYPES = [
  'inventory_in', 'inventory_out', 'supplier_invoice', 'supplier_payment',
  'payroll', 'depreciation', 'harvest', 'manual',
]

const SOURCE_MODULES = [
  'inventory', 'suppliers', 'treasury', 'hr', 'fields', 'assets', 'manual',
]

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ job }: { job: BatchPostJobRow }) {
  const total = job.total_items || 1
  const done  = job.processed_items
  const fail  = job.failed_items
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full flex">
          <div className="bg-[#1D9E75] rounded-full transition-all" style={{ width: `${Math.round(((done - fail) / total) * 100)}%` }} />
          {fail > 0 && <div className="bg-red-400 transition-all" style={{ width: `${Math.round((fail / total) * 100)}%` }} />}
        </div>
      </div>
      <span className="text-[10px] text-slate-400 shrink-0">{done}/{total}</span>
      {fail > 0 && <span className="text-[10px] text-red-500 shrink-0">{fail} err</span>}
    </div>
  )
}

// ── Job Detail Drawer ─────────────────────────────────────────────────────────

function JobDetailDrawer({
  jobId, onClose, onProcess, onCancel, onRetry, processing, cancelling,
}: {
  jobId: number; onClose: () => void
  onProcess: (id: number) => void; onCancel: (id: number) => void; onRetry: (id: number) => void
  processing: boolean; cancelling: boolean
}) {
  const { data } = useQuery({
    queryKey: ['gl-batch-job', jobId],
    queryFn:  () => glApi.getBatchPostJob(jobId),
    refetchInterval: 3000,
  })

  const job   = data?.data
  const items = (job?.items ?? []) as Array<Record<string, unknown>>

  if (!job) return (
    <div className="w-[380px] border-l border-slate-200 bg-white flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-slate-300" />
    </div>
  )

  const cfg = STATUS_CONFIG[job.status]

  return (
    <div className="w-[380px] shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between">
        <div>
          <p className="text-[13px] font-bold text-[#0F2D5C]">Job #{job.id}</p>
          <p className="text-[11px] text-slate-500 font-mono">{job.event_type} · {job.source_module}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge variant={cfg.variant} label={cfg.label} />
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose}><X size={15} /></button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-slate-100">
        {[
          { label: 'Total',   value: job.total_items,     color: 'text-slate-700' },
          { label: 'Done',    value: job.processed_items, color: 'text-[#1D9E75]' },
          { label: 'Failed',  value: job.failed_items,    color: job.failed_items > 0 ? 'text-red-600' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="text-center">
            <p className={`text-[18px] font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="px-4 py-2 border-b border-slate-100">
        <ProgressBar job={job} />
        {job.last_error && (
          <p className="mt-1.5 text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">
            <span className="font-semibold">Last error:</span> {job.last_error}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        {(job.status === 'pending' || job.status === 'failed') && (
          <button
            className="btn-primary text-[11px] py-1.5 px-3 flex items-center gap-1.5"
            onClick={() => onProcess(job.id)} disabled={processing}
          >
            {processing ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Process
          </button>
        )}
        {job.status === 'failed' && (
          <button
            className="btn-secondary text-[11px] py-1.5 px-3 flex items-center gap-1.5"
            onClick={() => onRetry(job.id)}
          >
            <RotateCcw size={11} /> Retry
          </button>
        )}
        {(job.status === 'pending' || job.status === 'processing') && (
          <button
            className="btn-secondary text-[11px] py-1.5 px-3 flex items-center gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => onCancel(job.id)} disabled={cancelling}
          >
            {cancelling ? <Loader2 size={11} className="animate-spin" /> : <StopCircle size={11} />}
            Cancel
          </button>
        )}
      </div>

      {/* Timeline */}
      <div className="px-4 py-3 border-b border-slate-100 space-y-1 text-[11px]">
        {[
          { label: 'Created',   value: job.created_at },
          { label: 'Started',   value: job.started_at },
          { label: 'Completed', value: job.completed_at },
        ].filter(t => t.value).map(t => (
          <div key={t.label} className="flex justify-between text-slate-500">
            <span>{t.label}</span>
            <span className="font-mono">{t.value?.slice(0, 19).replace('T', ' ')}</span>
          </div>
        ))}
        <div className="flex justify-between text-slate-500">
          <span>Priority</span>
          <span className="font-mono">{job.priority}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>Retries</span>
          <span className="font-mono">{job.retry_count}</span>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Items ({items.length})</p>
        {items.length === 0
          ? <p className="text-[12px] text-slate-400">No item detail available</p>
          : (
            <div className="space-y-1.5">
              {items.slice(0, 100).map((item, i) => {
                const itemStatus = String(item.status ?? '—')
                const isOk = itemStatus === 'completed'
                const isFail = itemStatus === 'failed'
                return (
                  <div key={i} className={`rounded px-2 py-1.5 flex items-center gap-2 text-[11px] ${isFail ? 'bg-red-50' : isOk ? 'bg-emerald-50/50' : 'bg-slate-50'}`}>
                    {isFail  ? <XCircle size={11} className="text-red-400 shrink-0" />
                     : isOk  ? <CheckCircle2 size={11} className="text-[#1D9E75] shrink-0" />
                     :         <Clock size={11} className="text-slate-400 shrink-0" />
                    }
                    <span className="font-mono text-slate-500">#{String(item.source_id ?? i)}</span>
                    <span className={`ml-auto ${isFail ? 'text-red-600' : isOk ? 'text-[#1D9E75]' : 'text-slate-400'}`}>{itemStatus}</span>
                  </div>
                )
              })}
              {items.length > 100 && <p className="text-[11px] text-slate-400 text-center">+ {items.length - 100} more</p>}
            </div>
          )
        }
      </div>
    </div>
  )
}

// ── Enqueue Modal ──────────────────────────────────────────────────────────────

function EnqueueModal({ open, onClose, onCreate }: {
  open: boolean; onClose: () => void; onCreate: (body: Parameters<typeof glApi.createBatchPostJob>[0]) => void
}) {
  const [eventType, setEventType]     = useState('inventory_in')
  const [sourceModule, setSourceModule] = useState('inventory')
  const [priority, setPriority]       = useState(5)
  const [itemsRaw, setItemsRaw]       = useState('[]')
  const [parseError, setParseError]   = useState('')

  function submit() {
    try {
      const items = JSON.parse(itemsRaw)
      if (!Array.isArray(items)) throw new Error('items must be an array')
      setParseError('')
      onCreate({ event_type: eventType, source_module: sourceModule, priority, items })
    } catch (e) {
      setParseError((e as Error).message)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Batch Posting Job" size="md">
      <div className="space-y-4 text-[13px]">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Event Type *</label>
            <select className="input" value={eventType} onChange={e => setEventType(e.target.value)}>
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Source Module *</label>
            <select className="input" value={sourceModule} onChange={e => setSourceModule(e.target.value)}>
              {SOURCE_MODULES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-slate-600 font-semibold mb-1">Priority (1=high, 10=low)</label>
          <input type="number" min={1} max={10} className="input w-24" value={priority} onChange={e => setPriority(Number(e.target.value))} />
        </div>
        <div>
          <label className="block text-slate-600 font-semibold mb-1">
            Items <span className="text-slate-400 font-normal">(JSON array of {'{ source_id, payload? }'})</span>
          </label>
          <textarea
            className={`input font-mono text-[11px] h-28 resize-none ${parseError ? 'border-red-400' : ''}`}
            value={itemsRaw}
            onChange={e => { setItemsRaw(e.target.value); setParseError('') }}
            placeholder='[{"source_id": 1}, {"source_id": 2}]'
          />
          {parseError && <p className="text-[11px] text-red-600 mt-1">{parseError}</p>}
        </div>
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded p-3">
          <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-blue-700">
            The job will be created in <strong>pending</strong> state. Use the <strong>Process</strong> button on the job row to begin execution.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex items-center gap-2" onClick={submit}>
          <Layers size={13} /> Create Job
        </button>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BatchPostingCenterPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<BatchPostJobRow['status'] | ''>('')
  const [page, setPage]                 = useState(1)
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [showEnqueue, setShowEnqueue]   = useState(false)

  const params = {
    page,
    size: 25,
    status: statusFilter || undefined,
  }

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['gl-batch-jobs', params],
    queryFn:  () => glApi.batchPostJobs(params),
    refetchInterval: 5000, // auto-refresh every 5s
    placeholderData: prev => prev,
  })

  const jobs  = data?.data  ?? []
  const total = data?.total ?? 0

  const processMut = useMutation({
    mutationFn: (id: number) => glApi.processBatchPostJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gl-batch-jobs'] }); qc.invalidateQueries({ queryKey: ['gl-batch-job'] }) },
  })

  const cancelMut = useMutation({
    mutationFn: (id: number) => glApi.updateBatchPostJobStatus(id, { status: 'cancelled' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gl-batch-jobs'] }); qc.invalidateQueries({ queryKey: ['gl-batch-job'] }) },
  })

  const retryMut = useMutation({
    mutationFn: (id: number) => glApi.updateBatchPostJobStatus(id, { status: 'pending' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gl-batch-jobs'] }); qc.invalidateQueries({ queryKey: ['gl-batch-job'] }) },
  })

  const createMut = useMutation({
    mutationFn: (body: Parameters<typeof glApi.createBatchPostJob>[0]) => glApi.createBatchPostJob(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gl-batch-jobs'] }); setShowEnqueue(false) },
  })

  const claimMut = useMutation({
    mutationFn: () => glApi.claimNextBatchPostJob(),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['gl-batch-jobs'] })
      if (res?.data?.id) setSelectedJobId(res.data.id)
    },
  })

  // KPIs derived from current page — for global counts refetch all statuses would be needed
  const pending    = jobs.filter(j => j.status === 'pending').length
  const processing = jobs.filter(j => j.status === 'processing').length
  const failed     = jobs.filter(j => j.status === 'failed').length
  const completed  = jobs.filter(j => j.status === 'completed').length

  const kpis: KpiItem[] = [
    { id: 'total',   label: 'JOBS (PAGE)',  value: total },
    { id: 'pending', label: 'PENDING',      value: pending,    variant: pending > 0 ? 'warning' : 'success' },
    { id: 'running', label: 'PROCESSING',   value: processing, variant: processing > 0 ? 'warning' : 'success' },
    { id: 'failed',  label: 'FAILED',       value: failed,     variant: failed > 0 ? 'warning' : 'success' },
    { id: 'done',    label: 'COMPLETED',    value: completed,  variant: 'success' },
  ]

  const actions: CommandAction[] = [
    {
      id: 'refresh',
      label: isFetching ? 'Loading…' : 'Refresh',
      icon: <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />,
      onClick: () => refetch(), variant: 'secondary',
    },
    {
      id: 'claim',
      label: 'Claim Next',
      icon: claimMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />,
      onClick: () => claimMut.mutate(),
      variant: 'secondary',
    },
    {
      id: 'new',
      label: 'New Job',
      icon: <Plus size={14} />,
      onClick: () => setShowEnqueue(true),
      variant: 'primary',
    },
  ]

  const rightSlot = (
    <div className="flex items-center gap-2">
      {(['', 'pending', 'processing', 'completed', 'failed', 'cancelled'] as const).map(s => (
        <button
          key={s}
          onClick={() => { setStatusFilter(s); setPage(1) }}
          className={`text-[11px] px-2.5 py-1 rounded ${
            statusFilter === s
              ? 'bg-[#0F2D5C] text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">Batch Posting Center</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          Enqueue, monitor, and control GL batch posting jobs. Auto-refreshes every 5 seconds.
        </p>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpis} />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Job list ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6">
          <SectionCard
            title="Posting Jobs"
            subtitle={`${total.toLocaleString()} total · Page ${page}`}
            icon={<Layers size={14} />}
          >
            {isLoading ? (
              <div className="space-y-2">
                {[1,2,3,4].map(i => <div key={i} className="h-14 bg-slate-100 rounded animate-pulse" />)}
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <Layers size={36} className="mb-3 opacity-30" />
                <p className="text-[13px]">No jobs found</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {jobs.map(job => {
                  const cfg = STATUS_CONFIG[job.status]
                  const isActive = selectedJobId === job.id
                  return (
                    <div
                      key={job.id}
                      className={`py-3 px-2 flex items-center gap-3 cursor-pointer transition-colors group rounded ${
                        isActive ? 'bg-blue-50/50 border border-blue-200' : 'hover:bg-slate-50'
                      }`}
                      onClick={() => setSelectedJobId(isActive ? null : job.id)}
                    >
                      <div className="flex items-center gap-1.5 shrink-0">
                        {cfg.icon}
                        <StatusBadge variant={cfg.variant} label={cfg.label} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-[#0F2D5C]">
                            #{job.id} — {job.event_type}
                          </span>
                          <span className="text-[11px] text-slate-400">{job.source_module}</span>
                          <span className="text-[10px] text-slate-300">P{job.priority}</span>
                        </div>
                        <div className="mt-1.5">
                          <ProgressBar job={job} />
                        </div>
                        {job.last_error && (
                          <p className="text-[10px] text-red-500 mt-0.5 truncate">{job.last_error}</p>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {(job.status === 'pending' || job.status === 'failed') && (
                          <button
                            className="text-[11px] bg-[#0F2D5C] text-white rounded px-2 py-0.5 hover:bg-[#0d2650] flex items-center gap-1"
                            onClick={e => { e.stopPropagation(); processMut.mutate(job.id) }}
                            disabled={processMut.isPending}
                          >
                            {processMut.isPending && processMut.variables === job.id
                              ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                            Process
                          </button>
                        )}
                        {(job.status === 'pending' || job.status === 'processing') && (
                          <button
                            className="text-[11px] text-slate-400 hover:text-red-600 p-1 rounded"
                            onClick={e => { e.stopPropagation(); cancelMut.mutate(job.id) }}
                            title="Cancel"
                          >
                            <StopCircle size={13} />
                          </button>
                        )}
                        {job.status === 'failed' && job.retry_count < 3 && (
                          <button
                            className="text-[11px] text-slate-400 hover:text-[#0F2D5C] p-1 rounded"
                            onClick={e => { e.stopPropagation(); retryMut.mutate(job.id) }}
                            title="Retry"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )}
                        <span className="text-[10px] font-mono text-slate-400">
                          {job.created_at.slice(0, 10)}
                        </span>
                        <ChevronRight size={13} className={`text-slate-300 transition-transform ${isActive ? 'rotate-90 text-[#0F2D5C]' : ''}`} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Pagination */}
            {total > 25 && (
              <div className="flex items-center justify-between mt-4 text-[12px] text-slate-500">
                <span>Showing {Math.min((page-1)*25+1, total)}–{Math.min(page*25, total)} of {total.toLocaleString()}</span>
                <div className="flex gap-2">
                  <button className="btn-secondary py-1 px-3 text-[12px]" disabled={page===1} onClick={() => setPage(p => p-1)}>← Prev</button>
                  <button className="btn-secondary py-1 px-3 text-[12px]" disabled={page*25>=total} onClick={() => setPage(p => p+1)}>Next →</button>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Detail drawer ─────────────────────────────────────────── */}
        {selectedJobId && (
          <JobDetailDrawer
            jobId={selectedJobId}
            onClose={() => setSelectedJobId(null)}
            onProcess={id => processMut.mutate(id)}
            onCancel={id => cancelMut.mutate(id)}
            onRetry={id => retryMut.mutate(id)}
            processing={processMut.isPending}
            cancelling={cancelMut.isPending}
          />
        )}
      </div>

      {/* Enqueue modal */}
      <EnqueueModal
        open={showEnqueue}
        onClose={() => setShowEnqueue(false)}
        onCreate={body => createMut.mutate(body)}
      />
    </div>
  )
}
