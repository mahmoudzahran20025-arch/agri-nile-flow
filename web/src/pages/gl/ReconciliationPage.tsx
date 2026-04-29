/**
 * ReconciliationPage — FIN-EPIC-05
 * Source-document ↔ GL journal-entry reconciliation workbench.
 * Shows mismatches between operational events and posted GL entries.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, FileSearch, ExternalLink, Filter } from 'lucide-react'
import { glApi, type SourceDocRow, type ReconciliationResult } from '../../api/client'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import StatusBadge from '../../components/ui/StatusBadge'
import DataTable, { type Column } from '../../components/ui/DataTable'

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
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">Reconciliation Workbench</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          Verify that every operational event has a corresponding posted GL entry. Investigate and resolve mismatches.
        </p>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpis} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

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
    </div>
  )
}
