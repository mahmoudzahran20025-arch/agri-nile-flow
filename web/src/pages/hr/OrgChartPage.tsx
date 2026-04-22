import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Users, ChevronDown, ChevronRight, Building2, Briefcase, Phone, Search } from 'lucide-react'
import { api, unwrap } from '../../api/client'
import { hrApi } from '../../api/hr'
import type { Branch, EmployeeJobDetails } from '../../api/hr'

interface Employee {
  id: number; name: string; national_id?: string; role_title?: string
  phone?: string; hire_date?: string; daily_wage: number; is_active: number
}

const LEVEL_BADGE: Record<string, { label: string; color: string }> = {
  manager: { label: 'مدير',    color: 'bg-red-100 text-red-700' },
  senior:  { label: 'متقدم',  color: 'bg-purple-100 text-purple-700' },
  mid:     { label: 'متوسط',  color: 'bg-blue-100 text-blue-700' },
  junior:  { label: 'مبتدئ',  color: 'bg-gray-100 text-gray-600' },
}
const CONTRACT_BADGE: Record<string, { label: string; color: string }> = {
  full_time:  { label: 'دوام كامل', color: 'bg-emerald-100 text-emerald-700' },
  part_time:  { label: 'دوام جزئي', color: 'bg-yellow-100 text-yellow-700' },
  seasonal:   { label: 'موسمي',    color: 'bg-orange-100 text-orange-700' },
  contractor: { label: 'متعاقد',   color: 'bg-pink-100 text-pink-700' },
}

