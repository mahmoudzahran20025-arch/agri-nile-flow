import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, ToggleLeft, ToggleRight } from 'lucide-react'
import { usersApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import { usePermission } from '../../hooks/usePermission'
import { CommandBar } from '../../components/ui/CommandBar'

interface DbUser {
  id:         number
  email:      string
  full_name:  string
  phone:      string | null
  is_active:  number
  last_login: string | null
  role:       string
}

const ROLE_LABELS: Record<string, string> = {
  super_admin:      'مدير النظام',
  company_admin:    'مدير الشركة',
  accountant:       'محاسب',
  warehouse_mgr:    'مدير مخازن',
  field_supervisor: 'مشرف حقلي',
  viewer:           'مشاهدة فقط',
}

const ROLE_COLOR: Record<string, string> = {
  super_admin:      'badge-red',
  company_admin:    'badge-blue',
  accountant:       'badge-amber',
  warehouse_mgr:    'badge-green',
  field_supervisor: 'badge-blue',
  viewer:           'badge-slate',
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({
    email: '', full_name: '', password: '', phone: '', role: 'accountant',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.email || !form.full_name || !form.password) {
      setError('البريد والاسم وكلمة المرور مطلوبة')
      return
    }
    setSaving(true)
    try {
      const res = await usersApi.create(form)
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['users'] })
      setForm({ email: '', full_name: '', password: '', phone: '', role: 'accountant' })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="دعوة مستخدم جديد" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">الاسم الكامل <span className="text-red-500">*</span></label>
            <input className="input" value={form.full_name} onChange={e => set('full_name', e.target.value)} required />
          </div>
          <div>
            <label className="label">البريد الإلكتروني <span className="text-red-500">*</span></label>
            <input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">كلمة المرور <span className="text-red-500">*</span></label>
            <input type="password" className="input" placeholder="8 أحرف على الأقل"
              value={form.password} onChange={e => set('password', e.target.value)} required minLength={6} />
          </div>
          <div>
            <label className="label">رقم الهاتف</label>
            <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">الدور الوظيفي</label>
          <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'إضافة المستخدم'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function UsersPage() {
  const { canWrite } = usePermission()
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [toggling, setToggling] = useState<number | null>(null)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn:  () => usersApi.list() as Promise<DbUser[]>,
  })

  const toggleActive = async (user: DbUser) => {
    setToggling(user.id)
    try {
      await usersApi.update(user.id, { is_active: user.is_active ? 0 : 1 })
      await qc.invalidateQueries({ queryKey: ['users'] })
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <CommandBar
        title="إدارة المستخدمين"
        subtitle={`${users?.length ?? 0} مستخدم مسجل في هذه الشركة`}
        actions={canWrite('users') ? [{
          label: 'دعوة مستخدم',
          icon: <UserPlus size={15} />,
          variant: 'primary',
          onClick: () => setAddOpen(true),
        }] : []}
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center text-slate-400">جاري التحميل...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الاسم', 'البريد الإلكتروني', 'الدور', 'آخر دخول', 'الحالة', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(users ?? []).map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{u.full_name}</p>
                    {u.phone && <p className="text-xs text-slate-400">{u.phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={ROLE_COLOR[u.role] ?? 'badge-slate'}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {u.last_login
                      ? new Date(u.last_login).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : 'لم يسجل دخول بعد'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={u.is_active ? 'badge-green' : 'badge-slate'}>
                      {u.is_active ? 'نشط' : 'موقوف'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-left">
                    {canWrite('users') && (
                      <button
                        onClick={() => toggleActive(u)}
                        disabled={toggling === u.id}
                        title={u.is_active ? 'إيقاف المستخدم' : 'تفعيل المستخدم'}
                        className={`p-1.5 rounded-lg transition-colors ${
                          u.is_active
                            ? 'text-green-600 hover:bg-green-50'
                            : 'text-slate-400 hover:bg-slate-100'
                        }`}
                      >
                        {u.is_active
                          ? <ToggleRight size={20} />
                          : <ToggleLeft  size={20} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!(users ?? []).length && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-slate-400">
                    لا يوجد مستخدمون مسجلون
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} />
      </div>{/* end scroll container */}
    </div>
  )
}
