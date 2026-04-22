import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, User, Briefcase, Calendar, Package,
  TrendingDown, Edit3, Save, X, FileText, Phone, Hash,
  ToggleRight, ToggleLeft, CheckCircle, XCircle, Clock,
} from 'lucide-react'
import { api, unwrap } from '../../api/client'
import { hrApi } from '../../api/hr'
import type { EmployeeJobDetails, SalaryAdvance, LeaveRequest, EmployeeAsset, AttendanceRecord } from '../../api/hr'

// ── Status maps ──────────────────────────────────────────────
const ATTEND_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  present:  { label: 'حاضر',   bg: 'bg-emerald-100', text: 'text-emerald-700' },
  absent:   { label: 'غائب',   bg: 'bg-red-100',     text: 'text-red-700' },
  late:     { label: 'متأخر',  bg: 'bg-yellow-100',  text: 'text-yellow-700' },
  sick:     { label: 'مريض',   bg: 'bg-orange-100',  text: 'text-orange-700' },
  leave:    { label: 'إجازة',  bg: 'bg-blue-100',    text: 'text-blue-700' },
  half_day: { label: 'نصف',    bg: 'bg-purple-100',  text: 'text-purple-700' },
  holiday:  { label: 'عطلة',   bg: 'bg-gray-100',    text: 'text-gray-600' },
}
const ADVANCE_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending:  { label: 'معلق',   color: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'معتمد',  color: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'مرفوض', color: 'bg-red-100 text-red-700' },
  paid:     { label: 'مدفوع', color: 'bg-blue-100 text-blue-700' },
}
const LEAVE_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending:   { label: 'معلق',   color: 'bg-yellow-100 text-yellow-700' },
  approved:  { label: 'معتمد',  color: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: 'مرفوض', color: 'bg-red-100 text-red-700' },
  cancelled: { label: 'ملغي',   color: 'bg-gray-100 text-gray-700' },
}
const CONTRACT_AR: Record<string, string> = {
  full_time: 'دوام كامل', part_time: 'دوام جزئي', seasonal: 'موسمي', contractor: 'متعاقد',
}
const LEVEL_AR: Record<string, string> = {
  manager: 'مدير', senior: 'متقدم', mid: 'متوسط', junior: 'مبتدئ',
}
const SHIFT_AR: Record<string, string> = {
  morning: 'صباحي', evening: 'مسائي', night: 'ليلي', flexible: 'مرن',
}

type Tab = 'personal' | 'job' | 'attendance' | 'leaves' | 'assets'

interface BasicEmp {
  id: number; name: string; national_id?: string; role_title?: string
  phone?: string; hire_date?: string; daily_wage: number; is_active: number; notes?: string
}

