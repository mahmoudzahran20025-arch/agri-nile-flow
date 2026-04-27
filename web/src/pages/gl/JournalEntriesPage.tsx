import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookMarked, Plus, Trash2, ChevronDown, ArrowUp, ArrowDown, ArrowUpDown,
  CheckCircle2, X, Save, RotateCcw, Download, FileText, Bookmark, BookmarkCheck, Printer,
} from 'lucide-react'
import { glApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import { usePermission } from '../../hooks/usePermission'
import { useAppStore } from '../../store/appStore'

interface JournalEntry {
  id: number; entry_date: string; description: string; entry_number?: string
  ref_type?: string; ref_id?: number; period_name?: string
  total_debit: number; total_credit: number; is_posted: number
  reversal_entry_id?: number | null
}
interface EntryLine {
  account_code: string; account_name?: string; debit: number; credit: number; description?: string
}
interface EntryDetail extends JournalEntry { lines: EntryLine[] }
interface NewLine { account_code: string; debit: string; credit: string; description: string }

const REF_LABELS: Record<string, string> = {
  cash_transaction:     'خزينة',
  supplier_transaction: 'مورد',
  inventory_movement:   'مخزون',
  manual:               'يدوي',
}
const REF_COLORS: Record<string, string> = {
  cash_transaction:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  supplier_transaction: 'bg-blue-50 text-blue-700 border-blue-200',
  inventory_movement:   'bg-amber-50 text-amber-700 border-amber-200',
  manual:               'bg-purple-50 text-purple-700 border-purple-200',
}

function fmt(n: number) { return Number(n || 0).toLocaleString('en-US') }
function esc(v: string) {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Entry template helpers (localStorage) ─────────────────────
const TEMPLATES_KEY = 'gl_entry_templates_v1'

interface EntryTemplate {
  id: string; name: string; lines: NewLine[]
}

function loadTemplates(): EntryTemplate[] {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]') } catch { return [] }
}

function saveTemplate(t: EntryTemplate) {
  const existing = loadTemplates().filter(x => x.id !== t.id)
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify([t, ...existing].slice(0, 20)))
}

function deleteTemplate(id: string) {
  const existing = loadTemplates().filter(x => x.id !== id)
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(existing))
}

