import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, User, Briefcase,
  Calendar, Package, TrendingDown, Edit3, Save, X
} from 'lucide-react'
import { hrApi } from '../../api/hr'
import type { EmployeeJobDetails } from '../../api/hr'

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  present:  { label: 'حاضر',   color: 'bg-emerald-100 text-emerald-700' },
  absent:   { label: 'غائب',   color: 'bg-red-100 text-red-700' },
  late:     { label: 'متأخر',  color: 'bg-yellow-100 text-yellow-700' },
  sick:     { label: 'مريض',   color: 'bg-orange-100 text-orange-700' },
  leave:    { label: 'إجازة',  color: 'bg-blue-100 text-blue-700' },
  half_day: { label: 'نصف يوم', color: 'bg-purple-100 text-purple-700' },
  holiday:  { label: 'عطلة',   color: 'bg-gray-100 text-gray-700' },
}

export default function EmployeeProfilePage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const empId    = Number(id)

  const [editingJob, setEditingJob] = useState(false)
  const [jobForm, setJobForm] = useState<Partial<EmployeeJobDetails>>({})

  const { data: profileRes, isLoading } = useQuery({
    queryKey: ['hr-profile', empId],
    queryFn: () => hrApi.getEmployeeProfile(empId),
    enabled: !!empId,
  })

  const { data: branchesRes } = useQuery({
    queryKey: ['hr-branches'],
    queryFn: () => hrApi.getBranches(),
  })

  const upsertJobMut = useMutation({
    mutationFn: (b: Partial<EmployeeJobDetails>) => hrApi.upsertJobDetails(empId, b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-profile', empId] })
      setEditingJob(false)
    },
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 animate-pulse rounded-xl" />)}
      </div>
    )
  }

  const profile    = profileRes
  const employee   = profileRes?.employee as Record<string, unknown> | undefined
  const jobDetails = profileRes?.job_details
  const branches   = branchesRes ?? []

  if (!employee) {
    return (
      <div className="p-6 text-center text-gray-500">
        <User size={40} className="mx-auto mb-3 opacity-30" />
        <p>الموظف غير موجود</p>
      </div>
    )
  }

  const startEdit = () => {
    setJobForm(jobDetails ?? {})
    setEditingJob(true)
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/hr')} className="text-gray-400 hover:text-gray-700">
          <ArrowRight size={20} />
        </button>
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xl">
          {(employee.name as string).charAt(0)}
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{employee.name as string}</h1>
          <p className="text-sm text-gray-500">{employee.role_title as string ?? 'لا يوجد مسمى'}</p>
        </div>
        <div className="mr-auto flex gap-2">
          {!editingJob && (
            <button onClick={startEdit}
              className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-1.5 text-sm hover:bg-emerald-100">
              <Edit3 size={14} /> تعديل بيانات الوظيفة
            </button>
          )}
        </div>
      </div>

      {/* Basic info strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'تاريخ التعيين', value: employee.hire_date as string ?? '—' },
          { label: 'الأجر اليومي',  value: `${Number(employee.daily_wage).toLocaleString()} ج.م` },
          { label: 'الجوال',        value: employee.phone as string ?? '—' },
          { label: 'الهوية',        value: employee.national_id as string ?? '—' },
        ].map(k => (
          <div key={k.label} className="bg-white border rounded-xl p-3">
            <div className="text-xs text-gray-400 mb-1">{k.label}</div>
            <div className="text-sm font-semibold text-gray-800">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Job Details */}
      <div className="bg-white border rounded-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Briefcase size={18} className="text-blue-600" />
            <h2 className="font-semibold text-gray-800">بيانات الوظيفة</h2>
          </div>
        </div>

        {editingJob ? (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">القسم</label>
                <input value={jobForm.department ?? ''} onChange={e => setJobForm(f => ({...f, department: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">الفرع</label>
                <select value={jobForm.branch_id ?? ''} onChange={e => setJobForm(f => ({...f, branch_id: Number(e.target.value) || undefined}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">— اختر الفرع —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">المستوى</label>
                <select value={jobForm.position_level ?? 'junior'} onChange={e => setJobForm(f => ({...f, position_level: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  {['junior','mid','senior','manager'].map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">نوع العقد</label>
                <select value={jobForm.contract_type ?? 'full_time'} onChange={e => setJobForm(f => ({...f, contract_type: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  {['full_time','part_time','seasonal','contractor'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">الراتب الأساسي</label>
                <input type="number" value={jobForm.base_salary ?? ''} onChange={e => setJobForm(f => ({...f, base_salary: Number(e.target.value)}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">بدل سكن</label>
                <input type="number" value={jobForm.housing_allow ?? ''} onChange={e => setJobForm(f => ({...f, housing_allow: Number(e.target.value)}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">بدل نقل</label>
                <input type="number" value={jobForm.transport_allow ?? ''} onChange={e => setJobForm(f => ({...f, transport_allow: Number(e.target.value)}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">تأمينات اجتماعية</label>
                <input type="number" value={jobForm.social_insur ?? ''} onChange={e => setJobForm(f => ({...f, social_insur: Number(e.target.value)}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">الرقم البنكي (IBAN)</label>
                <input value={jobForm.bank_iban ?? ''} onChange={e => setJobForm(f => ({...f, bank_iban: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">تاريخ بداية العقد</label>
                <input type="date" value={jobForm.start_date ?? ''} onChange={e => setJobForm(f => ({...f, start_date: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditingJob(false)}
                className="flex items-center gap-1.5 flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50 justify-center">
                <X size={14} /> إلغاء
              </button>
              <button onClick={() => upsertJobMut.mutate(jobForm)}
                disabled={upsertJobMut.isPending}
                className="flex items-center gap-1.5 flex-1 bg-emerald-600 text-white rounded-lg py-2 text-sm hover:bg-emerald-700 justify-center disabled:opacity-50">
                <Save size={14} /> {upsertJobMut.isPending ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        ) : jobDetails ? (
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'القسم',     value: jobDetails.department ?? '—' },
              { label: 'الفرع',     value: jobDetails.branch_name ?? '—' },
              { label: 'المستوى',   value: jobDetails.position_level },
              { label: 'العقد',     value: jobDetails.contract_type },
              { label: 'الراتب',    value: `${jobDetails.base_salary.toLocaleString()} ج.م` },
              { label: 'بدل سكن',  value: `${(jobDetails.housing_allow ?? 0).toLocaleString()} ج.م` },
              { label: 'بدل نقل',  value: `${(jobDetails.transport_allow ?? 0).toLocaleString()} ج.م` },
              { label: 'التأمينات', value: `${(jobDetails.social_insur ?? 0).toLocaleString()} ج.م` },
            ].map(k => (
              <div key={k.label}>
                <div className="text-xs text-gray-400">{k.label}</div>
                <div className="text-sm font-semibold text-gray-800 mt-0.5">{k.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-400 text-sm">
            <Briefcase size={32} className="mx-auto mb-2 opacity-30" />
            <p>لم تُضف بيانات الوظيفة بعد</p>
            <button onClick={startEdit}
              className="mt-3 text-emerald-600 hover:underline text-sm">+ إضافة الآن</button>
          </div>
        )}
      </div>

      {/* Recent Attendance */}
      <div className="bg-white border rounded-xl">
        <div className="flex items-center gap-2 px-5 py-4 border-b">
          <Calendar size={18} className="text-emerald-600" />
          <h2 className="font-semibold text-gray-800">آخر 30 يوم حضور</h2>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {profile?.recent_attendance.length ? (
            profile.recent_attendance.map(a => {
              const s = STATUS_MAP[a.status] ?? { label: a.status, color: 'bg-gray-100 text-gray-600' }
              return (
                <div key={a.id} className="text-center">
                  <span className={`text-xs px-2 py-1 rounded ${s.color}`}>{s.label}</span>
                  <div className="text-xs text-gray-400 mt-0.5">{a.work_date.slice(5)}</div>
                </div>
              )
            })
          ) : (
            <p className="text-sm text-gray-400">لا توجد سجلات حضور</p>
          )}
        </div>
      </div>

      {/* Assets */}
      {(profile?.assets ?? []).length > 0 && (
        <div className="bg-white border rounded-xl">
          <div className="flex items-center gap-2 px-5 py-4 border-b">
            <Package size={18} className="text-purple-600" />
            <h2 className="font-semibold text-gray-800">الأصول ({profile!.assets.length})</h2>
          </div>
          <div className="divide-y">
            {profile!.assets.map(a => (
              <div key={a.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-800">{a.asset_name}</div>
                  <div className="text-xs text-gray-400">{a.asset_type ?? ''} {a.serial_number ? `— SN: ${a.serial_number}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">{a.assigned_date}</div>
                  {a.return_date && <div className="text-xs text-red-500">مُرجَع: {a.return_date}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Advances */}
      {(profile?.advances ?? []).length > 0 && (
        <div className="bg-white border rounded-xl">
          <div className="flex items-center gap-2 px-5 py-4 border-b">
            <TrendingDown size={18} className="text-orange-600" />
            <h2 className="font-semibold text-gray-800">السلف ({profile!.advances.length})</h2>
          </div>
          <div className="divide-y">
            {profile!.advances.map(a => (
              <div key={a.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{a.amount.toLocaleString()} ج.م</div>
                  <div className="text-xs text-gray-400">{a.reason ?? ''} — {a.repay_months} شهر</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  a.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                  : a.status === 'rejected' ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {a.status === 'approved' ? 'معتمد' : a.status === 'rejected' ? 'مرفوض' : 'معلق'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
