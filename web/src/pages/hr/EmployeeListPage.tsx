import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Users, Plus, Search, ChevronRight, Briefcase, Building2,
  Phone, Calendar, X, Filter, UserCheck, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { api, unwrap } from '../../api/client'
import { hrApi } from '../../api/hr'
import Modal from '../../components/ui/Modal'

interface Employee {
  id: number; name: string; national_id?: string; role_title?: string
  phone?: string; hire_date?: string; daily_wage: number; is_active: number; notes?: string
  // from job_details join:
  branch_id?: number; branch_name?: string; department?: string
  contract_type?: string; position_level?: string
}

const CONTRACT_BADGE: Record<string, { label: string; color: string }> = {
  full_time:  { label: 'دوام كامل', color: 'bg-emerald-100 text-emerald-700' },
  part_time:  { label: 'دوام جزئي', color: 'bg-yellow-100 text-yellow-700' },
  seasonal:   { label: 'موسمي',    color: 'bg-orange-100 text-orange-700' },
  contractor: { label: 'متعاقد',   color: 'bg-pink-100 text-pink-700' },
}
const LEVEL_BADGE: Record<string, { label: string; color: string }> = {
  manager: { label: 'مدير',   color: 'bg-red-100 text-red-700' },
  senior:  { label: 'متقدم', color: 'bg-purple-100 text-purple-700' },
  mid:     { label: 'متوسط', color: 'bg-blue-100 text-blue-700' },
  junior:  { label: 'مبتدئ', color: 'bg-gray-100 text-gray-600' },
}

const AVATAR_COLORS = [
  'bg-emerald-100 text-emerald-700',
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
]

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

// ── Shared form state type ───────────────────────────────────
interface FormState {
  name: string; national_id: string; role_title: string
  phone: string; hire_date: string; daily_wage: string; notes: string
}

const EMPTY_FORM: FormState = {
  name: '', national_id: '', role_title: '', phone: '', hire_date: '', daily_wage: '', notes: '',
}

