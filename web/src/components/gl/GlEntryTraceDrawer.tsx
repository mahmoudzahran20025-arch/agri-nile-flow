import { ExternalLink, GitBranch, Link2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { EntryTraceResult } from '../../api/gl'

// Maps source_module + optional document_type to a UI route.
// Returns null when the module has no dedicated screen to navigate to.
function resolveSourceRoute(
  sourceModule: string | undefined,
  sourceId: number | string | undefined,
): string | null {
  if (!sourceModule || !sourceId) return null
  switch (sourceModule) {
    case 'treasury':   return `/treasury?highlight=${sourceId}`
    case 'suppliers':  return `/suppliers/${sourceId}`
    case 'inventory':  return `/inventory/movements?highlight=${sourceId}`
    case 'hr':         return `/hr/payroll`
    case 'fields':     return `/fields/harvest`
    default:           return null
  }
}

type TraceTab = 'source' | 'lines' | 'trace'

interface GlEntryTraceDrawerProps {
  isOpen: boolean
  loading?: boolean
  tab: TraceTab
  onTabChange: (tab: TraceTab) => void
  onClose: () => void
  trace?: EntryTraceResult
}

function currency(n: number) {
  return Number(n || 0).toLocaleString('en-US')
}

export default function GlEntryTraceDrawer({
  isOpen,
  loading,
  tab,
  onTabChange,
  onClose,
  trace,
}: GlEntryTraceDrawerProps) {
  const navigate = useNavigate()
  const payload = trace?.data

  return (
    <div
      className={`absolute top-0 right-0 h-full w-[520px] bg-white border-l border-slate-200 shadow-2xl z-30 transition-transform duration-200 ${
        isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
      }`}
    >
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-slate-800 flex items-center gap-2">
            <GitBranch size={15} className="text-[#0F2D5C]" />
            Entry Traceability
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Lineage from source document to ledger lines</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-slate-200 rounded-full text-slate-500 hover:text-slate-800"
          aria-label="Close trace drawer"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2">
        {[
          { key: 'source', label: 'Source' },
          { key: 'lines', label: 'Lines' },
          { key: 'trace', label: 'Rule Trace' },
        ].map((it) => (
          <button
            key={it.key}
            onClick={() => onTabChange(it.key as TraceTab)}
            className={`px-3 py-1.5 rounded text-[12px] font-semibold ${
              tab === it.key ? 'bg-[#0F2D5C] text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>

      <div className="p-4 overflow-y-auto h-[calc(100%-102px)]">
        {loading ? (
          <div className="space-y-3">
            <div className="h-4 w-2/3 rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-1/2 rounded bg-slate-100 animate-pulse" />
            <div className="h-24 w-full rounded bg-slate-100 animate-pulse" />
          </div>
        ) : !payload ? (
          <div className="text-[12px] text-slate-500">No trace data found for this entry.</div>
        ) : (
          <>
            {tab === 'source' && (
              <div className="space-y-4 text-[12px]">
                <div className="border border-slate-200 rounded p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Source Event</div>
                  {payload.source_event ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div><span className="text-slate-400">Type:</span> <span className="font-medium">{payload.source_event.event_type}</span></div>
                      <div><span className="text-slate-400">Module:</span> <span className="font-medium">{payload.source_event.source_module}</span></div>
                      <div><span className="text-slate-400">Source ID:</span> <span className="font-medium">#{payload.source_event.source_id}</span></div>
                      <div><span className="text-slate-400">Date:</span> <span className="font-medium">{payload.source_event.event_date}</span></div>
                    </div>
                  ) : (
                    <div className="text-slate-500">No business event linked.</div>
                  )}
                </div>

                <div className="border border-slate-200 rounded p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Source Document Bridge</div>
                  {payload.source_document ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div><span className="text-slate-400">Document Type:</span> <span className="font-medium">{payload.source_document.document_type}</span></div>
                      <div><span className="text-slate-400">Link Type:</span> <span className="font-medium">{payload.source_document.link_type || 'auto'}</span></div>
                      <div><span className="text-slate-400">Source Ref:</span> <span className="font-medium">{payload.source_document.source_module}:{payload.source_document.source_id}</span></div>
                      <div><span className="text-slate-400">Journal Entry:</span> <span className="font-medium">#{payload.entry.id}</span></div>
                    </div>
                  ) : (
                    <div className="text-slate-500">No source document link available.</div>
                  )}
                </div>

                {/* Open Source action — lives here on the Source tab */}
                {(() => {
                  const src = payload.source_event ?? payload.source_document
                  const module = src && 'source_module' in src ? src.source_module : undefined
                  const id     = src && 'source_id'     in src ? src.source_id     : undefined
                  const route  = resolveSourceRoute(module, id)
                  return (
                    <div className="border border-slate-200 rounded p-3 flex items-center justify-between bg-slate-50">
                      <div className="text-slate-600 flex items-center gap-2">
                        <Link2 size={14} />
                        <span>{route ? `Navigate to ${module ?? 'source'} screen` : 'Source document reference'}</span>
                      </div>
                      {route ? (
                        <button
                          className="btn-secondary h-8 px-3 text-[12px] inline-flex items-center gap-1"
                          onClick={() => { onClose(); navigate(route) }}
                        >
                          Open Source
                          <ExternalLink size={13} />
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">
                          {module ? `No screen mapped for '${module}'` : 'No source linked'}
                        </span>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {tab === 'lines' && (
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Account</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-500">Debit</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-500">Credit</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Rule Slot</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payload.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          <div className="font-mono text-[#0F2D5C]">{line.account_code}</div>
                          <div className="text-[10px] text-slate-500">{line.account_name || '-'}</div>
                        </td>
                        <td className="px-3 py-2 text-right text-[#0F2D5C] tabular-nums">{line.debit > 0 ? currency(line.debit) : '-'}</td>
                        <td className="px-3 py-2 text-right text-red-600 tabular-nums">{line.credit > 0 ? currency(line.credit) : '-'}</td>
                        <td className="px-3 py-2 text-slate-600">{line.rule_slot || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'trace' && (
              <div className="space-y-3 text-[12px]">
                {payload.trace ? (
                  <div className="space-y-2">
                    {Object.entries(payload.trace as Record<string, unknown>).map(([key, val]) => (
                      <div key={key} className="border border-slate-200 rounded p-2.5 flex gap-3">
                        <span className="text-[11px] font-mono font-bold text-slate-500 min-w-[140px] shrink-0 pt-0.5">
                          {key}
                        </span>
                        <span className="text-slate-700 break-all">
                          {typeof val === 'object' ? (
                            <pre className="bg-slate-50 rounded px-2 py-1 text-[10px] overflow-auto whitespace-pre-wrap">
                              {JSON.stringify(val, null, 2)}
                            </pre>
                          ) : String(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-500 italic text-center py-6">No rule trace metadata recorded for this entry.</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
