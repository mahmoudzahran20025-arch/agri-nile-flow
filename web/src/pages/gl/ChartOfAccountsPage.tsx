import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Plus, Settings, Eye, List, GitBranch, ChevronRight, ChevronDown } from 'lucide-react'
import { glApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import Modal from '../../components/ui/Modal'
import { usePermission } from '../../hooks/usePermission'

interface Account {
  id: number; code: string; name: string; account_type: string
  normal_balance: string; parent_code?: string; level: number
  is_header: number; is_active: number
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
const MAPPING_KEYS = [
  { key: 'cash',             label: 'الخزينة والبنوك' },
  { key: 'accounts_payable', label: 'الذمم الدائنة (موردون)' },
  { key: 'inventory',        label: 'المخزون' },
  { key: 'revenue_default',  label: 'الإيراد الافتراضي' },
  { key: 'expense_default',  label: 'المصروف الافتراضي' },
]

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
  node, navigate, depth = 0,
}: { node: AccountNode; navigate: (p: string) => void; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)
  const colors = TYPE_COLOR[node.account_type] ?? TYPE_COLOR.expense
  const hasChildren = node.children.length > 0

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
        <span className={`text-sm flex-1 ${node.is_header ? 'font-semibold text-gray-800' : 'text-gray-700'}`}>
          {node.name}
        </span>

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
            <AccountTreeNode key={child.code} node={child} navigate={navigate} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChartOfAccountsPage() {
  const { canWrite } = usePermission()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [filter, setFilter]     = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('tree')
  const [openAdd, setOpenAdd]       = useState(false)
  const [openMapping, setOpenMapping] = useState(false)

  const [form, setForm] = useState({
    code: '', name: '', account_type: 'expense', parent_code: '', notes: '',
  })

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn:  () => glApi.accounts(),
  })
  const { data: mappings = [] } = useQuery({
    queryKey: ['gl-mappings'],
    queryFn:  glApi.mappings,
  })

  const [mappingForm, setMappingForm] = useState<Record<string,string>>({})

  const list = accounts as Account[]
  const filtered = filter
    ? list.filter(a => a.code.includes(filter) || a.name.includes(filter))
    : list

  const tree = useMemo(() => buildTree(filter ? filtered : list), [list, filtered, filter])

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

  const saveMappings = useMutation({
    mutationFn: () => glApi.saveMappings(
      MAPPING_KEYS.map(m => ({ mapping_key: m.key, account_code: mappingForm[m.key] ?? '' }))
        .filter(m => m.account_code)
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-mappings'] })
      toast('تم حفظ إعدادات الربط', 'success')
      setOpenMapping(false)
    },
  })

  function openMappingModal() {
    const current: Record<string,string> = {}
    for (const m of mappings as { mapping_key: string; account_code: string }[]) {
      current[m.mapping_key] = m.account_code
    }
    setMappingForm(current)
    setOpenMapping(true)
  }

  const accountCodes = list.filter(a => !a.is_header).map(a => a.code)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen size={24} className="text-brand-600" />
          <h1 className="text-xl font-bold text-gray-900">شجرة الحسابات</h1>
          <span className="badge badge-blue">{list.length} حساب</span>
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
            <button className="btn btn-ghost" onClick={openMappingModal}>
              <Settings size={16} /> إعدادات الربط
            </button>
          )}
          {canWrite('gl') && (
            <button className="btn btn-primary" onClick={() => setOpenAdd(true)}>
              <Plus size={16} /> حساب جديد
            </button>
          )}
        </div>
      </div>

      <input
        className="input max-w-sm"
        placeholder="بحث بالكود أو الاسم..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />

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
            <AccountTreeNode key={node.code} node={node} navigate={navigate} depth={0} />
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
                <th className="th">الحالة</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
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
                  <td className="td">
                    {a.is_header
                      ? <span className="badge badge-slate">مجموعة</span>
                      : <span className="badge badge-green">حساب فرعي</span>}
                  </td>
                  <td className="td text-left">
                    {!a.is_header && (
                      <button
                        onClick={() => navigate(`/gl/ledger/${a.code}`)}
                        className="p-1.5 rounded-lg text-brand-600 hover:bg-brand-50 transition-colors"
                        title="دفتر الأستاذ"
                      >
                        <Eye size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Account Modal */}
      <Modal open={openAdd} onClose={() => setOpenAdd(false)} title="إضافة حساب جديد" size="md">
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
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOpenAdd(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => createAcc.mutate()}
            disabled={createAcc.isPending || !form.code || !form.name}
          >
            {createAcc.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </Modal>

      {/* Mappings Modal */}
      <Modal open={openMapping} onClose={() => setOpenMapping(false)} title="إعدادات ربط الحسابات الافتراضية" size="md">
        <p className="text-sm text-gray-500 mb-4">
          هذه الحسابات تُستخدم لتوليد القيود تلقائياً عند إنشاء الحركات.
        </p>
        <div className="space-y-3">
          {MAPPING_KEYS.map(m => (
            <div key={m.key} className="flex items-center gap-3">
              <label className="text-sm font-medium w-48 flex-shrink-0">{m.label}</label>
              <select
                className="input flex-1"
                value={mappingForm[m.key] ?? ''}
                onChange={e => setMappingForm(p => ({ ...p, [m.key]: e.target.value }))}
              >
                <option value="">— اختر حساباً —</option>
                {accountCodes.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOpenMapping(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => saveMappings.mutate()}
            disabled={saveMappings.isPending}
          >
            {saveMappings.isPending ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