export default function EmployeeListPage() {
  const navigate = useNavigate()
  const qc       = useQueryClient()

  // Filters
  const [q,              setQ]              = useState('')
  const [filterBranch,   setFilterBranch]   = useState('')
  const [filterStatus,   setFilterStatus]   = useState<'all' | 'active' | 'inactive'>('all')
  const [filterContract, setFilterContract] = useState('')
  const [showFilters,    setShowFilters]    = useState(false)

  // Modals
  const [showAdd, setShowAdd] = useState(false)
  const [editEmp, setEditEmp] = useState<Employee | null>(null)
  const [form,    setForm]    = useState<FormState>(EMPTY_FORM)

  const { data: empData, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => unwrap(api.get<Employee[]>('/employees')),
  })
  const { data: branchData } = useQuery({
    queryKey: ['hr-branches'],
    queryFn: () => hrApi.getBranches(),
  })

  const addMut = useMutation({
    mutationFn: (b: FormState) =>
      unwrap(api.post<{ id: number }>('/employees', {
        name: b.name, national_id: b.national_id || undefined,
        role_title: b.role_title || undefined, phone: b.phone || undefined,
        hire_date: b.hire_date || undefined, daily_wage: Number(b.daily_wage) || 0,
        notes: b.notes || undefined,
      })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      setShowAdd(false)
      setForm(EMPTY_FORM)
    },
  })

  const editMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FormState }) =>
      unwrap(api.patch<null>(`/employees/${id}`, {
        name: data.name, national_id: data.national_id || null,
        role_title: data.role_title || null, phone: data.phone || null,
        hire_date: data.hire_date || null, daily_wage: Number(data.daily_wage) || 0,
        notes: data.notes || null,
      })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      setEditEmp(null)
    },
  })

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: number }) =>
      unwrap(api.patch<null>(`/employees/${id}`, { is_active })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  })

  const employees: Employee[] = empData ?? []
  const branches = (branchData ?? []) as { id: number; name: string; city?: string }[]

  const filtered = useMemo(() => {
    return employees.filter(e => {
      const matchQ = !q || e.name.includes(q) || e.role_title?.includes(q) ||
                     e.national_id?.includes(q) || e.phone?.includes(q)
      const matchBranch   = !filterBranch   || String(e.branch_id) === filterBranch
      const matchStatus   = filterStatus === 'all' ||
                            (filterStatus === 'active' && e.is_active) ||
                            (filterStatus === 'inactive' && !e.is_active)
      const matchContract = !filterContract || e.contract_type === filterContract
      return matchQ && matchBranch && matchStatus && matchContract
    })
  }, [employees, q, filterBranch, filterStatus, filterContract])

  const thisMonth    = new Date().toISOString().slice(0, 7)
  const newThisMonth = employees.filter(e => e.hire_date?.startsWith(thisMonth)).length
  const activeCount  = employees.filter(e => e.is_active).length
  const hasFilters   = filterBranch || filterStatus !== 'all' || filterContract

  const openEdit = (emp: Employee) => {
    setForm({
      name: emp.name, national_id: emp.national_id ?? '',
      role_title: emp.role_title ?? '', phone: emp.phone ?? '',
      hire_date: emp.hire_date ?? '', daily_wage: String(emp.daily_wage),
      notes: emp.notes ?? '',
    })
    setEditEmp(emp)
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-100 rounded-xl">
            <Users size={22} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">الموارد البشرية</h1>
            <p className="text-sm text-gray-500">{employees.length} موظف مسجل</p>
          </div>
        </div>
        <button
          onClick={() => { setForm(EMPTY_FORM); setShowAdd(true) }}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-emerald-700 shadow-sm transition-colors"
        >
          <Plus size={16} /> إضافة موظف
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-gray-900">{employees.length}</div>
          <div className="text-xs text-gray-500 mt-1">إجمالي الموظفين</div>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 shadow-sm text-center">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <UserCheck size={16} className="text-emerald-600" />
            <div className="text-2xl font-bold text-emerald-700">{activeCount}</div>
          </div>
          <div className="text-xs text-emerald-600">نشطون</div>
        </div>
        <div className="bg-purple-50 rounded-xl border border-purple-100 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-purple-700">{branches.length}</div>
          <div className="text-xs text-purple-600 mt-1">الفروع</div>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-4 shadow-sm text-center">
          <div className="text-2xl font-bold text-blue-700">{newThisMonth}</div>
          <div className="text-xs text-blue-600 mt-1">تعيينات هذا الشهر</div>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute right-3 top-3 text-gray-400" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="بحث بالاسم أو الرقم القومي أو المسمى الوظيفي..."
            className="w-full border rounded-xl pr-9 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          onClick={() => setShowFilters(f => !f)}
          className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 text-sm transition-colors
            ${hasFilters ? 'bg-emerald-600 text-white border-emerald-600' : 'text-gray-600 hover:bg-gray-50'}`}
        >
          <Filter size={15} />
          <span className="hidden sm:inline">{hasFilters ? 'فلتر مُفعَّل' : 'فلتر'}</span>
        </button>
        {hasFilters && (
          <button
            onClick={() => { setFilterBranch(''); setFilterStatus('all'); setFilterContract('') }}
            className="text-gray-400 hover:text-gray-600 p-2"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-gray-50 border rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">الفرع</label>
            <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">كل الفروع</option>
              {branches.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">الحالة</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all'|'active'|'inactive')}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="all">الكل</option>
              <option value="active">نشط</option>
              <option value="inactive">متوقف</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">نوع العقد</label>
            <select value={filterContract} onChange={e => setFilterContract(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">الكل</option>
              {Object.entries(CONTRACT_BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {(q || hasFilters) && (
        <p className="text-sm text-gray-500">
          عرض <span className="font-semibold text-gray-900">{filtered.length}</span> من {employees.length} موظف
        </p>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border">
          <Users size={44} className="mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 font-medium">لا يوجد موظفون</p>
          <p className="text-gray-400 text-sm mt-1">
            {q || hasFilters ? 'جرب تغيير معايير البحث' : 'ابدأ بإضافة موظف جديد'}
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {filtered.map((emp, idx) => {
            const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length]
            const contract    = emp.contract_type ? CONTRACT_BADGE[emp.contract_type] : null
            const level       = emp.position_level ? LEVEL_BADGE[emp.position_level] : null
            return (
              <div
                key={emp.id}
                className={`bg-white border rounded-xl px-4 py-3.5 flex items-center gap-4 shadow-sm
                  hover:border-emerald-300 hover:shadow-md transition-all
                  ${!emp.is_active ? 'opacity-60' : ''}`}
              >
                {/* Avatar */}
                <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${avatarColor}`}>
                  {getInitials(emp.name)}
                </div>

                {/* Main info */}
                <button
                  onClick={() => navigate(`/hr/employees/${emp.id}`)}
                  className="flex-1 text-right min-w-0"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm">{emp.name}</span>
                    {!emp.is_active && (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">متوقف</span>
                    )}
                    {level && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${level.color}`}>{level.label}</span>}
                    {contract && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${contract.color}`}>{contract.label}</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-gray-500">
                    {emp.role_title && (
                      <span className="flex items-center gap-1">
                        <Briefcase size={11} /> {emp.role_title}
                      </span>
                    )}
                    {emp.branch_name && (
                      <span className="flex items-center gap-1">
                        <Building2 size={11} /> {emp.branch_name}
                      </span>
                    )}
                    {emp.department && <span className="text-gray-400">{emp.department}</span>}
                    {emp.phone && (
                      <span className="flex items-center gap-1 text-gray-400">
                        <Phone size={11} /> {emp.phone}
                      </span>
                    )}
                    {emp.hire_date && (
                      <span className="flex items-center gap-1 text-gray-400">
                        <Calendar size={11} /> {emp.hire_date}
                      </span>
                    )}
                  </div>
                </button>

                {/* Wage */}
                <div className="text-left shrink-0 hidden sm:block">
                  <div className="text-sm font-bold text-emerald-700">
                    {emp.daily_wage.toLocaleString('ar-EG')}
                  </div>
                  <div className="text-xs text-gray-400">ج.م / يوم</div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); openEdit(emp) }}
                    className="text-xs text-gray-500 hover:text-emerald-700 border rounded-lg px-2.5 py-1.5 hover:bg-emerald-50 transition-colors"
                  >
                    تعديل
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      toggleActiveMut.mutate({ id: emp.id, is_active: emp.is_active ? 0 : 1 })
                    }}
                    className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                    title={emp.is_active ? 'إيقاف الموظف' : 'تنشيط الموظف'}
                  >
                    {emp.is_active
                      ? <ToggleRight size={18} className="text-emerald-500" />
                      : <ToggleLeft  size={18} className="text-gray-400" />
                    }
                  </button>
                  <button onClick={() => navigate(`/hr/employees/${emp.id}`)} className="p-1 text-gray-300 hover:text-emerald-600 transition-colors">
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="إضافة موظف جديد">
        <EmployeeForm
          form={form} setForm={setForm}
          onSubmit={() => form.name && addMut.mutate(form)}
          onCancel={() => setShowAdd(false)}
          isPending={addMut.isPending}
          error={addMut.isError ? (addMut.error as Error)?.message : undefined}
          submitLabel="إضافة الموظف"
        />
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editEmp} onClose={() => setEditEmp(null)} title={`تعديل: ${editEmp?.name ?? ''}`}>
        <EmployeeForm
          form={form} setForm={setForm}
          onSubmit={() => editEmp && editMut.mutate({ id: editEmp.id, data: form })}
          onCancel={() => setEditEmp(null)}
          isPending={editMut.isPending}
          error={editMut.isError ? (editMut.error as Error)?.message : undefined}
          submitLabel="حفظ التعديلات"
        />
      </Modal>
    </div>
  )
}