// ── Employee Card (leaf) ─────────────────────────────────────
function EmployeeCard({ emp, job, onClick }: {
  emp: Employee
  job?: EmployeeJobDetails
  onClick: () => void
}) {
  const level = job?.position_level ? LEVEL_BADGE[job.position_level] : null
  const contract = job?.contract_type ? CONTRACT_BADGE[job.contract_type] : null
  const initials = emp.name.split(' ').slice(0, 2).map(w => w[0]).join('')

  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 min-w-[130px] max-w-[150px]
        transition-all hover:shadow-md hover:-translate-y-0.5 text-center
        ${emp.is_active
          ? 'bg-white border-gray-100 hover:border-emerald-300'
          : 'bg-gray-50 border-gray-100 opacity-50'}`}
    >
      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0
        ${emp.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
        {initials}
      </div>
      <div className="w-full">
        <p className="text-xs font-semibold text-gray-800 leading-tight line-clamp-2">{emp.name}</p>
        {emp.role_title && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{emp.role_title}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1 justify-center">
        {level && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${level.color}`}>{level.label}</span>
        )}
        {contract && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${contract.color}`}>{contract.label}</span>
        )}
      </div>
      {emp.phone && (
        <span className="text-xs text-gray-400 flex items-center gap-0.5">
          <Phone size={10} /> {emp.phone}
        </span>
      )}
    </button>
  )
}

// ── Department group ─────────────────────────────────────────
function DeptGroup({ dept, employees, jobMap, navigate }: {
  dept: string
  employees: Employee[]
  jobMap: Record<number, EmployeeJobDetails>
  navigate: (p: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 mb-3 group"
      >
        <div className="w-6 h-6 rounded-md bg-brand-100 flex items-center justify-center">
          {open ? <ChevronDown size={14} className="text-brand-600" /> : <ChevronRight size={14} className="text-brand-600" />}
        </div>
        <span className="text-sm font-semibold text-gray-700">{dept}</span>
        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{employees.length}</span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-3 pr-6">
          {employees
            .sort((a, b) => {
              const la = jobMap[a.id]?.position_level ?? 'junior'
              const lb = jobMap[b.id]?.position_level ?? 'junior'
              const order = ['manager', 'senior', 'mid', 'junior']
              return order.indexOf(la) - order.indexOf(lb)
            })
            .map(emp => (
              <EmployeeCard
                key={emp.id}
                emp={emp}
                job={jobMap[emp.id]}
                onClick={() => navigate(`/hr/employees/${emp.id}`)}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// ── Branch section ───────────────────────────────────────────
function BranchSection({ branch, employees, jobMap, navigate }: {
  branch: { id: number | null; name: string }
  employees: Employee[]
  jobMap: Record<number, EmployeeJobDetails>
  navigate: (p: string) => void
}) {
  const [open, setOpen] = useState(true)

  // Group by department
  const byDept = useMemo(() => {
    const map: Record<string, Employee[]> = {}
    for (const emp of employees) {
      const dept = jobMap[emp.id]?.department ?? 'بدون قسم'
      if (!map[dept]) map[dept] = []
      map[dept].push(emp)
    }
    return map
  }, [employees, jobMap])

  const totalActive = employees.filter(e => e.is_active).length

  return (
    <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Branch header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-right"
      >
        <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
          <Building2 size={18} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-gray-900">{branch.name}</p>
          <p className="text-xs text-gray-400">{employees.length} موظف — {totalActive} نشط</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-brand-50 text-brand-700 px-2.5 py-1 rounded-full border border-brand-200">
            {Object.keys(byDept).length} قسم
          </span>
          {open
            ? <ChevronDown size={18} className="text-gray-400" />
            : <ChevronRight size={18} className="text-gray-400" />}
        </div>
      </button>

      {/* Departments */}
      {open && (
        <div className="p-4 border-t bg-gray-50/50">
          {Object.entries(byDept).map(([dept, emps]) => (
            <DeptGroup
              key={dept}
              dept={dept}
              employees={emps}
              jobMap={jobMap}
              navigate={navigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────
export default function OrgChartPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => unwrap(api.get<Employee[]>('/employees')),
  })
  const { data: branches = [] } = useQuery({
    queryKey: ['hr-branches'],
    queryFn: () => hrApi.getBranches(),
  })
  const { data: jobDetails = [] } = useQuery({
    queryKey: ['hr-all-job-details'],
    queryFn: () => unwrap(api.get<EmployeeJobDetails[]>('/hr/job-details')),
  })

  // Build job details lookup
  const jobMap = useMemo<Record<number, EmployeeJobDetails>>(() => {
    const m: Record<number, EmployeeJobDetails> = {}
    for (const j of jobDetails as EmployeeJobDetails[]) m[j.employee_id] = j
    return m
  }, [jobDetails])

  // Filter employees
  const filteredEmps = useMemo(() => {
    const q = search.toLowerCase()
    return (employees as Employee[]).filter(e =>
      !q || e.name.toLowerCase().includes(q)
        || e.role_title?.toLowerCase().includes(q)
        || jobMap[e.id]?.department?.toLowerCase().includes(q)
    )
  }, [employees, search, jobMap])

  // Group by branch
  const grouped = useMemo(() => {
    const byBranch: Record<string, Employee[]> = {}
    for (const emp of filteredEmps) {
      const branchId = jobMap[emp.id]?.branch_id ?? null
      const key = branchId !== null ? String(branchId) : 'none'
      if (!byBranch[key]) byBranch[key] = []
      byBranch[key].push(emp)
    }
    return byBranch
  }, [filteredEmps, jobMap])

  const allBranches = branches as Branch[]
  const branchKeys = Object.keys(grouped)

  const totalActive = (employees as Employee[]).filter(e => e.is_active).length
  const totalManagers = Object.values(jobMap).filter(j => j.position_level === 'manager').length

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-100 rounded-xl">
            <Users size={22} className="text-brand-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">الهيكل التنظيمي</h1>
            <p className="text-sm text-gray-500">
              {(employees as Employee[]).length} موظف · {totalActive} نشط · {totalManagers} مدير
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={15} className="absolute right-3 top-2.5 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو القسم..."
            className="border rounded-xl pr-9 pl-4 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي الموظفين', value: (employees as Employee[]).length, color: 'text-brand-700', bg: 'bg-brand-50' },
          { label: 'نشطون',           value: totalActive,    color: 'text-emerald-700', bg: 'bg-emerald-50' },
          { label: 'عدد الفروع',      value: allBranches.length, color: 'text-blue-700', bg: 'bg-blue-50' },
          { label: 'المديرون',        value: totalManagers,  color: 'text-purple-700', bg: 'bg-purple-50' },
        ].map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl p-4 text-center border border-white`}>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-xs text-gray-500 mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 items-center text-xs text-gray-500">
        <Briefcase size={13} className="text-gray-400" />
        <span>مستوى:</span>
        {Object.entries(LEVEL_BADGE).map(([, v]) => (
          <span key={v.label} className={`px-2 py-0.5 rounded-full ${v.color}`}>{v.label}</span>
        ))}
        <span className="mx-2">|</span>
        <span>عقد:</span>
        {Object.entries(CONTRACT_BADGE).map(([, v]) => (
          <span key={v.label} className={`px-2 py-0.5 rounded-full ${v.color}`}>{v.label}</span>
        ))}
      </div>

      {/* Org tree */}
      {branchKeys.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p>لا يوجد موظفون</p>
        </div>
      ) : (
        <div>
          {branchKeys.map(key => {
            const branchObj = allBranches.find(b => String(b.id) === key)
            const branchInfo = branchObj
              ? { id: branchObj.id, name: branchObj.name }
              : { id: null, name: 'بدون فرع' }
            return (
              <BranchSection
                key={key}
                branch={branchInfo}
                employees={grouped[key]}
                jobMap={jobMap}
                navigate={navigate}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
