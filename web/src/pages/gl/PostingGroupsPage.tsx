/**
 * PostingGroupsPage — Admin UI for managing Business / Product / Inventory posting groups.
 * Uses tabs for the three group types. Empty state shown when no groups exist yet.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { glApi, PostingGroup, PgType } from '../../api/gl'
import Modal from '../../components/ui/Modal'

// ─── helpers ────────────────────────────────────────────────────────────────
const TABS: { key: PgType; label: string; ar: string }[] = [
  { key: 'business',  label: 'Business Posting Groups',  ar: 'مجموعات ترحيل العمل' },
  { key: 'product',   label: 'Product Posting Groups',   ar: 'مجموعات ترحيل المنتج' },
  { key: 'inventory', label: 'Inventory Posting Groups', ar: 'مجموعات ترحيل المخزون' },
]

// ─── Add modal ──────────────────────────────────────────────────────────────
function AddGroupModal({ type, open, onClose }: { type: PgType; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [code, setCode]     = useState('')
  const [name, setName]     = useState('')
  const [desc, setDesc]     = useState('')
  const [err, setErr]       = useState('')

  const mut = useMutation({
    mutationFn: () => glApi.createPostingGroup(type, { code: code.toUpperCase(), name, description: desc || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posting-groups', type] })
      setCode(''); setName(''); setDesc(''); setErr('')
      onClose()
    },
    onError: async (e: unknown) => {
      const msg = (e as { message?: string })?.message ?? 'حدث خطأ'
      setErr(msg)
    },
  })

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    setErr('')
    if (!code.trim() || !name.trim()) { setErr('Code and name are required'); return }
    if (!/^[A-Z0-9_-]{1,20}$/i.test(code)) { setErr('Code: 1–20 letters, digits, underscores or dashes'); return }
    mut.mutate()
  }

  return (
    <Modal open={open} title="إضافة مجموعة ترحيل جديدة" onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">الكود <span className="text-red-500">*</span></label>
          <input className="input uppercase" placeholder="e.g. DOMESTIC" value={code}
            onChange={e => setCode(e.target.value.toUpperCase())} maxLength={20} />
          <p className="text-xs text-slate-400 mt-1">حروف كبيرة، أرقام، شرطة أو underscore — 20 حرف كحد أقصى</p>
        </div>
        <div>
          <label className="label">الاسم <span className="text-red-500">*</span></label>
          <input className="input" placeholder="e.g. محلي - عملاء داخليين" value={name}
            onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">الوصف (اختياري)</label>
          <input className="input" placeholder="وصف مختصر..." value={desc}
            onChange={e => setDesc(e.target.value)} />
        </div>
        {err && <p className="text-sm text-red-500 bg-red-50 p-2 rounded">{err}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            {mut.isPending ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Edit modal ──────────────────────────────────────────────────────────────
function EditGroupModal({ type, group, open, onClose }: { type: PgType; group: PostingGroup; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(group.name)
  const [desc, setDesc] = useState(group.description ?? '')
  const [active, setActive] = useState(group.is_active === 1)
  const [err, setErr]   = useState('')

  const mut = useMutation({
    mutationFn: () => glApi.updatePostingGroup(type, group.code, { name, description: desc || undefined, is_active: active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['posting-groups', type] }); onClose() },
    onError: async (e: unknown) => setErr((e as { message?: string })?.message ?? 'حدث خطأ'),
  })

  return (
    <Modal open={open} title={`تعديل: ${group.code}`} onClose={onClose} size="sm">
      <form onSubmit={e => { e.preventDefault(); setErr(''); mut.mutate() }} className="space-y-4">
        <div>
          <label className="label">الاسم</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">الوصف</label>
          <input className="input" value={desc} onChange={e => setDesc(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pg-active" checked={active} onChange={e => setActive(e.target.checked)} />
          <label htmlFor="pg-active" className="text-sm">نشط</label>
        </div>
        {!active && group.is_active === 1 && (
          <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
            ⚠️ تأكد أن هذه المجموعة غير مستخدمة في إعدادات الترحيل قبل التعطيل.
          </p>
        )}
        {err && <p className="text-sm text-red-500 bg-red-50 p-2 rounded">{err}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            {mut.isPending ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Group list ──────────────────────────────────────────────────────────────
function GroupList({ type }: { type: PgType }) {
  // FIX: All hooks must be called before any early returns
  const [adding, setAdding]         = useState(false)
  const [editing, setEditing]       = useState<PostingGroup | null>(null)
  const [query, setQuery]           = useState('')
  
  const { data, isLoading, error } = useQuery({
    queryKey: ['posting-groups', type],
    queryFn:  () => glApi.postingGroups(type),
  })

  const groups = data ?? []
  const filteredGroups = useMemo(() => {
    if (!query.trim()) return groups
    return groups.filter(group => `${group.code} ${group.name} ${group.description ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  }, [groups, query])

  // Early returns AFTER all hooks
  if (isLoading) return <div className="py-16 text-center text-slate-400">جارٍ التحميل...</div>
  if (error)     return <div className="py-16 text-center text-red-500">فشل تحميل البيانات</div>

  function exportCsv() {
    const lines = [
      ['code', 'name', 'description', 'is_active'].join(','),
      ...filteredGroups.map(group => [group.code, group.name, group.description ?? '', String(group.is_active)].map(value => `"${String(value).split('"').join('""')}"`).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `posting-groups-${type}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">
          {filteredGroups.length === 0
            ? 'لا توجد مجموعات بعد — أضف مجموعة لتبدأ.'
            : `${filteredGroups.length} مجموعة`}
        </p>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm" onClick={exportCsv} disabled={filteredGroups.length === 0}>تصدير CSV</button>
          <button className="btn-primary text-sm" onClick={() => setAdding(true)}>
            + إضافة مجموعة
          </button>
        </div>
      </div>

      <input className="input max-w-md text-sm" placeholder="ابحث بالكود أو الاسم أو الوصف" value={query} onChange={event => setQuery(event.target.value)} />

      {filteredGroups.length === 0 ? (
        <div className="border-2 border-dashed border-slate-200 rounded-xl py-16 text-center">
          <p className="text-slate-400 text-lg mb-2">لا توجد مجموعات ترحيل</p>
          <p className="text-slate-400 text-sm mb-6">
            أضف مجموعة واحدة على الأقل، أو ابدأ بإعداد الترحيل دون مجموعات<br />
            (سيتم استخدام قاعدة الإعداد الافتراضية NULL/NULL)
          </p>
          <button className="btn-primary" onClick={() => setAdding(true)}>+ إضافة أول مجموعة</button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right">
                <th className="pb-2 font-medium text-slate-600 pr-0">الكود</th>
                <th className="pb-2 font-medium text-slate-600">الاسم</th>
                <th className="pb-2 font-medium text-slate-600">الوصف</th>
                <th className="pb-2 font-medium text-slate-600">الحالة</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredGroups.map(g => (
                <tr key={g.code} className="hover:bg-slate-50">
                  <td className="py-3 pr-0">
                    <span className="font-mono font-semibold text-slate-800">{g.code}</span>
                  </td>
                  <td className="py-3">{g.name}</td>
                  <td className="py-3 text-slate-400">{g.description ?? '—'}</td>
                  <td className="py-3">
                    {g.is_active === 1
                      ? <span className="badge-green">نشط</span>
                      : <span className="badge-slate">غير نشط</span>}
                  </td>
                  <td className="py-3 text-left">
                    <button className="text-xs text-blue-600 hover:underline" onClick={() => setEditing(g)}>
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddGroupModal type={type} open={adding}    onClose={() => setAdding(false)} />
      {editing && (
        <EditGroupModal type={type} group={editing} open={true} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function PostingGroupsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') ?? 'business') as PgType

  const setTab = (t: PgType) => setParams({ tab: t })
  const current = TABS.find(t => t.key === tab) ?? TABS[0]

  return (
    <div className="animate-fade-in space-y-6">
      <div className="page-header">
        <h1 className="page-title">مجموعات الترحيل</h1>
        <p className="text-slate-500 text-sm mt-1">
          إدارة مجموعات ترحيل الأعمال والمنتجات والمخزون — نمط Microsoft Dynamics
        </p>
        <div className="mt-3 flex gap-2">
          <Link to="/gl/setup-wizard" className="btn-secondary text-sm">معالج الإعداد</Link>
          <Link to="/gl/posting-setup/health" className="btn-secondary text-sm">لوحة الصحة</Link>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-6" aria-label="Posting Group Tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.ar}
            </button>
          ))}
        </nav>
      </div>

      {/* Description */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <strong>{current.label}:</strong>{' '}
        {tab === 'business'  && 'تُعيَّن للموردين والعملاء. تحدد حسابات المشتريات والمبيعات حسب نوع الجهة التجارية.'}
        {tab === 'product'   && 'تُعيَّن للأصناف والفئات. تحدد حسابات التكلفة والإيرادات حسب نوع المنتج.'}
        {tab === 'inventory' && 'تُعيَّن للمستودعات. تحدد حساب المخزون حسب موقع التخزين.'}
      </div>

      {/* List */}
      <div className="card p-6">
        <GroupList type={tab} />
      </div>
    </div>
  )
}