// ── Shared form component ───────────────────────────────────
function EmployeeForm({
  form, setForm, onSubmit, onCancel, isPending, error, submitLabel,
}: {
  form: FormState
  setForm: (fn: (f: FormState) => FormState) => void
  onSubmit: () => void
  onCancel: () => void
  isPending: boolean
  error?: string
  submitLabel: string
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">الاسم الكامل <span className="text-red-500">*</span></label>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="الاسم الكامل للموظف" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">الرقم القومي</label>
          <input value={form.national_id} onChange={e => setForm(f => ({ ...f, national_id: e.target.value }))}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="14 رقم" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">رقم الجوال</label>
          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="01x xxx xxxx" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">المسمى الوظيفي</label>
        <input value={form.role_title} onChange={e => setForm(f => ({ ...f, role_title: e.target.value }))}
          className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="مثال: مشرف حقل" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ التعيين</label>
          <input type="date" value={form.hire_date} onChange={e => setForm(f => ({ ...f, hire_date: e.target.value }))}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">الأجر اليومي (ج.م)</label>
          <input type="number" value={form.daily_wage} onChange={e => setForm(f => ({ ...f, daily_wage: e.target.value }))}
            className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="0" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={2}
          className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          placeholder="أي معلومات إضافية..." />
      </div>
      {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-3 pt-2">
        <button onClick={onCancel}
          className="flex-1 border rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          إلغاء
        </button>
        <button
          onClick={() => form.name && onSubmit()}
          disabled={!form.name || isPending}
          className="flex-1 bg-emerald-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'جاري الحفظ...' : submitLabel}
        </button>
      </div>
    </div>
  )
}