// ── Full-page New Entry Form ──────────────────────────────────
function NewEntryForm({
  onCancel, onSaved,
}: { onCancel: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [header, setHeader] = useState({ entry_date: new Date().toISOString().slice(0, 10), description: '' })
  const [lines, setLines]   = useState<NewLine[]>([
    { account_code: '', debit: '', credit: '', description: '' },
    { account_code: '', debit: '', credit: '', description: '' },
  ])
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates]         = useState<EntryTemplate[]>(loadTemplates)
  const [savingName, setSavingName]       = useState('')
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)

  const { data: accounts = [] } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn:  () => glApi.accounts(),
  })
  const accountList = (accounts as { code: string; name: string; is_header: number }[]).filter(a => !a.is_header)

  const totalDebit  = lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0
  const diff        = totalDebit - totalCredit

  const addLine    = () => setLines(p => [...p, { account_code: '', debit: '', credit: '', description: '' }])
  const removeLine = (i: number) => setLines(p => p.filter((_, idx) => idx !== i))
  const updateLine = (i: number, f: Partial<NewLine>) =>
    setLines(p => p.map((l, idx) => idx === i ? { ...l, ...f } : l))

  function applyTemplate(t: EntryTemplate) {
    setLines(t.lines.map(l => ({ ...l })))
    if (t.name) setHeader(h => ({ ...h, description: h.description || t.name }))
    setShowTemplates(false)
    toast(`تم تطبيق القالب: ${t.name}`, 'success')
  }

  function handleSaveTemplate() {
    if (!savingName.trim()) return
    const t: EntryTemplate = {
      id:    Date.now().toString(),
      name:  savingName.trim(),
      lines: lines.filter(l => l.account_code),
    }
    saveTemplate(t)
    setTemplates(loadTemplates())
    setSavingName('')
    setShowSaveTemplate(false)
    toast('تم حفظ القالب', 'success')
  }

  const saveMutation = useMutation({
    mutationFn: () => glApi.createEntry({
      entry_date:  header.entry_date,
      description: header.description,
      lines: lines
        .filter(l => l.account_code && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map(l => ({
          account_code: l.account_code,
          debit:        Number(l.debit)  || 0,
          credit:       Number(l.credit) || 0,
          description:  l.description || undefined,
        })),
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { toast(res.error ?? 'خطأ', 'error'); return }
      toast('تم حفظ القيد وترحيله بنجاح', 'success')
      onSaved()
    },
    onError: () => toast('فشل حفظ القيد', 'error'),
  })

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-fade-in">
      {/* Form Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-purple-600 to-blue-600">
        <div className="flex items-center gap-2 text-white">
          <BookMarked size={18} />
          <span className="font-bold text-sm">قيد يومية يدوي جديد</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTemplates(s => !s)}
            className="flex items-center gap-1 text-white/80 hover:text-white text-xs border border-white/30 hover:border-white/60 px-2.5 py-1 rounded-lg transition-all"
            title="القوالب المحفوظة"
          >
            <Bookmark size={13} /> قوالب
            {templates.length > 0 && (
              <span className="bg-white/20 text-white text-[10px] px-1 rounded">{templates.length}</span>
            )}
          </button>
          <button onClick={onCancel} className="text-white/70 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Templates Panel */}
      {showTemplates && (
        <div className="px-5 py-3 bg-purple-50 border-b border-purple-100">
          {templates.length === 0 ? (
            <p className="text-xs text-slate-400">لا توجد قوالب محفوظة. أكمل القيد وانقر "حفظ كقالب".</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-1 bg-white border border-purple-200 rounded-lg px-2 py-1 text-xs">
                  <button
                    onClick={() => applyTemplate(t)}
                    className="text-purple-700 font-medium hover:text-purple-900 transition-colors"
                  >
                    <BookmarkCheck size={11} className="inline ml-1" />
                    {t.name}
                    <span className="text-slate-400 mr-1">({t.lines.length} سطر)</span>
                  </button>
                  <button
                    onClick={() => { deleteTemplate(t.id); setTemplates(loadTemplates()) }}
                    className="text-slate-300 hover:text-red-400 transition-colors p-0.5"
                    title="حذف القالب"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Meta fields */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4 border-b border-slate-100 bg-slate-50/50">
        <div>
          <label className="label">التاريخ *</label>
          <input
            className="input"
            type="date"
            value={header.entry_date}
            onChange={e => setHeader(p => ({ ...p, entry_date: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">البيان *</label>
          <input
            className="input"
            value={header.description}
            onChange={e => setHeader(p => ({ ...p, description: e.target.value }))}
            placeholder="مثال: قيد افتتاحي / تسوية حسابية..."
            autoFocus
          />
        </div>
      </div>

      {/* Lines grid — Excel-style */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="th text-right w-8 text-slate-400">#</th>
              <th className="th text-right">الحساب</th>
              <th className="th text-right w-40">مدين</th>
              <th className="th text-right w-40">دائن</th>
              <th className="th text-right">بيان السطر</th>
              <th className="th w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const acct = accountList.find(a => a.code === l.account_code)
              return (
                <tr
                  key={i}
                  className={`border-b border-slate-100 transition-colors ${
                    l.account_code ? 'bg-white hover:bg-slate-50/50' : 'bg-slate-50/30'
                  }`}
                >
                  <td className="td text-slate-300 text-xs text-center">{i + 1}</td>
                  <td className="td">
                    <div className="flex flex-col gap-0.5">
                      <select
                        className="input text-xs py-1"
                        value={l.account_code}
                        onChange={e => updateLine(i, { account_code: e.target.value })}
                      >
                        <option value="">— اختر حساب —</option>
                        {accountList.map(a => (
                          <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                      {acct && (
                        <span className="text-[10px] text-slate-400 pr-1">{acct.name}</span>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <input
                      className={`input text-xs py-1 w-full tabular-nums text-left ${
                        Number(l.debit) > 0 ? 'border-red-300 bg-red-50/50 font-semibold text-red-700' : ''
                      }`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.debit}
                      placeholder="0"
                      onChange={e => updateLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className={`input text-xs py-1 w-full tabular-nums text-left ${
                        Number(l.credit) > 0 ? 'border-green-300 bg-green-50/50 font-semibold text-green-700' : ''
                      }`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.credit}
                      placeholder="0"
                      onChange={e => updateLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className="input text-xs py-1 w-full"
                      value={l.description}
                      placeholder="اختياري..."
                      onChange={e => updateLine(i, { description: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    {lines.length > 2 && (
                      <button onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>

          {/* Totals footer */}
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="td text-xs font-bold text-slate-500" colSpan={2}>
                الإجمالي ({lines.filter(l => l.account_code).length} سطر)
              </td>
              <td className="td">
                <span className={`text-sm font-black tabular-nums ${isBalanced ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt(totalDebit)}
                </span>
              </td>
              <td className="td">
                <span className={`text-sm font-black tabular-nums ${isBalanced ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt(totalCredit)}
                </span>
              </td>
              <td className="td" colSpan={2}>
                {isBalanced ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
                    <CheckCircle2 size={12} /> متوازن
                  </span>
                ) : totalDebit > 0 || totalCredit > 0 ? (
                  <span className="text-xs font-bold text-red-600">
                    فرق: {fmt(Math.abs(diff))} {diff > 0 ? '(مدين أكبر)' : '(دائن أكبر)'}
                  </span>
                ) : null}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Bottom actions */}
      <div className="flex items-center justify-between px-5 py-4 bg-slate-50 border-t border-slate-200">
        <div className="flex items-center gap-2">
          <button
            onClick={addLine}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-semibold border border-dashed border-blue-300 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-all"
          >
            <Plus size={14} /> إضافة سطر
          </button>
          <button
            onClick={() => setShowSaveTemplate(s => !s)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-purple-600 border border-slate-200 hover:border-purple-300 px-2.5 py-1.5 rounded-lg transition-all"
            title="حفظ كقالب للاستخدام لاحقاً"
          >
            <Bookmark size={12} /> حفظ كقالب
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="btn-secondary gap-1.5 text-sm"
          >
            <RotateCcw size={13} /> إلغاء
          </button>
          <button
            className="btn-primary gap-1.5 shadow-lg shadow-blue-100"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !header.entry_date || !header.description || !isBalanced}
          >
            <Save size={13} />
            {saveMutation.isPending ? 'جاري الحفظ...' : 'ترحيل القيد'}
          </button>
        </div>
      </div>

      {/* Save as template panel */}
      {showSaveTemplate && (
        <div className="px-5 py-3 bg-purple-50/80 border-t border-purple-100 flex items-center gap-3">
          <FileText size={14} className="text-purple-500 shrink-0" />
          <input
            className="input text-xs h-8 flex-1 max-w-xs"
            placeholder="اسم القالب (مثال: رسوم بنكية شهرية)"
            value={savingName}
            onChange={e => setSavingName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveTemplate()}
            autoFocus
          />
          <button
            onClick={handleSaveTemplate}
            disabled={!savingName.trim() || lines.filter(l => l.account_code).length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            حفظ
          </button>
          <button onClick={() => setShowSaveTemplate(false)} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function JournalEntriesPage() {
  const { canWrite } = usePermission()
  const { toast }    = useToast()
  const company = useAppStore(state => state.company)
  const qc = useQueryClient()

  const [start,     setStart]    = useState('')
  const [end,       setEnd]      = useState('')
  const [refType,   setRefType]  = useState('')
  const [search,    setSearch]   = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [page,      setPage]     = useState(1)
  const [selectedId,setSelected] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showNew,   setShowNew]  = useState(false)
  const [sortKey,   setSortKey]  = useState<'entry_date' | 'total_debit'>('entry_date')
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>('desc')

  const reverseMutation = useMutation({
    mutationFn: (id: number) => glApi.reverseEntry(id),
    onSuccess: () => {
      toast('تم إنشاء قيد العكس بنجاح', 'success')
      qc.invalidateQueries({ queryKey: ['gl-entries'] })
      qc.invalidateQueries({ queryKey: ['gl-entry', selectedId] })
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل إنشاء قيد العكس', 'error'),
  })

  const bulkReverseMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map((id) => glApi.reverseEntry(id)))
      return {
        ok:   results.filter(r => r.status === 'fulfilled').length,
        fail: results.filter(r => r.status === 'rejected').length,
      }
    },
    onSuccess: ({ ok, fail }) => {
      if (ok > 0) toast(`تم عكس ${ok} قيود بنجاح`, 'success')
      if (fail > 0) toast(`فشل عكس ${fail} قيود`, 'error')
      setSelectedIds([])
      qc.invalidateQueries({ queryKey: ['gl-entries'] })
      qc.invalidateQueries({ queryKey: ['gl-entry', selectedId] })
    },
    onError: () => toast('فشل تنفيذ العكس الجماعي', 'error'),
  })

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  const SortIcon = ({ k }: { k: typeof sortKey }) => {
    if (sortKey !== k) return <ArrowUpDown size={11} className="text-slate-300" />
    return sortDir === 'asc'
      ? <ArrowUp size={11} className="text-blue-500" />
      : <ArrowDown size={11} className="text-blue-500" />
  }

  const { data: entriesData, isLoading } = useQuery({
    queryKey: ['gl-entries', page, start, end, refType],
    queryFn:  () => glApi.entries({ page, size: 50, start: start || undefined, end: end || undefined, ref_type: refType || undefined }),
  })

  const rawEntries = ((entriesData as { data?: JournalEntry[] })?.data ?? []) as JournalEntry[]
  const total      = (entriesData as { total?: number })?.total ?? 0

  const entries = useMemo(() => {
    const q = search.trim().toLowerCase()
    const min = Number(minAmount)
    const max = Number(maxAmount)

    const filtered = rawEntries.filter((e) => {
      const byText = !q
        || e.description?.toLowerCase().includes(q)
        || String(e.id).includes(q)
        || (e.entry_number ?? '').toLowerCase().includes(q)

      const amount = Number(e.total_debit || 0)
      const byMin = !minAmount || amount >= min
      const byMax = !maxAmount || amount <= max

      return byText && byMin && byMax
    })

    return filtered.sort((a, b) => {
      const av = sortKey === 'total_debit' ? a.total_debit : a.entry_date
      const bv = sortKey === 'total_debit' ? b.total_debit : b.entry_date
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawEntries, search, minAmount, maxAmount, sortKey, sortDir])

  const totals = useMemo(() => {
    const debit = entries.reduce((s, e) => s + Number(e.total_debit || 0), 0)
    const credit = entries.reduce((s, e) => s + Number(e.total_credit || 0), 0)
    return { debit, credit }
  }, [entries])

  const reversibleEntries = useMemo(
    () => entries.filter(e => !e.reversal_entry_id),
    [entries]
  )
  const selectedReversibleIds = useMemo(
    () => selectedIds.filter(id => reversibleEntries.some(e => e.id === id)),
    [selectedIds, reversibleEntries]
  )

  const { data: detail } = useQuery({
    queryKey: ['gl-entry', selectedId],
    queryFn:  () => glApi.getEntry(selectedId!),
    enabled:  !!selectedId,
  }) as { data?: EntryDetail }

  const hasFilters = !!(start || end || refType || search || minAmount || maxAmount)
  const companyName = company?.name ?? '—'

  function printEntry(entry: EntryDetail) {
    const w = window.open('', '_blank', 'width=1100,height=800')
    if (!w) {
      toast('تعذر فتح نافذة الطباعة. تأكد من السماح بالنوافذ المنبثقة.', 'error')
      return
    }

    const totalDebit = entry.lines?.reduce((s, l) => s + Number(l.debit || 0), 0) ?? 0
    const totalCredit = entry.lines?.reduce((s, l) => s + Number(l.credit || 0), 0) ?? 0
    const printedAt = new Date().toLocaleString('en-GB')
    const rows = (entry.lines ?? []).map((l, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(l.account_code ?? '')}</td>
        <td>${esc(l.account_name ?? l.account_code ?? '')}</td>
        <td class="num">${Number(l.debit || 0) > 0 ? fmt(l.debit) : ''}</td>
        <td class="num">${Number(l.credit || 0) > 0 ? fmt(l.credit) : ''}</td>
        <td>${esc(l.description ?? '')}</td>
      </tr>
    `).join('')

    w.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>قيد يومية #${entry.id}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 24px; color: #0f172a; }
    .header { display: grid; grid-template-columns: 1fr auto; gap: 12px; margin-bottom: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
    .title { margin: 0; font-size: 24px; font-weight: 800; }
    .sub { margin: 4px 0 0; font-size: 12px; color: #475569; }
    .meta { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; font-size: 12px; min-width: 240px; }
    .meta div { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
    .meta div:last-child { margin-bottom: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    thead th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; text-align: right; }
    tbody td { border: 1px solid #e2e8f0; padding: 8px; font-size: 12px; vertical-align: top; }
    .num { text-align: left; direction: ltr; font-variant-numeric: tabular-nums; font-weight: 600; }
    tfoot td { border: 1px solid #94a3b8; background: #f8fafc; padding: 8px; font-size: 12px; font-weight: 800; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 28px; }
    .sig { border-top: 1px solid #64748b; padding-top: 8px; text-align: center; font-size: 12px; color: #334155; }
    @media print {
      body { margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="title">سند قيد يومية</h1>
      <p class="sub">${esc(companyName)} • General Ledger</p>
    </div>
    <div class="meta">
      <div><strong>الشركة</strong><span>${esc(companyName)}</span></div>
      <div><strong>رقم القيد</strong><span>#${entry.id}</span></div>
      <div><strong>تاريخ القيد</strong><span>${esc(entry.entry_date ?? '')}</span></div>
      <div><strong>الفترة</strong><span>${esc(entry.period_name ?? '—')}</span></div>
      <div><strong>نوع المرجع</strong><span>${esc(REF_LABELS[entry.ref_type ?? ''] ?? entry.ref_type ?? '—')}</span></div>
      <div><strong>وقت الطباعة</strong><span>${esc(printedAt)}</span></div>
    </div>
  </div>

  <p style="margin: 0 0 8px; font-size: 13px;"><strong>البيان:</strong> ${esc(entry.description ?? '')}</p>

  <table>
    <thead>
      <tr>
        <th style="width:44px;">#</th>
        <th style="width:120px;">الحساب</th>
        <th>اسم الحساب</th>
        <th style="width:140px;">مدين</th>
        <th style="width:140px;">دائن</th>
        <th>بيان السطر</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3">الإجمالي</td>
        <td class="num">${fmt(totalDebit)}</td>
        <td class="num">${fmt(totalCredit)}</td>
        <td>${Math.abs(totalDebit - totalCredit) < 0.01 ? 'قيد متوازن' : 'قيد غير متوازن'}</td>
      </tr>
    </tfoot>
  </table>

  <div class="signatures">
    <div class="sig">إعداد</div>
    <div class="sig">مراجعة</div>
    <div class="sig">اعتماد</div>
  </div>
</body>
</html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  function exportCSV(onlySelected = false) {
    const source = onlySelected
      ? entries.filter(e => selectedIds.includes(e.id))
      : entries

    const header = ['ID', 'التاريخ', 'رقم القيد', 'البيان', 'النوع', 'مجموع المدين', 'مجموع الدائن']
    const rows = source.map(e => [
      e.id,
      e.entry_date,
      e.entry_number ?? '',
      `"${(e.description ?? '').replace(/"/g, '""')}"`,
      e.ref_type ?? '',
      e.total_debit,
      e.total_credit,
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${onlySelected ? 'journal-entries-selected' : 'journal-entries'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function toggleEntrySelection(id: number) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function selectAllVisibleReversible() {
    setSelectedIds(reversibleEntries.map(e => e.id))
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <BookMarked size={22} className="text-purple-600" />
          <h1 className="page-title">قيود اليومية</h1>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200">
            {total.toLocaleString('en-US')} قيد
          </span>
        </div>
        {canWrite('gl') && !showNew && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCSV(false)}
              disabled={entries.length === 0}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
              title="تصدير CSV"
            >
              <Download size={14} /> CSV
            </button>
            <button
              onClick={() => exportCSV(true)}
              disabled={selectedIds.length === 0}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
              title="تصدير CSV للقيود المحددة"
            >
              <Download size={14} /> CSV المحدد
            </button>
            <button className="btn-primary gap-2" onClick={() => { setShowNew(true); setSelected(null) }}>
              <Plus size={16} /> قيد يدوي
            </button>
          </div>
        )}
      </div>

      {/* New Entry Full-page Form */}
      {showNew && (
        <NewEntryForm
          onCancel={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false)
            qc.invalidateQueries({ queryKey: ['gl-entries'] })
          }}
        />
      )}

      {/* Filters bar */}
      <div className="card p-4 bg-slate-50/50">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">من:</label>
            <input type="date" className="input w-36 text-xs h-8" value={start}
              onChange={e => { setStart(e.target.value); setPage(1) }} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">إلى:</label>
            <input type="date" className="input w-36 text-xs h-8" value={end}
              onChange={e => { setEnd(e.target.value); setPage(1) }} />
          </div>
          <input
            className="input h-8 w-52 text-xs"
            placeholder="بحث بالبيان أو رقم القيد"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            className="input h-8 w-28 text-xs"
            placeholder="أدنى مبلغ"
            value={minAmount}
            onChange={(e) => { setMinAmount(e.target.value); setPage(1) }}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            className="input h-8 w-28 text-xs"
            placeholder="أعلى مبلغ"
            value={maxAmount}
            onChange={(e) => { setMaxAmount(e.target.value); setPage(1) }}
          />
          <div className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 p-1 shadow-sm">
            {[
              { v: '', l: 'الكل' },
              { v: 'cash_transaction',     l: '💵 خزينة' },
              { v: 'supplier_transaction', l: '🏭 موردون' },
              { v: 'inventory_movement',   l: '📦 مخزون' },
              { v: 'manual',               l: '✍️ يدوي' },
            ].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => { setRefType(v); setPage(1) }}
                className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                  refType === v ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button
              className="flex items-center gap-1 text-xs font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
              onClick={() => {
                setStart('')
                setEnd('')
                setRefType('')
                setSearch('')
                setMinAmount('')
                setMaxAmount('')
                setPage(1)
              }}
            >
              <X size={12} /> مسح الفلاتر
            </button>
          )}
          <span className="mr-auto text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            {entries.length.toLocaleString('en-US')} نتيجة معروضة (من {total.toLocaleString('en-US')})
          </span>
        </div>
      </div>

      {/* Quick stats for current visible list */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-[11px] text-slate-500">إجمالي القيود المعروضة</p>
          <p className="text-lg font-black text-slate-800">{entries.length.toLocaleString('en-US')}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-slate-500">إجمالي المدين (المعروض)</p>
          <p className="text-lg font-black text-red-600">{fmt(totals.debit)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-slate-500">إجمالي الدائن (المعروض)</p>
          <p className="text-lg font-black text-emerald-700">{fmt(totals.credit)}</p>
        </div>
      </div>

      {/* Bulk actions */}
      {canWrite('gl') && !showNew && (
        <div className="card p-3 bg-red-50/40 border border-red-100 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-600">
            محدد: {selectedIds.length} | قابل للعكس: {selectedReversibleIds.length}
          </span>
          <button
            onClick={selectAllVisibleReversible}
            disabled={reversibleEntries.length === 0}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40"
          >
            تحديد كل القابلة للعكس
          </button>
          <button
            onClick={() => setSelectedIds([])}
            disabled={selectedIds.length === 0}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40"
          >
            إلغاء التحديد
          </button>
          <button
            onClick={() => bulkReverseMutation.mutate(selectedReversibleIds)}
            disabled={selectedReversibleIds.length === 0 || bulkReverseMutation.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
          >
            <span className="inline-flex items-center gap-1">
              <RotateCcw size={12} />
              {bulkReverseMutation.isPending ? 'جارٍ العكس...' : 'عكس المحدد'}
            </span>
          </button>
        </div>
      )}

      {/* Main layout: list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── Entries List ──────────────────────────── */}
        <div className="lg:col-span-2 space-y-2">
          {/* Sort bar */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
            {([
              { k: 'entry_date'  as const, l: 'التاريخ' },
              { k: 'total_debit' as const, l: 'المبلغ' },
            ]).map(({ k, l }) => (
              <button
                key={k}
                onClick={() => toggleSort(k)}
                className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  sortKey === k ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {l} <SortIcon k={k} />
              </button>
            ))}
          </div>

          {isLoading && (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card animate-pulse h-16 bg-slate-100/60" />
              ))}
            </div>
          )}

          {entries.map(e => {
            const refColor = REF_COLORS[e.ref_type ?? ''] ?? 'bg-slate-50 text-slate-500 border-slate-200'
            const isSelected = selectedId === e.id
            const isChecked = selectedIds.includes(e.id)
            return (
              <div
                key={e.id}
                onClick={() => { setSelected(e.id); setShowNew(false) }}
                className={`card cursor-pointer transition-all hover:shadow-md ${
                  isSelected ? 'ring-2 ring-blue-500 bg-blue-50/30' : 'hover:bg-slate-50/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={() => toggleEntrySelection(e.id)}
                      disabled={!!e.reversal_entry_id}
                      title={e.reversal_entry_id ? 'هذا القيد معكوس مسبقاً' : 'تحديد القيد'}
                      className="mt-0.5"
                    />
                    <p className="text-sm font-semibold text-slate-800 truncate flex-1">{e.description}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {e.reversal_entry_id && (
                      <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold border bg-slate-100 text-slate-400 border-slate-200">
                        معكوس
                      </span>
                    )}
                    {e.ref_type && (
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold border ${refColor}`}>
                        {REF_LABELS[e.ref_type] ?? e.ref_type}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{e.entry_date}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-red-600 font-mono">{fmt(e.total_debit)}</span>
                    <span className="text-slate-300">|</span>
                    <span className="text-emerald-700 font-mono">{fmt(e.total_credit)}</span>
                  </div>
                </div>
              </div>
            )
          })}

          {!isLoading && entries.length === 0 && (
            <div className="card text-center py-14 text-slate-400">
              <BookMarked size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">لا توجد قيود في هذه الفترة</p>
            </div>
          )}

          {/* Pagination */}
          {total > 50 && (
            <div className="flex justify-center gap-2 pt-2">
              <button className="btn-secondary text-xs h-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                ← السابق
              </button>
              <span className="text-xs text-slate-500 self-center px-3">صفحة {page}</span>
              <button className="btn-secondary text-xs h-8" disabled={entries.length < 50} onClick={() => setPage(p => p + 1)}>
                التالي →
              </button>
            </div>
          )}
        </div>

        {/* ── Entry Detail ──────────────────────────── */}
        <div className="lg:col-span-3">
          {!selectedId ? (
            <div className="card text-center text-slate-400 py-20 border-dashed border-2 border-slate-200">
              <ChevronDown size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">اختر قيداً من القائمة لعرض تفاصيله</p>
            </div>
          ) : !detail ? (
            <div className="card animate-pulse h-64 bg-slate-100/60" />
          ) : (
            <div className="card space-y-4 shadow-lg">
              {/* Detail header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="font-bold text-base text-slate-900">{detail.description}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {detail.entry_date}
                    {detail.period_name && <> · <span className="font-medium">{detail.period_name}</span></>}
                    {detail.ref_id && <> · <span className="font-mono">#{detail.ref_id}</span></>}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <button
                    onClick={() => printEntry(detail)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors"
                    title="طباعة القيد"
                  >
                    <Printer size={11} /> طباعة
                  </button>
                  {detail.reversal_entry_id ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">
                      <RotateCcw size={11} /> معكوس
                    </span>
                  ) : (
                    canWrite('gl') && (
                      <button
                        onClick={() => reverseMutation.mutate(detail.id)}
                        disabled={reverseMutation.isPending}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-40"
                        title="إنشاء قيد عكسي"
                      >
                        <RotateCcw size={11} />
                        {reverseMutation.isPending ? '...' : 'عكس القيد'}
                      </button>
                    )
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 size={11} /> مرحّل
                  </span>
                  {detail.ref_type && (
                    <span className={`px-2 py-1 rounded-lg text-xs font-bold border ${REF_COLORS[detail.ref_type] ?? ''}`}>
                      {REF_LABELS[detail.ref_type] ?? detail.ref_type}
                    </span>
                  )}
                </div>
              </div>

              {/* Lines table */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 rounded-xl">
                    <th className="th text-right">الحساب</th>
                    <th className="th text-right">الاسم</th>
                    <th className="th text-left">مدين</th>
                    <th className="th text-left">دائن</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines?.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="td font-mono text-blue-700 text-xs">{l.account_code}</td>
                      <td className="td text-slate-700">{l.account_name ?? l.account_code}</td>
                      <td className="td text-left tabular-nums">
                        {l.debit > 0
                          ? <span className="font-semibold text-red-600">{fmt(l.debit)}</span>
                          : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="td text-left tabular-nums">
                        {l.credit > 0
                          ? <span className="font-semibold text-emerald-700">{fmt(l.credit)}</span>
                          : <span className="text-slate-200">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="td font-bold text-slate-600" colSpan={2}>الإجمالي</td>
                    <td className="td text-left font-black text-red-600 tabular-nums">
                      {fmt(detail.lines?.reduce((s, l) => s + (l.debit ?? 0), 0) ?? 0)}
                    </td>
                    <td className="td text-left font-black text-emerald-700 tabular-nums">
                      {fmt(detail.lines?.reduce((s, l) => s + (l.credit ?? 0), 0) ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
