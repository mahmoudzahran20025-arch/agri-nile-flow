import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BookMarked, Plus, Trash2, ChevronDown, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { glApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import Modal from '../../components/ui/Modal'
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
  cash_transaction:       'خزينة',
  supplier_transaction:   'مورد',
  inventory_movement:     'مخزون',
  manual:                 'يدوي',
}
const REF_BADGE: Record<string, string> = {
  cash_transaction:       'badge-green',
  supplier_transaction:   'badge-blue',
  inventory_movement:     'badge-amber',
  manual:                 'badge-slate',
}

function fmt(n: number) { return Number(n || 0).toLocaleString('ar-EG') }

export default function JournalEntriesPage() {
  const { canWrite } = usePermission()
  const qc = useQueryClient()
  const { toast } = useToast()

  const [start, setStart] = useState('')
  const [end,   setEnd]   = useState('')
  const [refType, setRefType] = useState('')
  const [page,  setPage]  = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [openNew, setOpenNew] = useState(false)
  const [sortKey, setSortKey] = useState<'entry_date' | 'total_debit'>('entry_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const handleSortToggle = (key: 'entry_date' | 'total_debit') => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const SortIcon = ({ k }: { k: 'entry_date' | 'total_debit' }) => {
    if (sortKey !== k) return <ArrowUpDown size={12} className="text-slate-300" />
    return sortDir === 'asc' ? <ArrowUp size={12} className="text-brand-500" /> : <ArrowDown size={12} className="text-brand-500" />
  }

  const [newEntry, setNewEntry] = useState({ entry_date: '', description: '' })
  const [lines, setLines]       = useState<NewLine[]>([
    { account_code: '', debit: '', credit: '', description: '' },
    { account_code: '', debit: '', credit: '', description: '' },
  ])

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

  const { data: accounts = [] } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn:  () => glApi.accounts(),
  })
  const accountList = (accounts as { code: string; name: string; is_header: number }[])
    .filter(a => !a.is_header)

  const createEntry = useMutation({
    mutationFn: () => glApi.createEntry({
      entry_date:  newEntry.entry_date,
      description: newEntry.description,
      lines: lines.filter(l => l.account_code && (Number(l.debit) > 0 || Number(l.credit) > 0)).map(l => ({
        account_code: l.account_code,
        debit:        Number(l.debit)  || 0,
        credit:       Number(l.credit) || 0,
        description:  l.description   || undefined,
      })),
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { toast(res.error ?? 'خطأ', 'error'); return }
      qc.invalidateQueries({ queryKey: ['gl-entries'] })
      toast('تم حفظ القيد', 'success')
      setOpenNew(false)
      setNewEntry({ entry_date: '', description: '' })
      setLines([
        { account_code: '', debit: '', credit: '', description: '' },
        { account_code: '', debit: '', credit: '', description: '' },
      ])
    },
  })

  const totalDebit  = lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0

  const addLine = () => setLines(p => [...p, { account_code: '', debit: '', credit: '', description: '' }])
  const removeLine = (i: number) => setLines(p => p.filter((_, idx) => idx !== i))
  const updateLine = (i: number, f: Partial<NewLine>) =>
    setLines(p => p.map((l, idx) => idx === i ? { ...l, ...f } : l))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookMarked size={24} className="text-brand-600" />
          <h1 className="text-xl font-bold text-gray-900">قيود اليومية</h1>
          <span className="badge badge-blue">{total} قيد</span>
        </div>
        {canWrite('gl') && (
          <button className="btn btn-primary" onClick={() => setOpenNew(true)}>
            <Plus size={16} /> قيد يدوي
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input type="date" className="input w-40" value={start} onChange={e => { setStart(e.target.value); setPage(1) }} />
        <input type="date" className="input w-40" value={end}   onChange={e => { setEnd(e.target.value);   setPage(1) }} />
        <select className="input w-44" value={refType} onChange={e => { setRefType(e.target.value); setPage(1) }}>
          <option value="">كل أنواع القيود</option>
          <option value="cash_transaction">خزينة</option>
          <option value="supplier_transaction">موردون</option>
          <option value="inventory_movement">مخزون</option>
          <option value="manual">يدوي</option>
        </select>
        {(start || end || refType) && (
          <button className="btn btn-ghost text-sm" onClick={() => { setStart(''); setEnd(''); setRefType(''); setPage(1) }}>
            مسح
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Entries List */}
        <div className="lg:col-span-2 space-y-2">
          {/* Sort bar */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
            {([
              { k: 'entry_date' as const, l: 'التاريخ' },
              { k: 'total_debit' as const, l: 'المبلغ' },
            ]).map(({ k, l }) => (
              <button
                key={k}
                onClick={() => handleSortToggle(k)}
                className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  sortKey === k ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {l} <SortIcon k={k} />
              </button>
            ))}
          </div>

          {isLoading && <p className="text-sm text-gray-400 text-center py-8">جاري التحميل...</p>}
          {entries.map(e => (
            <div
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={`card cursor-pointer hover:shadow-md transition-all ${selectedId === e.id ? 'ring-2 ring-brand-500' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{e.description}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{e.entry_date}</p>
                </div>
                {e.ref_type && (
                  <span className={`badge ${REF_BADGE[e.ref_type] ?? 'badge-slate'} flex-shrink-0`}>
                    {REF_LABELS[e.ref_type] ?? e.ref_type}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-2 text-xs">
                <span className="text-gray-500">مدين: <strong>{fmt(e.total_debit)}</strong></span>
                <span className="text-gray-500">دائن: <strong>{fmt(e.total_credit)}</strong></span>
              </div>
            </div>
          ))}
          {!isLoading && entries.length === 0 && (
            <div className="card text-center py-10 text-gray-400">
              <BookMarked size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد قيود</p>
            </div>
          )}

          {/* Pagination */}
          {total > 50 && (
            <div className="flex justify-center gap-2 pt-2">
              <button className="btn btn-ghost text-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
              <span className="text-sm text-gray-500 self-center">{page}</span>
              <button className="btn btn-ghost text-sm" disabled={entries.length < 50} onClick={() => setPage(p => p + 1)}>التالي</button>
            </div>
          )}
        </div>

        {/* Entry Detail */}
        <div className="lg:col-span-3">
          {!selectedId ? (
            <div className="card text-center text-gray-400 py-16">
              <ChevronDown size={32} className="mx-auto mb-3 opacity-30" />
              <p>اختر قيداً لعرض تفاصيله</p>
            </div>
          ) : !detail ? (
            <p className="text-sm text-gray-400 text-center pt-10">جاري التحميل...</p>
          ) : (
            <div className="card space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold text-base">{detail.description}</h2>
                  <p className="text-sm text-gray-500">{detail.entry_date}
                    {detail.period_name && ` | ${detail.period_name}`}
                  </p>
                </div>
                {detail.ref_type && (
                  <span className={`badge ${REF_BADGE[detail.ref_type] ?? 'badge-slate'}`}>
                    {REF_LABELS[detail.ref_type] ?? detail.ref_type}
                    {detail.ref_id ? ` #${detail.ref_id}` : ''}
                  </span>
                )}
              </div>

              <table className="w-full text-sm border-t">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="th">كود الحساب</th>
                    <th className="th">اسم الحساب</th>
                    <th className="th">مدين</th>
                    <th className="th">دائن</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines?.map((l, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="td font-mono text-brand-700">{l.account_code}</td>
                      <td className="td">{l.account_name ?? l.account_code}</td>
                      <td className="td text-red-600 font-medium">
                        {l.debit  > 0 ? fmt(l.debit)  : '—'}
                      </td>
                      <td className="td text-green-700 font-medium">
                        {l.credit > 0 ? fmt(l.credit) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t font-semibold">
                  <tr>
                    <td className="td" colSpan={2}>الإجمالي</td>
                    <td className="td text-red-600">
                      {fmt(detail.lines?.reduce((s, l) => s + (l.debit ?? 0), 0) ?? 0)}
                    </td>
                    <td className="td text-green-700">
                      {fmt(detail.lines?.reduce((s, l) => s + (l.credit ?? 0), 0) ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New Entry Modal */}
      <Modal open={openNew} onClose={() => setOpenNew(false)} title="قيد يومية يدوي" size="lg">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="label">التاريخ *</label>
            <input className="input" type="date" value={newEntry.entry_date}
              onChange={e => setNewEntry(p => ({ ...p, entry_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">البيان *</label>
            <input className="input" value={newEntry.description}
              onChange={e => setNewEntry(p => ({ ...p, description: e.target.value }))}
              placeholder="قيد افتتاحي / تسوية..." />
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden mb-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="th">الحساب</th>
                <th className="th">مدين</th>
                <th className="th">دائن</th>
                <th className="th">بيان</th>
                <th className="th w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b">
                  <td className="td">
                    <select
                      className="input text-xs py-1"
                      value={l.account_code}
                      onChange={e => updateLine(i, { account_code: e.target.value })}
                    >
                      <option value="">— اختر —</option>
                      {accountList.map(a => (
                        <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="td">
                    <input className="input text-xs py-1 w-24" type="number" value={l.debit}
                      onChange={e => updateLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                  </td>
                  <td className="td">
                    <input className="input text-xs py-1 w-24" type="number" value={l.credit}
                      onChange={e => updateLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                  </td>
                  <td className="td">
                    <input className="input text-xs py-1" value={l.description}
                      onChange={e => updateLine(i, { description: e.target.value })} />
                  </td>
                  <td className="td">
                    {lines.length > 2 && (
                      <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td className="td font-semibold">الإجمالي</td>
                <td className={`td font-bold ${isBalanced ? 'text-green-700' : 'text-red-600'}`}>
                  {fmt(totalDebit)}
                </td>
                <td className={`td font-bold ${isBalanced ? 'text-green-700' : 'text-red-600'}`}>
                  {fmt(totalCredit)}
                </td>
                <td className="td" colSpan={2}>
                  {isBalanced
                    ? <span className="badge badge-green text-xs">متوازن ✓</span>
                    : <span className="badge badge-red text-xs">غير متوازن</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <button className="btn btn-ghost text-sm w-full border-dashed" onClick={addLine}>
          <Plus size={14} /> إضافة سطر
        </button>

        <div className="flex justify-end gap-3 mt-4">
          <button className="btn btn-ghost" onClick={() => setOpenNew(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => createEntry.mutate()}
            disabled={createEntry.isPending || !newEntry.entry_date || !newEntry.description || !isBalanced}
          >
            {createEntry.isPending ? 'جاري الحفظ...' : 'ترحيل القيد'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
