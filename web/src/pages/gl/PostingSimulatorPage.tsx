/**
 * PostingSimulatorPage — FIN-EPIC-04
 * Dry-run the posting engine for any transaction type.
 * Shows the resolved Dr/Cr lines, validation errors, and warnings before
 * any real data is written — safe for training and setup verification.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlayCircle, AlertTriangle, CheckCircle2, XCircle, ChevronRight, Info } from 'lucide-react'
import { glApi } from '../../api/client'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import type { ValidationBlueprint } from '../../api/gl'

// ── Types ─────────────────────────────────────────────────────────────────────

type TxType = 'inventory_in' | 'inventory_out' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'

interface SimForm {
  type: TxType
  amount: string
  bpg_code: string
  ppg_code: string
  ipg_code: string
  ap_code: string
  cash_code: string
  receivable_code: string
}

const TX_TYPES: { value: TxType; label: string; needsBpg?: boolean; needsPpg?: boolean; needsIpg?: boolean; needsAp?: boolean; needsCash?: boolean; needsReceivable?: boolean }[] = [
  { value: 'inventory_in',       label: 'Inventory In (Purchase / Receive)',        needsIpg: true,  needsPpg: true  },
  { value: 'inventory_out',      label: 'Inventory Out (Issue / COGS)',              needsIpg: true,  needsPpg: true  },
  { value: 'supplier_invoice',   label: 'Supplier Invoice (AP creation)',            needsBpg: true,  needsPpg: true,  needsAp: true  },
  { value: 'supplier_payment',   label: 'Supplier Payment (AP settlement)',          needsAp: true,   needsCash: true  },
  { value: 'expense',            label: 'Operational Expense (Cash out)',            needsBpg: true,  needsPpg: true,  needsCash: true  },
  { value: 'revenue',            label: 'Sales Revenue (AR entry)',                  needsBpg: true,  needsPpg: true,  needsReceivable: true },
]

const BLANK: SimForm = {
  type: 'inventory_in', amount: '1000',
  bpg_code: '', ppg_code: '', ipg_code: '',
  ap_code: '', cash_code: '', receivable_code: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function nullable(s: string): string | null {
  return s.trim() || null
}

function buildPayload(f: SimForm) {
  return {
    type: f.type,
    amount: Math.max(0.01, Number(f.amount) || 0),
    bpg_code:       nullable(f.bpg_code),
    ppg_code:       nullable(f.ppg_code),
    ipg_code:       nullable(f.ipg_code),
    ap_code:        f.ap_code.trim() || undefined,
    cash_code:      f.cash_code.trim() || undefined,
    receivable_code: f.receivable_code.trim() || undefined,
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LinesTable({ lines }: { lines: ValidationBlueprint['lines'] }) {
  const totalDr = lines.reduce((s, l) => s + (l.debit  ?? 0), 0)
  const totalCr = lines.reduce((s, l) => s + (l.credit ?? 0), 0)
  const balanced = Math.abs(totalDr - totalCr) < 0.01

  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-[#0F2D5C] text-white">
            <th className="px-3 py-2 text-left font-semibold">Account Code</th>
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-right font-semibold">Debit</th>
            <th className="px-3 py-2 text-right font-semibold">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
              <td className="px-3 py-2 font-mono font-semibold text-[#0F2D5C]">{l.account_code}</td>
              <td className="px-3 py-2 text-slate-600">{l.description ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono text-emerald-700">
                {l.debit  > 0 ? fmtAmt(l.debit)  : ''}
              </td>
              <td className="px-3 py-2 text-right font-mono text-rose-700">
                {l.credit > 0 ? fmtAmt(l.credit) : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
            <td className="px-3 py-2 text-slate-500 text-[11px] uppercase tracking-wide" colSpan={2}>
              Totals
              {balanced
                ? <span className="ml-2 inline-flex items-center gap-1 text-[#1D9E75]"><CheckCircle2 size={11}/> Balanced</span>
                : <span className="ml-2 inline-flex items-center gap-1 text-red-600"><XCircle size={11}/> Imbalanced!</span>
              }
            </td>
            <td className="px-3 py-2 text-right font-mono text-emerald-700">{fmtAmt(totalDr)}</td>
            <td className="px-3 py-2 text-right font-mono text-rose-700">{fmtAmt(totalCr)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function MessageList({ items, variant }: { items: string[]; variant: 'error' | 'warning' | 'info' }) {
  if (!items.length) return null
  const cfg = {
    error:   { bg: 'bg-red-50 border-red-200',    icon: <XCircle size={14} className="text-red-500 shrink-0" />, text: 'text-red-800' },
    warning: { bg: 'bg-amber-50 border-amber-200', icon: <AlertTriangle size={14} className="text-amber-500 shrink-0" />, text: 'text-amber-800' },
    info:    { bg: 'bg-blue-50 border-blue-200',   icon: <Info size={14} className="text-blue-500 shrink-0" />, text: 'text-blue-800' },
  }[variant]

  return (
    <div className={`rounded border ${cfg.bg} p-3 space-y-1.5`}>
      {items.map((msg, i) => (
        <div key={i} className="flex items-start gap-2">
          {cfg.icon}
          <p className={`text-[12px] leading-snug ${cfg.text}`}>{msg}</p>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PostingSimulatorPage() {
  const [form, setForm] = useState<SimForm>(BLANK)
  const [triggered, setTriggered] = useState(false)
  const [payload, setPayload] = useState<ReturnType<typeof buildPayload> | null>(null)

  const set = <K extends keyof SimForm>(k: K, v: SimForm[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const txMeta = TX_TYPES.find(t => t.value === form.type)!

  const { data: groups } = useQuery({
    queryKey: ['sim-posting-groups-all'],
    queryFn: async () => {
      const [bpg, ppg, ipg] = await Promise.all([
        glApi.postingGroups('business'),
        glApi.postingGroups('product'),
        glApi.postingGroups('inventory'),
      ])
      return { bpg, ppg, ipg }
    },
  })

  const { data: accounts } = useQuery({
    queryKey: ['sim-accounts'],
    queryFn: () => glApi.accounts() as Promise<Array<{ code: string; name: string; account_type: string }>>,
  })

  const { data: result, isFetching, error } = useQuery({
    queryKey: ['sim-validate', payload],
    queryFn: () => glApi.validatePosting(payload!),
    enabled: triggered && !!payload,
    staleTime: 0,
  })

  function runSim() {
    const p = buildPayload(form)
    setPayload(p)
    setTriggered(true)
  }

  const blueprint = result as ValidationBlueprint | undefined

  const kpis: KpiItem[] = [
    { id: 'type', label: 'SELECTED TYPE', value: txMeta.label.split('(')[0].trim() },
    { id: 'amount', label: 'SIMULATED AMOUNT', value: `${Number(form.amount || 0).toLocaleString()} ج.م` },
    { id: 'lines', label: 'RESOLVED LINES', value: blueprint ? String(blueprint.lines.length) : '—' },
    {
      id: 'status',
      label: 'SIMULATION STATUS',
      value: !blueprint ? 'READY' : blueprint.isBlocked ? 'BLOCKED' : 'VALID',
      variant: !blueprint ? 'default' : blueprint.isBlocked ? 'warning' : 'success',
    },
  ]

  const actions: CommandAction[] = [
    {
      id: 'run',
      label: isFetching ? 'Running…' : 'Run Simulation',
      icon: <PlayCircle />,
      variant: 'primary',
      onClick: runSim,
    },
    {
      id: 'reset',
      label: 'Reset',
      onClick: () => { setForm(BLANK); setTriggered(false); setPayload(null) },
      variant: 'secondary',
    },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">Posting Engine Simulator</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          Dry-run the posting engine before going live. No entries are created. Validates account resolution, balance, and rule coverage.
        </p>
      </div>

      <CommandBar actions={actions} />
      <KpiStrip items={kpis} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">

          {/* ── Left: Config Panel ─────────────────────────────── */}
          <div className="space-y-5">
            <SectionCard title="Transaction Setup" subtitle="Define the scenario to simulate" icon={<PlayCircle size={14} />}>
              {/* Type */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Transaction Type *</label>
                <select
                  className="input text-[13px]"
                  value={form.type}
                  onChange={e => { set('type', e.target.value as TxType); setTriggered(false) }}
                >
                  {TX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {/* Amount */}
              <div className="mt-4">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Simulated Amount (ج.م)</label>
                <input
                  type="number" min="1" step="100"
                  className="input text-[13px]"
                  value={form.amount}
                  onChange={e => set('amount', e.target.value)}
                />
              </div>

              {/* Posting Groups */}
              {(txMeta.needsBpg || txMeta.needsPpg || txMeta.needsIpg) && (
                <div className="mt-4 space-y-3">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Posting Groups</p>
                  {txMeta.needsBpg && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Business Posting Group (BPG)</label>
                      <select className="input text-[12px]" value={form.bpg_code} onChange={e => set('bpg_code', e.target.value)}>
                        <option value="">— Default (NULL) —</option>
                        {(groups?.bpg ?? []).map((g: { code: string; name: string }) => <option key={g.code} value={g.code}>{g.code} — {g.name}</option>)}
                      </select>
                    </div>
                  )}
                  {txMeta.needsPpg && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Product Posting Group (PPG)</label>
                      <select className="input text-[12px]" value={form.ppg_code} onChange={e => set('ppg_code', e.target.value)}>
                        <option value="">— Default (NULL) —</option>
                        {(groups?.ppg ?? []).map((g: { code: string; name: string }) => <option key={g.code} value={g.code}>{g.code} — {g.name}</option>)}
                      </select>
                    </div>
                  )}
                  {txMeta.needsIpg && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Inventory Posting Group (IPG)</label>
                      <select className="input text-[12px]" value={form.ipg_code} onChange={e => set('ipg_code', e.target.value)}>
                        <option value="">— Default (NULL) —</option>
                        {(groups?.ipg ?? []).map((g: { code: string; name: string }) => <option key={g.code} value={g.code}>{g.code} — {g.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Override accounts */}
              {(txMeta.needsAp || txMeta.needsCash || txMeta.needsReceivable) && (
                <div className="mt-4 space-y-3">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Account Overrides</p>
                  {txMeta.needsAp && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Accounts Payable Code</label>
                      <select className="input text-[12px]" value={form.ap_code} onChange={e => set('ap_code', e.target.value)}>
                        <option value="">— Pick account —</option>
                        {(accounts ?? []).filter(a => a.account_type === 'liability' || a.account_type === 'payable').map(a => (
                          <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                        ))}
                        {(accounts ?? []).filter(a => !['liability','payable'].includes(a.account_type)).map(a => (
                          <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {txMeta.needsCash && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Cash / Bank Account Code</label>
                      <select className="input text-[12px]" value={form.cash_code} onChange={e => set('cash_code', e.target.value)}>
                        <option value="">— Pick account —</option>
                        {(accounts ?? []).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                      </select>
                    </div>
                  )}
                  {txMeta.needsReceivable && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Accounts Receivable Code</label>
                      <select className="input text-[12px]" value={form.receivable_code} onChange={e => set('receivable_code', e.target.value)}>
                        <option value="">— Pick account —</option>
                        {(accounts ?? []).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-slate-100">
                <button
                  className="btn-primary w-full flex items-center justify-center gap-2 text-[13px]"
                  onClick={runSim}
                  disabled={isFetching}
                >
                  <PlayCircle size={15} />
                  {isFetching ? 'Resolving…' : 'Run Simulation'}
                </button>
              </div>
            </SectionCard>

            {/* Engine Reference */}
            <SectionCard title="Resolution Hierarchy" subtitle="4-phase account lookup order" icon={<ChevronRight size={14} />}>
              <ol className="space-y-2 text-[12px] text-slate-600">
                {[
                  'Phase 1 — Exact match: BPG × PPG (or IPG × PPG)',
                  'Phase 2 — BPG only (PPG = NULL)',
                  'Phase 3 — PPG only (BPG = NULL)',
                  'Phase 4 — NULL × NULL (default catch-all)',
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#0F2D5C] text-white text-[10px] flex items-center justify-center shrink-0 font-bold mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] text-slate-400 italic">
                If no account is found at any phase, the transaction is blocked — no unresolved entries are created.
              </p>
            </SectionCard>
          </div>

          {/* ── Right: Results Panel ────────────────────────────── */}
          <div className="space-y-5">
            {!triggered && (
              <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-slate-200 bg-white text-center px-6">
                <PlayCircle size={40} className="text-slate-300 mb-3" />
                <p className="text-[14px] font-semibold text-slate-500">Configure a scenario and click Run Simulation</p>
                <p className="text-[12px] text-slate-400 mt-1">The resolved Dr/Cr journal lines will appear here.</p>
              </div>
            )}

            {triggered && isFetching && (
              <div className="flex items-center justify-center h-32 rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center gap-2 text-[13px] text-slate-500">
                  <div className="w-4 h-4 border-2 border-[#0F2D5C] border-t-transparent rounded-full animate-spin" />
                  Resolving accounts…
                </div>
              </div>
            )}

            {triggered && !isFetching && error && (
              <SectionCard title="Simulation Error" icon={<XCircle size={14} className="text-red-500" />}>
                <p className="text-[13px] text-red-700">{(error as Error).message}</p>
              </SectionCard>
            )}

            {triggered && !isFetching && blueprint && (
              <>
                {/* Status Banner */}
                <div className={`rounded-lg px-4 py-3 flex items-center gap-3 border ${
                  blueprint.isBlocked
                    ? 'bg-red-50 border-red-200'
                    : 'bg-emerald-50 border-emerald-200'
                }`}>
                  {blueprint.isBlocked
                    ? <XCircle size={18} className="text-red-500 shrink-0" />
                    : <CheckCircle2 size={18} className="text-[#1D9E75] shrink-0" />
                  }
                  <div>
                    <p className={`font-semibold text-[13px] ${blueprint.isBlocked ? 'text-red-800' : 'text-emerald-800'}`}>
                      {blueprint.isBlocked ? 'Posting Blocked — Account resolution failed' : 'Simulation Passed — Entry will be created'}
                    </p>
                    <p className={`text-[11px] mt-0.5 ${blueprint.isBlocked ? 'text-red-600' : 'text-emerald-600'}`}>
                      {blueprint.lines.length} line(s) resolved
                      {!blueprint.isBlocked && ` · ${blueprint.warnings.length} warning(s)`}
                    </p>
                  </div>
                </div>

                {/* Errors */}
                <MessageList items={blueprint.validationErrors} variant="error" />
                {/* Warnings */}
                <MessageList items={blueprint.warnings} variant="warning" />

                {/* Lines */}
                {blueprint.lines.length > 0 && (
                  <SectionCard title="Resolved Journal Lines" subtitle="Preview of the Dr/Cr entry that would be posted" icon={<CheckCircle2 size={14} className="text-[#1D9E75]" />}>
                    <LinesTable lines={blueprint.lines} />

                    {/* Raw trace */}
                    <details className="mt-4">
                      <summary className="text-[11px] font-mono text-slate-400 cursor-pointer select-none hover:text-slate-600">
                        Raw engine response (JSON)
                      </summary>
                      <pre className="mt-2 text-[10px] bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto leading-relaxed">
                        {JSON.stringify(blueprint, null, 2)}
                      </pre>
                    </details>
                  </SectionCard>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
