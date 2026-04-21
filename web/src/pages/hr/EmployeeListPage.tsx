import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Users, Plus, Search, ChevronRight, Briefcase, Building2 } from 'lucide-react'
import { api, unwrap } from '../../api/client'
import { hrApi } from '../../api/hr'
import Modal from '../../components/ui/Modal'

interface Employee {
  id: number; name: string; national_id?: string; role_title?: string
  phone?: string; hire_date?: string; daily_wage: number; is_active: number; notes?: string
}

export default function EmployeeListPage() {
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const [q, setQ]  = useState('')
  const [showAdd, setShowAdd]   = useState(false)
  const [form, setForm] = useState({ name: '', role_title: '', phone: '', hire_date: '', daily_wage: '' })

  const { data: empData, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => unwrap(api.get<Employee[]>('/employees')),
  })

  const { data: branchData } = useQuery({
    queryKey: ['hr-branches'],
    queryFn: () => hrApi.getBranches(),
  })

  const addMut = useMutation({
    mutationFn: (b: typeof form) =>
      unwrap(api.post<{id:number}>('/employees', { ...b, daily_wage: Number(b.daily_wage) || 0 })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      setShowAdd(false)
      setForm({ name: '', role_title: '', phone: '', hire_date: '', daily_wage: '' })
    },
  })

  const employees: Employee[] = empData ?? []
  const branches = branchData ?? []

  const filtered = employees.filter(e =>
    !q || e.name.includes(q) || e.role_title?.includes(q) || e.phone?.includes(q)
  )

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Users size={22} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">الموارد البشرية</h1>
            <p className="text-sm text-gray-500">{employees.length} موظف مسجل</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-emerald-700"
        >
          <Plus size={16} /> إضافة موظف
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي الموظفين', value: employees.length, color: 'blue' },
          { label: 'نشطون', value: employees.filter(e => e.is_active).length, color: 'emerald' },
          { label: 'الفروع', value: branches.length, color: 'purple' },
          { label: 'متوقف', value: employees.filter(e => !e.is_active).length, color: 'red' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{k.value}</div>
            <div className="text-xs text-gray-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute right-3 top-3 text-gray-400" />
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="بحث بالاسم أو المسمى الوظيفي..."
          className="w-full border rounded-lg pr-9 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Employee list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p>لا يوجد موظفون</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(emp => (
            <button
              key={emp.id}
              onClick={() => navigate(`/hr/employees/${emp.id}`)}
              className="w-full bg-white border rounded-xl p-4 text-right hover:border-emerald-400 hover:shadow-sm transition-all flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-lg shrink-0">
                {emp.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{emp.name}</span>
                  {!emp.is_active && (
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">متوقف</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {emp.role_title && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Briefcase size={12} /> {emp.role_title}
                    </span>
                  )}
                  {emp.phone && (
                    <span className="text-xs text-gray-400">{emp.phone}</span>
                  )}
                  {emp.hire_date && (
                    <span className="text-xs text-gray-400">تعيين: {emp.hire_date}</span>
                  )}
                </div>
              </div>
              <div className="text-left shrink-0">
                <div className="text-sm font-bold text-emerald-700">{emp.daily_wage.toLocaleString()}</div>
                <div className="text-xs text-gray-400">يومي</div>
              </div>
              <ChevronRight size={16} className="text-gray-300 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Branches quick view */}
      {(branches as {id:number; name:string; city?:string}[]).length > 0 && (
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={16} className="text-purple-600" />
            <h3 className="font-semibold text-gray-700 text-sm">الفروع</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {(branches as {id:number; name:string; city?:string}[]).map(b => (
              <span key={b.id} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-3 py-1">
                {b.name}{b.city ? ` — ${b.city}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="إضافة موظف جديد">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">الاسم <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="الاسم الكامل" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">المسمى الوظيفي</label>
            <input value={form.role_title} onChange={e => setForm(f => ({...f, role_title: e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="مثال: مشرف حقل" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">رقم الجوال</label>
              <input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">الأجر اليومي</label>
              <input type="number" value={form.daily_wage} onChange={e => setForm(f => ({...f, daily_wage: e.target.value}))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">تاريخ التعيين</label>
            <input type="date" value={form.hire_date} onChange={e => setForm(f => ({...f, hire_date: e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          {addMut.isError && (
            <p className="text-red-600 text-sm">{(addMut.error as Error)?.message}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowAdd(false)}
              className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
            <button
              onClick={() => form.name && addMut.mutate(form)}
              disabled={!form.name || addMut.isPending}
              className="flex-1 bg-emerald-600 text-white rounded-lg py-2 text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {addMut.isPending ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
