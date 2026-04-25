import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookMarked, Plus, Trash2, ChevronDown, ArrowUp, ArrowDown, ArrowUpDown,
  CheckCircle2, X, Save, RotateCcw,
} from 'lucide-react'
import { glApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import { usePermission } from '../../hooks/usePermission'

interface JournalEntry {
  id: number; entry_date: string; description: string; entry_number?: string
  ref_type?: string; ref_id?: number; period_name?: string
  total_debit: number; total_credit: number; is_posted: number
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

function fmt(n: number) { return Number(n || 0).toLocaleString('ar-EG') }

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
        <button onClick={onCancel} className="text-white/70 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

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
        <button
          onClick={addLine}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-semibold border border-dashed border-blue-300 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-all"
        >
          <Plus size={14} /> إضافة سطر
        </button>
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
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function JournalEntriesPage() {
  const { canWrite } = usePermission()
  const qc = useQueryClient()

  const [start,     setStart]    = useState('')
  const [end,       setEnd]      = useState('')
  const [refType,   setRefType]  = useState('')
  const [page,      setPage]     = useState(1)
  const [selectedId,setSelected] = useState<number | null>(null)
  const [showNew,   setShowNew]  = useState(false)
  const [sortKey,   setSortKey]  = useState<'entry_date' | 'total_debit'>('entry_date')
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>('desc')

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
    return [...rawEntries].sort((a, b) => {
      const av = sortKey === 'total_debit' ? a.total_debit : a.entry_date
      const bv = sortKey === 'total_debit' ? b.total_debit : b.entry_date
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawEntries, sortKey, sortDir])

  const { data: detail } = useQuery({
    queryKey: ['gl-entry', selectedId],
    queryFn:  () => glApi.getEntry(selectedId!),
    enabled:  !!selectedId,
  }) as { data?: EntryDetail }

  const hasFilters = !!(start || end || refType)

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <BookMarked size={22} className="text-purple-600" />
          <h1 className="page-title">قيود اليومية</h1>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200">
            {total.toLocaleString('ar-EG')} قيد
          </span>
        </div>
        {canWrite('gl') && !showNew && (
          <button className="btn-primary gap-2" onClick={() => { setShowNew(true); setSelected(null) }}>
            <Plus size={16} /> قيد يدوي
          </button>
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
              onClick={() => { setStart(''); setEnd(''); setRefType(''); setPage(1) }}
            >
              <X size={12} /> مسح الفلاتر
            </button>
          )}
          <span className="mr-auto text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            {total.toLocaleString('ar-EG')} نتيجة
          </span>
        </div>
      </div>

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
            return (
              <div
                key={e.id}
                onClick={() => { setSelected(e.id); setShowNew(false) }}
                className={`card cursor-pointer transition-all hover:shadow-md ${
                  isSelected ? 'ring-2 ring-blue-500 bg-blue-50/30' : 'hover:bg-slate-50/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-slate-800 truncate flex-1">{e.description}</p>
                  {e.ref_type && (
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold border flex-shrink-0 ${refColor}`}>
                      {REF_LABELS[e.ref_type] ?? e.ref_type}
                    </span>
                  )}
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
                <div className="flex items-center gap-2">
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