export default function EmployeeProfilePage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const empId    = Number(id)

  const [tab, setTab] = useState<Tab>('personal')

  // Personal editing state
  const [editingBasic, setEditingBasic] = useState(false)
  const [basicForm, setBasicForm] = useState<Partial<BasicEmp>>({})

  // Job editing state
  const [editingJob, setEditingJob] = useState(false)
  const [jobForm, setJobForm]       = useState<Partial<EmployeeJobDetails>>({})

  // ── Queries ──────────────────────────────────────────────
  const { data: profileRes, isLoading } = useQuery({
    queryKey: ['hr-profile', empId],
    queryFn: () => hrApi.getEmployeeProfile(empId),
    enabled: !!empId,
  })
  const { data: branchesRes } = useQuery({
    queryKey: ['hr-branches'],
    queryFn: () => hrApi.getBranches(),
  })
  const { data: advancesRes } = useQuery({
    queryKey: ['hr-advances-emp', empId],
    queryFn: () => hrApi.getSalaryAdvances({ employee_id: String(empId) }),
    enabled: tab === 'leaves',
  })
  const { data: leavesRes } = useQuery({
    queryKey: ['hr-leaves-emp', empId],
    queryFn: () => hrApi.getLeaveRequests({ employee_id: String(empId) }),
    enabled: tab === 'leaves',
  })

  // ── Mutations ───────────────────────────────────────────
  const editBasicMut = useMutation({
    mutationFn: (b: Partial<BasicEmp>) =>
      unwrap(api.patch<null>(`/employees/${empId}`, b)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-profile', empId] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      setEditingBasic(false)
    },
  })

  const upsertJobMut = useMutation({
    mutationFn: (b: Partial<EmployeeJobDetails>) => hrApi.upsertJobDetails(empId, b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-profile', empId] })
      setEditingJob(false)
    },
  })

  const approveAdvMut = useMutation({
    mutationFn: (id: number) => hrApi.approveSalaryAdvance(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-advances-emp', empId] }),
  })
  const rejectAdvMut = useMutation({
    mutationFn: (id: number) => hrApi.rejectSalaryAdvance(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-advances-emp', empId] }),
  })
  const approveLeave = useMutation({
    mutationFn: (id: number) => hrApi.approveLeaveRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves-emp', empId] }),
  })
  const rejectLeave = useMutation({
    mutationFn: (id: number) => hrApi.rejectLeaveRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves-emp', empId] }),
  })
  const returnAssetMut = useMutation({
    mutationFn: ({ id, return_date }: { id: number; return_date: string }) =>
      hrApi.returnAsset(id, { return_date }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-profile', empId] }),
  })

  // ── Render ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-100 animate-pulse rounded-xl" />)}
      </div>
    )
  }

  const profile    = profileRes
  const employee   = profileRes?.employee as BasicEmp | undefined
  const jobDetails = profileRes?.job_details
  const branches   = branchesRes ?? []
  const attendance: AttendanceRecord[] = profile?.recent_attendance ?? []
  const assets: EmployeeAsset[]        = profile?.assets ?? []
  const advances: SalaryAdvance[]      = advancesRes ?? []
  const leaves: LeaveRequest[]         = leavesRes ?? []

  if (!employee) {
    return (
      <div className="p-6 text-center text-gray-500">
        <User size={40} className="mx-auto mb-3 opacity-30" />
        <p>الموظف غير موجود</p>
      </div>
    )
  }

  const initials = employee.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const presentDays = attendance.filter(a => a.status === 'present' || a.status === 'late').length
  const absentDays  = attendance.filter(a => a.status === 'absent').length

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'personal',   label: 'البيانات الأساسية', icon: <User size={15} /> },
    { key: 'job',        label: 'الوظيفة',           icon: <Briefcase size={15} /> },
    { key: 'attendance', label: 'الحضور',            icon: <Calendar size={15} /> },
    { key: 'leaves',     label: 'الإجازات والسلف',   icon: <TrendingDown size={15} /> },
    { key: 'assets',     label: 'الأصول',            icon: <Package size={15} /> },
  ]

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      {/* Back */}
      <button
        onClick={() => navigate('/hr')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
      >
        <ArrowRight size={16} /> العودة للموظفين
      </button>

      {/* Profile header */}
      <div className="bg-white border rounded-2xl p-5 flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-2xl shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{employee.name}</h1>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              employee.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
            }`}>
              {employee.is_active ? 'نشط' : 'متوقف'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {employee.role_title ?? 'لا يوجد مسمى وظيفي'}
            {jobDetails?.department ? ` — ${jobDetails.department}` : ''}
            {jobDetails?.branch_name ? ` | ${jobDetails.branch_name}` : ''}
          </p>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
            {employee.phone && <span className="flex items-center gap-1"><Phone size={11} />{employee.phone}</span>}
            {employee.hire_date && <span className="flex items-center gap-1"><Calendar size={11} />منذ {employee.hire_date}</span>}
            {employee.national_id && <span className="flex items-center gap-1"><Hash size={11} />{employee.national_id}</span>}
          </div>
        </div>
        <div className="text-left shrink-0 hidden sm:block">
          <div className="text-2xl font-bold text-emerald-700">{employee.daily_wage.toLocaleString('ar-EG')}</div>
          <div className="text-xs text-gray-400">ج.م / يوم</div>
          {attendanceSummaryBadge(presentDays, absentDays)}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border rounded-2xl overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors
                ${tab === t.key
                  ? 'text-emerald-700 border-b-2 border-emerald-600 bg-emerald-50/50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {/* ── Tab 1: Personal ─── */}
          {tab === 'personal' && (
            <div>
              {editingBasic ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <LabelInput label="الاسم الكامل *" value={basicForm.name ?? ''} onChange={v => setBasicForm(f => ({ ...f, name: v }))} />
                    <LabelInput label="الرقم القومي" value={basicForm.national_id ?? ''} onChange={v => setBasicForm(f => ({ ...f, national_id: v }))} />
                    <LabelInput label="رقم الجوال" value={basicForm.phone ?? ''} onChange={v => setBasicForm(f => ({ ...f, phone: v }))} />
                    <LabelInput label="المسمى الوظيفي" value={basicForm.role_title ?? ''} onChange={v => setBasicForm(f => ({ ...f, role_title: v }))} />
                    <LabelInput label="تاريخ التعيين" value={basicForm.hire_date ?? ''} onChange={v => setBasicForm(f => ({ ...f, hire_date: v }))} type="date" />
                    <LabelInput label="الأجر اليومي (ج.م)" value={String(basicForm.daily_wage ?? '')} onChange={v => setBasicForm(f => ({ ...f, daily_wage: Number(v) }))} type="number" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">ملاحظات</label>
                    <textarea
                      value={basicForm.notes ?? ''}
                      onChange={e => setBasicForm(f => ({ ...f, notes: e.target.value }))}
                      rows={3}
                      className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                    />
                  </div>
                  {/* Active toggle */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">حالة الموظف</span>
                    <button
                      onClick={() => setBasicForm(f => ({ ...f, is_active: f.is_active ? 0 : 1 }))}
                      className="flex items-center gap-2 text-sm"
                    >
                      {basicForm.is_active
                        ? <><ToggleRight size={22} className="text-emerald-500" /><span className="text-emerald-600">نشط</span></>
                        : <><ToggleLeft  size={22} className="text-gray-400" /><span className="text-gray-500">متوقف</span></>
                      }
                    </button>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setEditingBasic(false)}
                      className="flex items-center gap-1.5 flex-1 border rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 justify-center">
                      <X size={14} /> إلغاء
                    </button>
                    <button
                      onClick={() => editBasicMut.mutate(basicForm)}
                      disabled={!basicForm.name || editBasicMut.isPending}
                      className="flex items-center gap-1.5 flex-1 bg-emerald-600 text-white rounded-xl py-2.5 text-sm hover:bg-emerald-700 justify-center disabled:opacity-50">
                      <Save size={14} /> {editBasicMut.isPending ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex justify-end mb-4">
                    <button
                      onClick={() => { setBasicForm({ ...employee }); setEditingBasic(true) }}
                      className="flex items-center gap-1.5 text-sm text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2 hover:bg-emerald-100 transition-colors"
                    >
                      <Edit3 size={14} /> تعديل البيانات
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {([
                      { label: 'الاسم الكامل',     value: employee.name },
                      { label: 'الرقم القومي',     value: employee.national_id ?? '—' },
                      { label: 'رقم الجوال',       value: employee.phone ?? '—' },
                      { label: 'المسمى الوظيفي',   value: employee.role_title ?? '—' },
                      { label: 'تاريخ التعيين',    value: employee.hire_date ?? '—' },
                      { label: 'الأجر اليومي',     value: `${employee.daily_wage.toLocaleString('ar-EG')} ج.م` },
                    ] as { label: string; value: string }[]).map(k => (
                      <div key={k.label} className="bg-gray-50 rounded-xl p-3">
                        <div className="text-xs text-gray-400 mb-1">{k.label}</div>
                        <div className="text-sm font-semibold text-gray-800">{k.value}</div>
                      </div>
                    ))}
                  </div>
                  {employee.notes && (
                    <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl p-3">
                      <div className="text-xs text-amber-600 mb-1 font-medium">ملاحظات</div>
                      <p className="text-sm text-gray-700">{employee.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Tab 2: Job Details ─── */}
          {tab === 'job' && (
            <div>
              {editingJob ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">القسم / الإدارة</label>
                      <input value={jobForm.department ?? ''}
                        onChange={e => setJobForm(f => ({ ...f, department: e.target.value }))}
                        className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">الفرع</label>
                      <select value={jobForm.branch_id ?? ''}
                        onChange={e => setJobForm(f => ({ ...f, branch_id: Number(e.target.value) || undefined }))}
                        className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                        <option value="">— اختر الفرع —</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">المستوى الوظيفي</label>
                      <select value={jobForm.position_level ?? ''}
                        onChange={e => setJobForm(f => ({ ...f, position_level: e.target.value }))}
                        className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                        <option value="">— اختر —</option>
                        {Object.entries(LEVEL_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">نوع العقد</label>
                      <select value={jobForm.contract_type ?? ''}
                        onChange={e => setJobForm(f => ({ ...f, contract_type: e.target.value }))}
                        className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                        <option value="">— اختر —</option>
                        {Object.entries(CONTRACT_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">نوع الوردية</label>
                      <select value={jobForm.shift_type ?? ''}
                        onChange={e => setJobForm(f => ({ ...f, shift_type: e.target.value }))}
                        className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                        <option value="">— اختر —</option>
                        {Object.entries(SHIFT_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <LabelInput label="الراتب الأساسي (ج.م)" value={String(jobForm.base_salary ?? '')}
                      onChange={v => setJobForm(f => ({ ...f, base_salary: Number(v) }))} type="number" />
                    <LabelInput label="بدل السكن (ج.م)" value={String(jobForm.housing_allow ?? '')}
                      onChange={v => setJobForm(f => ({ ...f, housing_allow: Number(v) }))} type="number" />
                    <LabelInput label="بدل النقل (ج.م)" value={String(jobForm.transport_allow ?? '')}
                      onChange={v => setJobForm(f => ({ ...f, transport_allow: Number(v) }))} type="number" />
                    <LabelInput label="بدلات أخرى (ج.م)" value={String(jobForm.other_allows ?? '')}
                      onChange={v => setJobForm(f => ({ ...f, other_allows: Number(v) }))} type="number" />
                    <LabelInput label="التأمينات الاجتماعية (ج.م)" value={String(jobForm.social_insur ?? '')}
                      onChange={v => setJobForm(f => ({ ...f, social_insur: Number(v) }))} type="number" />
                    <LabelInput label="نسبة ضريبة الدخل (%)" value={String(jobForm.income_tax_pct ?? '')}
                      onChange={v => setJobForm(f => ({ ...f, income_tax_pct: Number(v) }))} type="number" />
                    <LabelInput label="اسم البنك" value={jobForm.bank_name ?? ''}
                      onChange={v => setJobForm(f => ({ ...f, bank_name: v }))} />
                    <LabelInput label="رقم الحساب IBAN" value={jobForm.bank_iban ?? ''}
                      onChange={v => setJobForm(f => ({ ...f, bank_iban: v }))} />
                    <LabelInput label="تاريخ بداية العقد" value={jobForm.start_date ?? ''}
                      onChange={v => setJobForm(f => ({ ...f, start_date: v }))} type="date" />
                    <LabelInput label="تاريخ نهاية العقد" value={jobForm.end_date ?? ''}
                      onChange={v => setJobForm(f => ({ ...f, end_date: v }))} type="date" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">ملاحظات</label>
                    <textarea value={jobForm.notes ?? ''}
                      onChange={e => setJobForm(f => ({ ...f, notes: e.target.value }))}
                      rows={2}
                      className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setEditingJob(false)}
                      className="flex items-center gap-1.5 flex-1 border rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 justify-center">
                      <X size={14} /> إلغاء
                    </button>
                    <button onClick={() => upsertJobMut.mutate(jobForm)}
                      disabled={upsertJobMut.isPending}
                      className="flex items-center gap-1.5 flex-1 bg-emerald-600 text-white rounded-xl py-2.5 text-sm hover:bg-emerald-700 justify-center disabled:opacity-50">
                      <Save size={14} /> {upsertJobMut.isPending ? 'جاري الحفظ...' : 'حفظ بيانات الوظيفة'}
                    </button>
                  </div>
                </div>
              ) : jobDetails ? (
                <div>
                  <div className="flex justify-end mb-4">
                    <button
                      onClick={() => { setJobForm(jobDetails); setEditingJob(true) }}
                      className="flex items-center gap-1.5 text-sm text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2 hover:bg-emerald-100 transition-colors"
                    >
                      <Edit3 size={14} /> تعديل بيانات الوظيفة
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {([
                      { label: 'القسم',              value: jobDetails.department ?? '—' },
                      { label: 'الفرع',              value: jobDetails.branch_name ?? '—' },
                      { label: 'المستوى',            value: LEVEL_AR[jobDetails.position_level ?? ''] ?? '—' },
                      { label: 'نوع العقد',          value: CONTRACT_AR[jobDetails.contract_type ?? ''] ?? '—' },
                      { label: 'الوردية',            value: SHIFT_AR[jobDetails.shift_type ?? ''] ?? '—' },
                      { label: 'الراتب الأساسي',    value: `${jobDetails.base_salary.toLocaleString('ar-EG')} ج.م` },
                      { label: 'بدل السكن',         value: `${(jobDetails.housing_allow ?? 0).toLocaleString('ar-EG')} ج.م` },
                      { label: 'بدل النقل',         value: `${(jobDetails.transport_allow ?? 0).toLocaleString('ar-EG')} ج.م` },
                      { label: 'بدلات أخرى',       value: `${(jobDetails.other_allows ?? 0).toLocaleString('ar-EG')} ج.م` },
                      { label: 'التأمينات',         value: `${(jobDetails.social_insur ?? 0).toLocaleString('ar-EG')} ج.م` },
                      { label: 'ضريبة الدخل',      value: `${jobDetails.income_tax_pct ?? 0}%` },
                      { label: 'صافي الراتب',      value: `${(jobDetails.base_salary + (jobDetails.housing_allow ?? 0) + (jobDetails.transport_allow ?? 0) + (jobDetails.other_allows ?? 0) - (jobDetails.social_insur ?? 0)).toLocaleString('ar-EG')} ج.م` },
                    ] as { label: string; value: string }[]).map(k => (
                      <div key={k.label} className="bg-gray-50 rounded-xl p-3">
                        <div className="text-xs text-gray-400 mb-1">{k.label}</div>
                        <div className="text-sm font-semibold text-gray-800">{k.value}</div>
                      </div>
                    ))}
                  </div>
                  {jobDetails.notes && (
                    <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl p-3">
                      <div className="text-xs text-amber-600 mb-1 font-medium">ملاحظات</div>
                      <p className="text-sm text-gray-700">{jobDetails.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <Briefcase size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium">لم تُضف بيانات الوظيفة بعد</p>
                  <button
                    onClick={() => { setJobForm({}); setEditingJob(true) }}
                    className="mt-3 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm hover:bg-emerald-700"
                  >
                    + إضافة الآن
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Tab 3: Attendance ─── */}
          {tab === 'attendance' && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {Object.entries(ATTEND_STATUS).map(([key, s]) => {
                  const count = attendance.filter(a => a.status === key).length
                  return (
                    <div key={key} className={`${s.bg} rounded-xl p-3 text-center`}>
                      <div className={`text-xl font-bold ${s.text}`}>{count}</div>
                      <div className={`text-xs ${s.text} mt-0.5`}>{s.label}</div>
                    </div>
                  )
                })}
              </div>
              {/* Records */}
              {attendance.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <Calendar size={36} className="mx-auto mb-3 opacity-30" />
                  <p>لا توجد سجلات حضور</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[...attendance].reverse().map(a => {
                    const s = ATTEND_STATUS[a.status] ?? { label: a.status, bg: 'bg-gray-100', text: 'text-gray-600' }
                    return (
                      <div key={a.id} className="flex flex-col items-center gap-1">
                        <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${s.bg} ${s.text}`}>{s.label}</span>
                        <span className="text-xs text-gray-400">{a.work_date.slice(5)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tab 4: Leaves & Advances ─── */}
          {tab === 'leaves' && (
            <div className="space-y-6">
              {/* Advances section */}
              <div>
                <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <TrendingDown size={16} className="text-orange-500" /> السلف ({advances.length})
                </h3>
                {advances.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">لا توجد سلف</p>
                ) : (
                  <div className="space-y-2">
                    {advances.map(a => {
                      const st = ADVANCE_STATUS_MAP[a.status] ?? { label: a.status, color: 'bg-gray-100 text-gray-600' }
                      return (
                        <div key={a.id} className="bg-gray-50 border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{a.amount.toLocaleString('ar-EG')} ج.م</div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {a.request_date} — {a.repay_months} شهر{a.reason ? ` — ${a.reason}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${st.color}`}>{st.label}</span>
                            {a.status === 'pending' && (
                              <>
                                <button onClick={() => approveAdvMut.mutate(a.id)}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                                  <CheckCircle size={16} />
                                </button>
                                <button onClick={() => rejectAdvMut.mutate(a.id)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg">
                                  <XCircle size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Leaves section */}
              <div>
                <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <FileText size={16} className="text-blue-500" /> طلبات الإجازة ({leaves.length})
                </h3>
                {leaves.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">لا توجد طلبات إجازة</p>
                ) : (
                  <div className="space-y-2">
                    {leaves.map(l => {
                      const st = LEAVE_STATUS_MAP[l.status] ?? { label: l.status, color: 'bg-gray-100 text-gray-600' }
                      return (
                        <div key={l.id} className="bg-gray-50 border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{l.days_count} يوم</div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {l.start_date} ← {l.end_date}{l.reason ? ` — ${l.reason}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${st.color}`}>{st.label}</span>
                            {l.status === 'pending' && (
                              <>
                                <button onClick={() => approveLeave.mutate(l.id)}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                                  <CheckCircle size={16} />
                                </button>
                                <button onClick={() => rejectLeave.mutate(l.id)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg">
                                  <XCircle size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tab 5: Assets ─── */}
          {tab === 'assets' && (
            <div>
              {assets.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Package size={40} className="mx-auto mb-3 opacity-30" />
                  <p>لا توجد أصول مخصصة</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {assets.map(a => (
                    <div key={a.id} className="bg-gray-50 border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
                          <Package size={18} className="text-purple-600" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-800">{a.asset_name}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {a.asset_type ?? ''}{a.serial_number ? ` — SN: ${a.serial_number}` : ''}
                            {' — تسليم: '}{a.assigned_date}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {a.return_date ? (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full">
                            مُرجَع {a.return_date}
                          </span>
                        ) : (
                          <button
                            onClick={() => returnAssetMut.mutate({ id: a.id, return_date: new Date().toISOString().slice(0, 10) })}
                            className="flex items-center gap-1.5 text-xs bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors"
                          >
                            <Clock size={12} /> استلام مرتجع
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────
function attendanceSummaryBadge(present: number, absent: number) {
  if (!present && !absent) return null
  return (
    <div className="text-xs text-gray-400 mt-1">
      <span className="text-emerald-600 font-medium">{present} حضور</span>
      {' / '}
      <span className="text-red-500 font-medium">{absent} غياب</span>
    </div>
  )
}

function LabelInput({
  label, value, onChange, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  )
}
