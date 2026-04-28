  import { useState, useMemo } from 'react'
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
  import { useNavigate, Link } from 'react-router-dom'
  import { BookOpen, Plus, Settings, Eye, List, GitBranch, ChevronRight, ChevronDown, Shield, Info, Pencil, PowerOff, Power, Lock } from 'lucide-react'
  import { glApi } from '../../api/client'
  import { useToast } from '../../contexts/ToastContext'

    is_header: number; is_active: number
  }

  interface AccountUsageMeta {
    account_code: string
    usage_count: number
    last_used_date: string | null
    is_locked: number
  }

  const TYPE_AR: Record<string, string> = {
    asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية',
    revenue: 'إيرادات', expense: 'مصروفات',
  }
  const TYPE_BADGE: Record<string, string> = {
    asset: 'badge-blue', liability: 'badge-red', equity: 'badge-amber',
    revenue: 'badge-green', expense: 'badge-yellow',
  }
  const TYPE_COLOR: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    asset:     { bg: 'bg-blue-50',   text: 'text-blue-800',   border: 'border-blue-200',   dot: 'bg-blue-400' },
    liability: { bg: 'bg-red-50',    text: 'text-red-800',    border: 'border-red-200',    dot: 'bg-red-400' },
    equity:    { bg: 'bg-amber-50',  text: 'text-amber-800',  border: 'border-amber-200',  dot: 'bg-amber-400' },
    revenue:   { bg: 'bg-emerald-50',text: 'text-emerald-800',border: 'border-emerald-200',dot: 'bg-emerald-400' },
    expense:   { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-400' },
  }
  // Mapping keys sourced from central schema — do not redefine here.

  // ── Build tree from flat list ────────────────────────────────
  interface AccountNode extends Account { children: AccountNode[] }

  function buildTree(accounts: Account[]): AccountNode[] {
    const map: Record<string, AccountNode> = {}
    const roots: AccountNode[] = []
    for (const a of accounts) map[a.code] = { ...a, children: [] }
    for (const a of accounts) {
      if (a.parent_code && map[a.parent_code]) {
        map[a.parent_code].children.push(map[a.code])
      } else {
        roots.push(map[a.code])
      }
    }
    return roots
  }

  // ── Tree Node component ──────────────────────────────────────
  function AccountTreeNode({
    node, navigate, usageMap, depth = 0,
  }: { node: AccountNode; navigate: (p: string) => void; usageMap: Record<string, AccountUsageMeta>; depth?: number }) {
    const [open, setOpen] = useState(depth < 2)
    const colors = TYPE_COLOR[node.account_type] ?? TYPE_COLOR.expense
    const hasChildren = node.children.length > 0
    const usage = usageMap[node.code]
    const usageCount = Number(usage?.usage_count ?? 0)
    const isLocked = Number(usage?.is_locked ?? 0) === 1

    return (
      <div className="select-none">
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded-lg group cursor-pointer
            hover:bg-gray-50 transition-colors`}
          style={{ paddingRight: `${8 + depth * 20}px` }}
          onClick={() => hasChildren ? setOpen(o => !o) : navigate(`/gl/ledger/${node.code}`)}
        >
          {/* Toggle icon */}
          <span className="w-4 shrink-0 text-gray-400">
            {hasChildren
              ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
              : <span className="inline-block w-3 h-px bg-gray-200 mr-1" />}
          </span>

          {/* Type dot */}
          <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />

          {/* Code */}
          <span className="font-mono text-xs text-gray-400 w-14 shrink-0">{node.code}</span>

          {/* Name */}
          <span className={`text-sm flex-1 ${node.is_header ? 'font-semibold text-gray-800' : 'text-gray-700'} ${node.is_active === 0 ? 'line-through opacity-50' : ''}`}>
            {node.name}
          </span>
          {/* Inactive badge */}
          {node.is_active === 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 border border-gray-200 shrink-0">موقوف</span>
          )}

          {isLocked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 shrink-0 inline-flex items-center gap-1">
              <Lock size={10} /> مقفل
            </span>
          )}

          {usageCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 shrink-0">
              استخدام: {usageCount}
            </span>
          )}

          {/* Type badge — only on headers */}
          {node.is_header && (
            <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0
              ${colors.bg} ${colors.text} ${colors.border}`}>
              {TYPE_AR[node.account_type] ?? node.account_type}
            </span>
          )}

          {/* Child count */}
          {hasChildren && (
            <span className="text-xs text-gray-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {node.children.length}
            </span>
          )}

          {/* Ledger link — leaf accounts */}
          {!node.is_header && (
            <button
              onClick={e => { e.stopPropagation(); navigate(`/gl/ledger/${node.code}`) }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded text-brand-600 hover:bg-brand-50 transition-all shrink-0"
              title="دفتر الأستاذ"
            >
              <Eye size={13} />
            </button>
          )}
        </div>

        {/* Children */}
        {hasChildren && open && (
          <div className={`mr-2 border-r-2 ${colors.border}`}>
            {node.children.map(child => (
              <AccountTreeNode key={child.code} node={child} navigate={navigate} usageMap={usageMap} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  export default function ChartOfAccountsPage() {
    const { canRead, canWrite } = usePermission()
    const navigate = useNavigate()
    const qc = useQueryClient()
    const { toast } = useToast()
    const [filter, setFilter]       = useState('')
    const [typeFilter, setTypeFilter] = useState<string>('all')
    const [lockedOnly, setLockedOnly] = useState(false)
    const [viewMode, setViewMode]     = useState<'table' | 'tree'>('tree')
    const [openAdd, setOpenAdd]       = useState(false)

    const [form, setForm] = useState({
      code: '', name: '', account_type: 'expense', parent_code: '', notes: '',
    })

    // ── Edit state ──────────────────────────────────────────────
    const [openEdit, setOpenEdit]   = useState(false)
    const [editTarget, setEditTarget] = useState<Account | null>(null)
    const [editForm, setEditForm]   = useState({ name: '', parent_code: '', notes: '' })

    function openEditModal(a: Account) {
      setEditTarget(a)
      setEditForm({ name: a.name, parent_code: a.parent_code ?? '', notes: '' })
      setOpenEdit(true)
    }


    const { data: accounts = [], isLoading } = useQuery({
      queryKey: ['gl-accounts'],
      queryFn:  () => glApi.accounts(),
    })
    const { data: usageMetadata = [] } = useQuery({
      queryKey: ['gl-accounts-usage-metadata'],
      queryFn: () => glApi.accountUsageMetadata(),
    })

    const list = accounts as Account[]
    const usageMap = useMemo(() => {
      const map: Record<string, AccountUsageMeta> = {}
      for (const row of usageMetadata as AccountUsageMeta[]) {
        map[row.account_code] = row
      }
      return map
    }, [usageMetadata])
    const lockedAccountsCount = useMemo(
      () => list.filter(a => Number(usageMap[a.code]?.is_locked ?? 0) === 1).length,
      [list, usageMap],
    )
    const filtered = useMemo(() => list.filter(a => {
      const matchText = !filter || a.code.includes(filter) || a.name.includes(filter)
      const matchType = typeFilter === 'all' || a.account_type === typeFilter
      const matchLocked = !lockedOnly || Number(usageMap[a.code]?.is_locked ?? 0) === 1
      return matchText && matchType && matchLocked
    }), [list, filter, typeFilter, lockedOnly, usageMap])

    const tree = useMemo(() => buildTree(filtered.length < list.length ? filtered : list), [list, filtered, filter, typeFilter])


    const editAcc = useMutation({
      mutationFn: () => glApi.updateAccount(editTarget!.code, {
        name:        editForm.name || undefined,
        parent_code: editForm.parent_code || null,
        notes:       editForm.notes || undefined,
      }),
      onSuccess: (res: { success: boolean; error?: string }) => {
        if (!res.success) { toast(res.error ?? 'خطأ', 'error'); return }
        qc.invalidateQueries({ queryKey: ['gl-accounts'] })
        toast('تم تحديث الحساب', 'success')
        setOpenEdit(false)
      },
    })

    const toggleActive = useMutation({
      mutationFn: (acc: Account) => glApi.updateAccount(acc.code, { is_active: acc.is_active === 1 ? 0 : 1 }),
      onSuccess: (res: { success: boolean; error?: string }) => {
        if (!res.success) { toast(res.error ?? 'خطأ', 'error'); return }
        qc.invalidateQueries({ queryKey: ['gl-accounts'] })
        toast('تم تحديث حالة الحساب', 'success')
      },
    })

    const createAcc = useMutation({
      mutationFn: () => glApi.createAccount(form),
      onSuccess: (res: { success: boolean; error?: string }) => {
        if (!res.success) { toast(res.error ?? 'خطأ', 'error'); return }
        qc.invalidateQueries({ queryKey: ['gl-accounts'] })
        toast('تم إضافة الحساب', 'success')
        setOpenAdd(false)
        setForm({ code: '', name: '', account_type: 'expense', parent_code: '', notes: '' })
      },
    })

    const leafAccounts = list.filter(a => !a.is_header)

    return (
      <div className="p-6 space-y-6">
        {/* Permission Guard */}
        {!canRead('gl') && (
          <div className="flex flex-col items-center justify-center h-full p-20 text-center">
            <Shield size={48} className="text-slate-300 mb-4" />
            <h2 className="text-xl font-bold text-slate-800">غير مصرح لك بالوصول</h2>
            <p className="text-slate-500">تحتاج لصلاحية 'gl.read' لعرض شجرة الحسابات.</p>
          </div>
        )}
        {canRead('gl') && (<>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen size={24} className="text-brand-600" />
            <h1 className="text-xl font-bold text-gray-900">شجرة الحسابات</h1>
            <span className="badge badge-blue">{list.length} حساب</span>
            <span className="badge badge-amber">{lockedAccountsCount} حساب مقفل بالحركة</span>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-1">
              <button
                onClick={() => setViewMode('tree')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'tree' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <GitBranch size={14} /> شجرة
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'table' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <List size={14} /> جدول
              </button>
            </div>

            {canWrite('gl') && (
              <button className="btn btn-primary" onClick={() => setOpenAdd(true)}>
                <Plus size={16} /> حساب جديد
              </button>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap gap-4 text-sm">
          {Object.entries(TYPE_AR).map(([k, label]) => {
            const count = list.filter(a => a.account_type === k).length
            const c = TYPE_COLOR[k]
            return (
              <button
                key={k}
                onClick={() => setTypeFilter(prev => prev === k ? 'all' : k)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all
                  ${ typeFilter === k
                    ? `${c.bg} ${c.text} ${c.border} ring-2 ring-offset-1 ${c.border.replace('border-','ring-')}`
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
              >
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                {label}
                <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${ typeFilter === k ? 'bg-white/60' : 'bg-gray-100'}`}>
                  {count}
                </span>
              </button>
            )
          })}
          {typeFilter !== 'all' && (
            <button
              onClick={() => setTypeFilter('all')}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              عرض الكل
            </button>
          )}
        </div>

        {/* Search + result count */}
        <div className="flex items-center gap-3">
          <input
            className="input max-w-sm"
            placeholder="بحث بالكود أو الاسم..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {(filter || typeFilter !== 'all') && (
            <span className="text-sm text-gray-500">
              {filtered.length} من {list.length} حساب
            </span>
          )}
          <button
            onClick={() => setLockedOnly(prev => !prev)}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${lockedOnly ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
            title="إظهار الحسابات المقفلة بالحركة فقط"
          >
            <span className="inline-flex items-center gap-1"><Lock size={12} /> المقفلة فقط</span>
          </button>
          {(filter || typeFilter !== 'all') && (
            <button
              onClick={() => { setFilter(''); setTypeFilter('all'); setLockedOnly(false) }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              مسح الفلاتر
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="text-center text-gray-500 py-10">جاري التحميل...</p>
        ) : viewMode === 'tree' ? (
          /* ── Tree View ── */
          <div className="card p-4 space-y-1">
            {/* Legend */}
            <div className="flex flex-wrap gap-3 pb-3 border-b mb-3">
              {Object.entries(TYPE_AR).map(([k, label]) => {
                const c = TYPE_COLOR[k]
                return (
                  <span key={k} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border
                    ${c.bg} ${c.text} ${c.border}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                    {label}
                  </span>
                )
              })}
            </div>
            {tree.length === 0 && <p className="text-center text-gray-400 py-8">لا توجد نتائج</p>}
            {tree.map(node => (
              <AccountTreeNode key={node.code} node={node} navigate={navigate} usageMap={usageMap} depth={0} />
            ))}
          </div>
        ) : (
          /* ── Table View ── */
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="th">الكود</th>
                  <th className="th">اسم الحساب</th>
                  <th className="th">النوع</th>
                  <th className="th">الرصيد الطبيعي</th>
                  <th className="th">المستوى</th>
                  <th className="th">تكرار الاستخدام</th>
                  <th className="th">آخر استخدام</th>
                  <th className="th">الحالة</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const usage = usageMap[a.code]
                  const usageCount = Number(usage?.usage_count ?? 0)
                  const isLocked = Number(usage?.is_locked ?? 0) === 1
                  return (
                  <tr
                    key={a.code}
                    className={`border-b transition-colors ${
                      a.is_header ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'
                    } ${!a.is_active ? 'opacity-40' : ''}`}
                  >
                    <td className="td">
                      <span className="font-mono text-brand-700"
                        style={{ paddingRight: `${(a.level - 1) * 16}px` }}>
                        {a.code}
                      </span>
                    </td>
                    <td className="td">
                      <span style={{ paddingRight: `${(a.level - 1) * 16}px` }}>
                        {a.is_header ? '▸ ' : ''}{a.name}
                      </span>
                    </td>
                    <td className="td">
                      <span className={`badge ${TYPE_BADGE[a.account_type] ?? 'badge-slate'}`}>
                        {TYPE_AR[a.account_type] ?? a.account_type}
                      </span>
                    </td>
                    <td className="td text-xs text-gray-500">
                      {a.normal_balance === 'debit' ? 'مدين' : 'دائن'}
                    </td>
                    <td className="td text-center text-gray-500">{a.level}</td>
                    <td className="td text-center text-xs text-slate-600">{usageCount}</td>
                    <td className="td text-xs text-slate-500">{usage?.last_used_date ?? '—'}</td>
                    <td className="td">
                      {isLocked ? <span className="badge badge-amber inline-flex items-center gap-1"><Lock size={12} /> مقفل</span> : a.is_header
                        ? <span className="badge badge-slate">مجموعة</span>
                        : <span className="badge badge-green">حساب فرعي</span>}
                    </td>
                    <td className="td text-left">
                      <div className="flex items-center gap-1 justify-end">
                        {!a.is_header && (
                          <button
                            onClick={() => navigate(`/gl/ledger/${a.code}`)}
                            className="p-1.5 rounded-lg text-brand-600 hover:bg-brand-50 transition-colors"
                            title="دفتر الأستاذ"
                          >
                            <Eye size={15} />
                          </button>
                        )}
                        {canWrite('gl') && (
                          <button
                            onClick={() => openEditModal(a)}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                            title="تعديل"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canWrite('gl') && !a.is_header && (
                          <button
                            onClick={() => toggleActive.mutate(a)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              a.is_active === 1
                                ? 'text-amber-400 hover:bg-amber-50 hover:text-amber-600'
                                : 'text-emerald-500 hover:bg-emerald-50'
                            }`}
                            title={isLocked && a.is_active === 1 ? 'لا يمكن تعطيل حساب له حركة' : (a.is_active === 1 ? 'تعطيل الحساب' : 'تفعيل الحساب')}
                            disabled={toggleActive.isPending || (isLocked && a.is_active === 1)}
                          >
                            {a.is_active === 1 ? <PowerOff size={14} /> : <Power size={14} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}

        {/* Edit Account Modal */}
        <Modal open={openEdit} onClose={() => setOpenEdit(false)} title={`تعديل: ${editTarget?.name}`} size="md">
          <div className="space-y-4">
            <div>
              <label className="label">اسم الحساب *</label>
              <input className="input" value={editForm.name}
                onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">الحساب الأب (كود)</label>
              <input className="input font-mono" value={editForm.parent_code}
                onChange={e => setEditForm(p => ({ ...p, parent_code: e.target.value }))}
                placeholder="اتركه فارغاً للحسابات الرئيسية" />
              <p className="text-[11px] text-slate-400 mt-1">كود الحساب: <span className="font-mono font-bold">{editTarget?.code}</span></p>
            </div>
            <div>
              <label className="label">ملاحظات</label>
              <input className="input" value={editForm.notes}
                onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button className="btn btn-ghost" onClick={() => setOpenEdit(false)}>إلغاء</button>
            <button
              className="btn btn-primary"
              onClick={() => editAcc.mutate()}
              disabled={editAcc.isPending || !editForm.name}
            >
              {editAcc.isPending ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
          </div>
        </Modal>

        {/* Add Account Modal */}
        <Modal open={openAdd} onClose={() => setOpenAdd(false)} title="إضافة حساب جديد" size="md">
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              <Info size={14} className="inline ml-1" />
              تأكد من اتباع هيكلية الأرقام (مثلاً: 1 للأصول، 2 للخصوم). الحساب الأب يجب أن يكون موجوداً ومعرفاً كـ "مجموعة".
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">كود الحساب *</label>
                <input className="input font-mono" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder="5430" />
              </div>
              <div>
                <label className="label">نوع الحساب *</label>
                <select className="input" value={form.account_type} onChange={e => setForm(p => ({ ...p, account_type: e.target.value }))}>
                  <option value="asset">أصول</option>
                  <option value="liability">خصوم</option>
                  <option value="equity">حقوق ملكية</option>
                  <option value="revenue">إيرادات</option>
                  <option value="expense">مصروفات</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">اسم الحساب *</label>
                <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="مصروفات وقود" />
              </div>
              <div>
                <label className="label">الحساب الأب (كود)</label>
                <input className="input font-mono" value={form.parent_code} onChange={e => setForm(p => ({ ...p, parent_code: e.target.value }))} placeholder="5400" />
                <p className="text-[10px] text-slate-400 mt-1">اتركه فارغاً للحسابات الرئيسية.</p>
              </div>
              <div>
                <label className="label">ملاحظات</label>
                <input className="input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button className="btn btn-ghost" onClick={() => setOpenAdd(false)}>إلغاء</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (form.parent_code && !list.find(a => a.code === form.parent_code)) {
                  toast('كود الأب غير موجود في الشجرة', 'error')
                  return
                }
                createAcc.mutate()
              }}
              disabled={createAcc.isPending || !form.code || !form.name}
            >
              {createAcc.isPending ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </div>
        </Modal>

        </>)}
      </div>
    )
  }
