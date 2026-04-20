import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Plus, Settings } from 'lucide-react'
import { glApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import Modal from '../../components/ui/Modal'

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
const MAPPING_KEYS = [
  { key: 'cash',             label: 'الخزينة والبنوك' },
  { key: 'accounts_payable', label: 'الذمم الدائنة (موردون)' },
  { key: 'inventory',        label: 'المخزون' },
  { key: 'revenue_default',  label: 'الإيراد الافتراضي' },
  { key: 'expense_default',  label: 'المصروف الافتراضي' },
]

export default function ChartOfAccountsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [filter, setFilter] = useState('')
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
          <button className="btn btn-ghost" onClick={openMappingModal}>
            <Settings size={16} /> إعدادات الربط
          </button>
          <button className="btn btn-primary" onClick={() => setOpenAdd(true)}>
            <Plus size={16} /> حساب جديد
          </button>
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
      ) : (
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
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr
                  key={a.code}
                  className={`border-b transition-colors ${
                    a.is_header
                      ? 'bg-gray-50 font-semibold'
                      : 'hover:bg-gray-50'
                  } ${!a.is_active ? 'opacity-40' : ''}`}
                >
                  <td className="td">
                    <span
                      className="font-mono text-brand-700"
                      style={{ paddingRight: `${(a.level - 1) * 16}px` }}
                    >
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
