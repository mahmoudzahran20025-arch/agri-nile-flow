import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Phone, Calendar, DollarSign, ToggleLeft, ToggleRight } from 'lucide-react'
import { employeesApi } from '../../api/client'
import Modal from '../../components/ui/Modal'

interface Employee {
  id: number; name: string; national_id?: string; role_title?: string
  phone?: string; hire_date?: string; daily_wage: number; is_active: number; notes?: string
}

interface EmpForm {
  name: string; national_id: string; role_title: string; phone: string
  hire_date: string; daily_wage: string; notes: string
}

const EMPTY: EmpForm = { name: '', national_id: '', role_title: '', phone: '', hire_date: '', daily_wage: '', notes: '' }

const ROLES = ['مهندس زراعي','مشرف','عامل','سائق','حارس','محاسب','مدير مزرعة','أخرى']

export default function EmployeesPage() {
  const qc = useQueryClient()
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm]     = useState<EmpForm>(EMPTY)
  const [err, setErr]       = useState('')

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees', search],
    queryFn:  () => employeesApi.list(search || undefined),
  })

  const create = useMutation({
    mutationFn: () => employeesApi.create({
      name:        form.name.trim(),
      national_id: form.national_id || undefined,
      role_title:  form.role_title || undefined,
      phone:       form.phone || undefined,
      hire_date:   form.hire_date || undefined,
      daily_wage:  form.daily_wage ? Number(form.daily_wage) : 0,
      notes:       form.notes || undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr(res.error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['employees'] })
      setOpen(false); setForm(EMPTY); setErr('')
    },
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, val }: { id: number; val: number }) =>
      employeesApi.update(id, { is_active: val }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  })

  const sf = (f: Partial<EmpForm>) => setForm(p => ({ ...p, ...f }))
  const list = employees as Employee[]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={24} className="text-brand-600" />
          <h1 className="text-xl font-bold text-gray-900">الموظفون والعمال</h1>
          <span className="badge badge-blue">{list.filter(e => e.is_active).length} نشط</span>
        </div>
        <button className="btn btn-primary" onClick={() => { setOpen(true); setForm(EMPTY); setErr('') }}>
          <Plus size={16} /> إضافة موظف
        </button>
      </div>

      <input
        className="input max-w-sm"
        placeholder="بحث بالاسم أو الوظيفة..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {isLoading ? (
        <p className="text-center text-gray-500 py-10">جاري التحميل...</p>
      ) : list.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p>لا يوجد موظفون مسجلون</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="th">الاسم</th>
                <th className="th">الوظيفة</th>
                <th className="th">رقم قومي</th>
                <th className="th">الهاتف</th>
                <th className="th">تاريخ التعيين</th>
                <th className="th">الأجر اليومي</th>
                <th className="th">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {list.map(e => (
                <tr key={e.id} className={`border-b hover:bg-gray-50 transition-colors ${!e.is_active ? 'opacity-50' : ''}`}>
                  <td className="td font-medium">{e.name}</td>
                  <td className="td">
                    {e.role_title
                      ? <span className="badge badge-blue">{e.role_title}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="td font-mono text-xs text-gray-500">{e.national_id ?? '—'}</td>
                  <td className="td">
                    {e.phone
                      ? <span className="flex items-center gap-1"><Phone size={12} />{e.phone}</span>
                      : '—'}
                  </td>
                  <td className="td">
                    {e.hire_date
                      ? <span className="flex items-center gap-1"><Calendar size={12}/>{e.hire_date}</span>
                      : '—'}
                  </td>
                  <td className="td">
                    <span className="flex items-center gap-1">
                      <DollarSign size={12} />
                      {Number(e.daily_wage).toLocaleString('ar-EG')} ج
                    </span>
                  </td>
                  <td className="td">
                    <button
                      onClick={() => toggleActive.mutate({ id: e.id, val: e.is_active ? 0 : 1 })}
                      className="text-gray-500 hover:text-brand-600 transition-colors"
                    >
                      {e.is_active
                        ? <ToggleRight size={22} className="text-green-500" />
                        : <ToggleLeft  size={22} className="text-gray-400" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="إضافة موظف جديد" size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">الاسم الكامل *</label>
            <input className="input" value={form.name} onChange={e => sf({ name: e.target.value })} placeholder="محمد أحمد علي" />
          </div>
          <div>
            <label className="label">الرقم القومي</label>
            <input className="input" value={form.national_id} onChange={e => sf({ national_id: e.target.value })} placeholder="3XXXXXXXXXXXX" />
          </div>
          <div>
            <label className="label">الوظيفة</label>
            <select className="input" value={form.role_title} onChange={e => sf({ role_title: e.target.value })}>
              <option value="">— اختر —</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">رقم الهاتف</label>
            <input className="input" type="tel" value={form.phone} onChange={e => sf({ phone: e.target.value })} />
          </div>
          <div>
            <label className="label">تاريخ التعيين</label>
            <input className="input" type="date" value={form.hire_date} onChange={e => sf({ hire_date: e.target.value })} />
          </div>
          <div>
            <label className="label">الأجر اليومي (جنيه)</label>
            <input className="input" type="number" value={form.daily_wage} onChange={e => sf({ daily_wage: e.target.value })} placeholder="200" />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={form.notes} onChange={e => sf({ notes: e.target.value })} />
          </div>
        </div>

        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.name}
          >
            {create.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
