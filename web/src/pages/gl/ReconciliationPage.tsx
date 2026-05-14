/**
 * ReconciliationPage — FIN-EPIC-05
 * Source-document ↔ GL journal-entry reconciliation workbench.
 * Shows mismatches between operational events and posted GL entries.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, FileSearch, ExternalLink, Filter, GitBranch, ShieldCheck, ShieldAlert } from 'lucide-react'
import { glApi, type SourceDocRow, type ReconciliationResult } from '../../api/client'
import { reportsApi } from '../../api/reports'
import GlEntryTraceDrawer from '../../components/gl/GlEntryTraceDrawer'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import StatusBadge from '../../components/ui/StatusBadge'
import DataTable, { type Column } from '../../components/ui/DataTable'

// ── Control Account Health Panel ─────────────────────────────────────────────

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)

type Severity = 'ok' | 'warning' | 'critical'

function SeverityChip({ severity }: { severity: Severity }) {
  const cfg = {
    ok:       'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning:  'bg-amber-50   text-amber-700   border-amber-200',
    critical: 'bg-red-50     text-red-700     border-red-200',
  }[severity]
  const label = { ok: 'OK', warning: 'تحقق', critical: 'حرج' }[severity]
  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg}`}>{label}</span>
  )
}

function BoundaryCard({ label, sub_account, subledger_total, gl_balance, gap, severity }: {
  label: string; sub_account: string; subledger_total: number; gl_balance: number; gap: number; severity: Severity
}) {
  const borderCls = severity === 'critical' ? 'border-red-300' : severity === 'warning' ? 'border-amber-200' : 'border-slate-200'
  return (
    <div className={`rounded-xl border ${borderCls} bg-white p-4 space-y-3`} dir="rtl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">{label}</p>
          <p className="text-xs text-slate-400 font-mono mt-0.5">{sub_account}</p>
        </div>
        <SeverityChip severity={severity} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-400">الدفتر المساعد</p>
          <p className="font-mono font-semibold text-slate-700 mt-0.5">{EGP(subledger_total)}</p>
        </div>
        <div>
          <p className="text-slate-400">رصيد الأستاذ</p>
          <p className="font-mono font-semibold text-slate-700 mt-0.5">{EGP(gl_balance)}</p>
        </div>
      </div>
      {Math.abs(gap) > 0.01 ? (
        <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg ${severity === 'critical' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
          <AlertTriangle size={11} />
          فجوة {EGP(Math.abs(gap))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 px-2.5 py-1.5 rounded-lg bg-emerald-50">
          <CheckCircle2 size={11} />
          متطابق تماماً
        </div>
      )}
    </div>
  )
}

function ControlAccountHealthPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['reconciliation-status'],
    queryFn:  reportsApi.reconciliationStatus,
    refetchInterval: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[1, 2, 3].map(i => <div key={i} className="h-36 bg-slate-100 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
        <AlertTriangle size={15} />
        تعذّر تحميل بيانات فحص الحسابات — تحقق من الاتصال
      </div>
    )
  }

  const { boundaries, integrity, overall_ok, checked_at } = data
  const checkedTime = new Date(checked_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {overall_ok
            ? <ShieldCheck size={16} className="text-emerald-600" />
            : <ShieldAlert  size={16} className="text-red-500" />
          }
          <span className="text-sm font-semibold text-slate-700">
            {overall_ok ? 'جميع حسابات الضبط سليمة' : 'يوجد فجوات تحتاج مراجعة'}
          </span>
          <span className="text-xs text-slate-400">آخر فحص {checkedTime}</span>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
          title="تحديث"
        >
          <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <BoundaryCard {...boundaries.ap}             />
        <BoundaryCard {...boundaries.inventory}      />
        <BoundaryCard {...boundaries.payroll_payable} />
      </div>

      {!integrity.all_clean && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <XCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-red-800">مشاكل في سلامة البيانات</p>
            <ul className="text-xs text-red-700 mt-1 space-y-0.5 list-disc list-inside">
              {integrity.ghost_entries > 0 && (
                <li>قيود GL بلا أحداث أعمال مرتبطة: <strong>{integrity.ghost_entries}</strong></li>
              )}
              {integrity.orphan_events > 0 && (
                <li>أحداث أعمال بلا قيد محاسبي: <strong>{integrity.orphan_events}</strong></li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Config ────────────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  inventory:   'Inventory',
  suppliers:   'Suppliers',
  treasury:    'Treasury',
  hr:          'Payroll / HR',
  fields:      'Field / Harvest',
  contracts:   'Contracts',
  assets:      'Fixed Assets',
}

const STATUS_MAP: Record<SourceDocRow['reconciliation_status'], { label: string; variant: Parameters<typeof StatusBadge>[0]['variant']; icon: React.ReactNode }> = {
  ok:                    { label: 'Linked OK',            variant: 'active',   icon: <CheckCircle2 size={12} /> },
  missing_business_event:{ label: 'Missing Event',        variant: 'voided',   icon: <XCircle size={12} /> },
  missing_journal_link:  { label: 'No Journal Link',      variant: 'draft',    icon: <AlertTriangle size={12} /> },
  event_link_mismatch:   { label: 'Entry Mismatch',       variant: 'reversed', icon: <AlertTriangle size={12} /> },
  posted_without_journal:{ label: 'Posted, No Entry',     variant: 'voided',   icon: <XCircle size={12} /> },
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const [page, setPage]               = useState(1)
  const [mismatchOnly, setMismatchOnly] = useState(false)
  const [sourceModule, setSourceModule] = useState('')
  const [status, setStatus]           = useState('')
  const [from, setFrom]               = useState('')
  const [to, setTo]                   = useState('')

  const [traceOpen, setTraceOpen]       = useState(false)
  const [traceEntryId, setTraceEntryId] = useState<number | null>(null)
  const [traceTab, setTraceTab]         = useState<'source' | 'lines' | 'trace'>('source')

  const params = {
    page,
    size: 50,
    mismatch_only: mismatchOnly ? '1' as const : undefined,
    source_module: sourceModule || undefined,
    status:        status       || undefined,
    from:          from         || undefined,
    to:            to           || undefined,
  }

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['recon-source-docs', params],
    queryFn: () => glApi.reconciliationSourceDocs(params) as Promise<ReconciliationResult>,
    placeholderData: (prev) => prev,
  })

  const { data: traceData, isFetching: traceLoading, isError: traceIsError, error: traceError } = useQuery({
    queryKey: ['gl-entry-trace', traceEntryId],
    queryFn:  () => glApi.entryTrace(traceEntryId!),
    enabled:  !!traceEntryId && traceOpen,
  })

  const rows    = data?.data    ?? []
  const total   = data?.total   ?? 0
  const summary = data?.summary ?? { total: 0, missing_business_event: 0, missing_journal_link: 0, event_link_mismatch: 0, posted_without_journal: 0, fully_linked: 0 }

  const mismatches = (summary.missing_business_event ?? 0) + (summary.missing_journal_link ?? 0) + (summary.event_link_mismatch ?? 0) + (summary.posted_without_journal ?? 0)

  const kpis: KpiItem[] = [
    { id: 'total',    label: 'TOTAL DOCUMENTS',  value: summary.total.toLocaleString() },
    { id: 'linked',   label: 'FULLY LINKED',     value: summary.fully_linked?.toLocaleString() ?? '0', variant: 'success' },
    { id: 'mismatch', label: 'MISMATCHES',        value: mismatches.toLocaleString(), variant: mismatches > 0 ? 'warning' : 'success' },
    { id: 'rate',     label: 'LINK RATE',
      value: summary.total > 0 ? `${Math.round(((summary.fully_linked ?? 0) / summary.total) * 100)}%` : '—',
      variant: summary.total > 0 && (summary.fully_linked ?? 0) / summary.total >= 0.95 ? 'success' : 'warning',
    },
  ]

  const actions: CommandAction[] = [
    {
      id: 'refresh', label: isFetching ? 'Loading…' : 'Refresh',
      icon: <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />,
      onClick: () => refetch(), variant: 'secondary',
    },
    {
      id: 'mismatch', label: mismatchOnly ? 'Show All' : 'Mismatches Only',
      icon: <Filter size={14} />,
      onClick: () => { setMismatchOnly(v => !v); setPage(1) },
      variant: mismatchOnly ? 'primary' : 'secondary',
    },
  ]

  const columns: Column<SourceDocRow>[] = [
    {
      key: 'source_id',
      header: 'Document',
      render: r => (
        <div>
          <p className="font-mono text-[12px] font-semibold text-[#0F2D5C]">
            {MODULE_LABELS[r.source_module] ?? r.source_module} #{r.source_id}
          </p>
          <p className="text-[11px] text-slate-400 font-mono">{r.document_type}</p>
        </div>
      ),
    },
    {
      key: 'event_date',
      header: 'Event Date',
      render: r => <span className="text-[12px] font-mono text-slate-600">{r.event_date}</span>,
    },
    {
      key: 'reconciliation_status',
      header: 'Recon Status',
      render: r => {
        const cfg = STATUS_MAP[r.reconciliation_status] ?? { label: r.reconciliation_status, variant: 'default' as const, icon: null }
        return (
          <span className="flex items-center gap-1.5 text-[12px]">
            {cfg.icon}
            <StatusBadge variant={cfg.variant} label={cfg.label} />
          </span>
        )
      },
    },
    {
      key: 'linked_journal_entry_id',
      header: 'GL Entry',
      render: r => r.linked_journal_entry_id
        ? (
          <Link
            to={`/gl/entries?id=${r.linked_journal_entry_id}`}
            className="flex items-center gap-1 text-[12px] font-mono text-[#0F2D5C] hover:underline"
          >
            <ExternalLink size={11} />
            #{r.linked_journal_entry_id}
          </Link>
        )
        : <span className="text-[11px] text-slate-400">Not linked</span>,
    },
    {
      key: 'business_event_journal_entry_id',
      header: 'Event → Entry',
      render: r => r.business_event_journal_entry_id
        ? <span className="text-[11px] font-mono text-slate-500">#{r.business_event_journal_entry_id}</span>
        : <span className="text-[11px] text-slate-300">—</span>,
    },
    {
      key: 'linked_entry_description',
      header: 'Entry Description',
      render: r => r.linked_entry_description
        ? <span className="text-[12px] text-slate-600 truncate max-w-[200px] block" title={r.linked_entry_description}>{r.linked_entry_description}</span>
        : <span className="text-[11px] text-slate-300">—</span>,
    },
    {
      key: 'trace_action',
      header: '',
      render: r => r.linked_journal_entry_id ? (
        <button
          onClick={() => { setTraceEntryId(r.linked_journal_entry_id!); setTraceOpen(true); setTraceTab('source'); }}
          className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
          title="Open entry trace"
        >
          <GitBranch size={12} /> Trace
        </button>
      ) : null,
    },
  ]

  const rightSlot = (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        className="input h-8 text-[12px] py-1 w-36"
        value={sourceModule}
        onChange={e => { setSourceModule(e.target.value); setPage(1) }}
      >
        <option value="">All Modules</option>
        {Object.entries(MODULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select
        className="input h-8 text-[12px] py-1 w-32"
        value={status}
        onChange={e => { setStatus(e.target.value); setPage(1) }}
      >
        <option value="">All Status</option>
        <option value="pending">Pending</option>
        <option value="posted">Posted</option>
        <option value="error">Error</option>
      </select>
      <input type="date" className="input h-8 text-[12px] py-1 w-34" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} placeholder="From" />
      <input type="date" className="input h-8 text-[12px] py-1 w-34" value={to}   onChange={e => { setTo(e.target.value); setPage(1) }} placeholder="To" />
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] relative">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">Reconciliation Workbench</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          Verify that every operational event has a corresponding posted GL entry. Investigate and resolve mismatches.
        </p>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpis} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Control Account Health — sub-ledger vs GL boundaries */}
        <SectionCard
          title="فحص حسابات الضبط"
          subtitle="مقارنة أرصدة الدفاتر المساعدة مقابل حسابات الأستاذ العامة الضابطة"
          icon={<ShieldCheck size={14} className="text-slate-500" />}
        >
          <ControlAccountHealthPanel />
        </SectionCard>

        {/* Mismatch summary cards */}
        {mismatches > 0 && (
          <SectionCard
            title="Mismatch Breakdown"
            subtitle="Categories of documents that need attention"
            icon={<AlertTriangle size={14} className="text-amber-500" />}
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { key: 'missing_business_event', label: 'Missing Event',   color: 'red' },
                { key: 'missing_journal_link',   label: 'No Journal Link', color: 'amber' },
                { key: 'event_link_mismatch',    label: 'Entry Mismatch',  color: 'orange' },
                { key: 'posted_without_journal', label: 'Posted, No Entry',color: 'red' },
              ].map(({ key, label, color }) => {
                const count = (summary as any)[key] ?? 0
                const ring  = color === 'red' ? 'ring-red-200 bg-red-50 text-red-700' : color === 'orange' ? 'ring-orange-200 bg-orange-50 text-orange-700' : 'ring-amber-200 bg-amber-50 text-amber-700'
                return (
                  <div key={key} className={`rounded-lg ring-1 p-3 ${ring}`}>
                    <p className="text-[20px] font-bold">{count.toLocaleString()}</p>
                    <p className="text-[11px] font-medium mt-0.5 opacity-80">{label}</p>
                    {count > 0 && (
                      <button
                        className="mt-2 text-[10px] underline opacity-70 hover:opacity-100"
                        onClick={() => { setMismatchOnly(true); setPage(1) }}
                      >
                        Show mismatches
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {mismatches === 0 && !isLoading && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded p-4">
            <CheckCircle2 size={20} className="text-[#1D9E75] shrink-0" />
            <div>
              <p className="font-semibold text-[13px] text-emerald-800">All documents are fully reconciled</p>
              <p className="text-[12px] text-emerald-700">Every operational event has a linked GL journal entry.</p>
            </div>
          </div>
        )}

        {/* Grid */}
        <SectionCard
          title={`Source Documents ${mismatchOnly ? '(Mismatches Only)' : ''}`}
          subtitle={`${total.toLocaleString()} document(s) · Page ${page}`}
          icon={<FileSearch size={14} />}
        >
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : (
            <>
              <DataTable<SourceDocRow>
                data={rows}
                columns={columns}
                rowKey={r => r.id}
                emptyText="No documents found for these filters"
              />
              {/* Pagination */}
              {total > 50 && (
                <div className="flex items-center justify-between mt-4 text-[12px] text-slate-500">
                  <span>Showing {Math.min((page - 1) * 50 + 1, total)}–{Math.min(page * 50, total)} of {total.toLocaleString()}</span>
                  <div className="flex gap-2">
                    <button className="btn-secondary py-1 px-3 text-[12px]" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                      ← Prev
                    </button>
                    <button className="btn-secondary py-1 px-3 text-[12px]" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </SectionCard>
      </div>
      <GlEntryTraceDrawer
        isOpen={traceOpen && !!traceEntryId}
        loading={traceLoading}
        errorMessage={traceIsError ? ((traceError as Error)?.message || 'Failed to load trace data') : undefined}
        tab={traceTab}
        onTabChange={setTraceTab}
        onClose={() => { setTraceOpen(false); setTraceEntryId(null); }}
        trace={traceData as any}
      />
    </div>
  )
}
