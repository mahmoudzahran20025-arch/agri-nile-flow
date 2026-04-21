import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrendingDown, Plus, CheckCircle, XCircle, Clock } from 'lucide-react'
import { api, unwrap } from '../../api/client'
import { hrApi } from '../../api/hr'
import type { SalaryAdvance, LeaveRequest } from '../../api/hr'
import Modal from '../../components/ui/Modal'

type Tab = 'advances' | 'leaves'

const ADVANCE_STATUS: Record<string, {label:string; color:string}> = {
  pending:  { label: 'معلق',   color: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'معتمد',  color: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'مرفوض', color: 'bg-red-100 text-red-700' },
  paid:     { label: 'مدفوع', color: 'bg-blue-100 text-blue-700' },
}

const LEAVE_STATUS: Record<string, {label:string; color:string}> = {
  pending:   { label: 'معلق',     color: 'bg-yellow-100 text-yellow-700' },
  approved:  { label: 'معتمد',   color: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: 'مرفوض',  color: 'bg-red-100 text-red-700' },
  cancelled: { label: 'ملغي',    color: 'bg-gray-100 text-gray-700' },
}

export default function LeavesAdvancesPage() {
  const qc   = useQueryClient()
  const [tab, setTab]         = useState<Tab>('advances')
  const [showAdvForm, setShowAdvForm] = useState(false)
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  const [advForm, setAdvForm] = useState({ employee_id: '', request_date: '', amount: '', reason: '', repay_months: '1' })
  const [leaveForm, setLeaveForm] = useState({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', days_count: '1', reason: '' })

  const { data: advRes } = useQuery({
    queryKey: ['hr-advances', statusFilter],
    queryFn: () => hrApi.getSalaryAdvances(statusFilter ? { status: statusFilter } : undefined),
  })

  const { data: leaveRes } = useQuery({
    queryKey: ['hr-leaves', statusFilter],
    queryFn: () => hrApi.getLeaveRequests(statusFilter ? { status: statusFilter } : undefined),
  })

  const { data: empRes } = useQuery({
    queryKey: ['employees'],
    queryFn: () => unwrap(api.get<{id:number; name:string}[]>('/employees')),
  })

  const { data: leaveTypesRes } = useQuery({
    queryKey: ['hr-leave-types'],
    queryFn: () => hrApi.getLeaveTypes(),
  })

  const createAdvMut = useMutation({
    mutationFn: () => hrApi.createSalaryAdvance({
      employee_id: Number(advForm.employee_id), request_date: advForm.request_date,
      amount: Number(advForm.amount), reason: advForm.reason || undefined,
      repay_months: Number(advForm.repay_months) || 1,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr-advances'] }); setShowAdvForm(false) },
  })

  const createLeaveMut = useMutation({
    mutationFn: () => hrApi.createLeaveRequest({
      employee_id: Number(leaveForm.employee_id), leave_type_id: Number(leaveForm.leave_type_id),
      start_date: leaveForm.start_date, end_date: leaveForm.end_date,
      days_count: Number(leaveForm.days_count) || 1, reason: leaveForm.reason || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr-leaves'] }); setShowLeaveForm(false) },
  })

  const approveAdvMut  = useMutation({
    mutationFn: (id: number) => hrApi.approveSalaryAdvance(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-advances'] }),
  })
  const rejectAdvMut   = useMutation({
    mutationFn: (id: number) => hrApi.rejectSalaryAdvance(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-advances'] }),
  })
  const approveLeaveMut = useMutation({
    mutationFn: (id: number) => hrApi.approveLeaveRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
  })
  const rejectLeaveMut  = useMutation({
    mutationFn: (id: number) => hrApi.rejectLeaveRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
  })

  const advances   : SalaryAdvance[]  = advRes ?? []
  const leaves     : LeaveRequest[]   = leaveRes ?? []
  const employees: {id:number; name:string}[] = empRes ?? []
  const leaveTypes: {id:number; name:string}[] = leaveTypesRes ?? []

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 rounded-lg">
            <TrendingDown size={22} className="text-orange-700" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">الإجازات والسلف</h1>
        </div>
        <button
          onClick={() => tab === 'advances' ? setShowAdvForm(true) : setShowLeaveForm(true)}
          className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-orange-700"
        >
          <Plus size={16} /> {tab === 'advances' ? 'طلب سلفة' : 'طلب إجازة'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {([['advances','السلف'],['leaves','الإجازات']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t); setStatusFilter('') }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {['', 'pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs border transition-all ${
              statusFilter === s ? 'bg-gray-800 text-white border-gray-800' : 'text-gray-600 hover:border-gray-400'
            }`}>
            {s === '' ? 'الكل' : s === 'pending' ? 'معلق' : s === 'approved' ? 'معتمد' : 'مرفوض'}
          </button>
        ))}
      </div>

      {/* ADVANCES tab */}
      {tab === 'advances' && (
        <div className="space-y-3">
          {advances.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <TrendingDown size={36} className="mx-auto mb-2 opacity-30" />
              <p>لا توجد طلبات سلف</p>
            </div>
          ) : advances.map(adv => {
            const st = ADVANCE_STATUS[adv.status] ?? ADVANCE_STATUS.pending
            return (
              <div key={adv.id} className="bg-white border rounded-xl p-4 flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{adv.employee_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    <span className="font-bold text-orange-700">{adv.amount.toLocaleString()} ج.م</span>
                    {' '} — يُسدَّد على {adv.repay_months} شهر
                  </div>
                  {adv.reason && <div className="text-xs text-gray-400 mt-0.5">{adv.reason}</div>}
                  <div className="text-xs text-gray-400 mt-1">{adv.request_date}</div>
                </div>
                {adv.status === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => approveAdvMut.mutate(adv.id)}
                      className="p-1.5 bg-emerald-50 rounded-lg text-emerald-600 hover:bg-emerald-100">
                      <CheckCircle size={18} />
                    </button>
                    <button onClick={() => rejectAdvMut.mutate(adv.id)}
                      className="p-1.5 bg-red-50 rounded-lg text-red-600 hover:bg-red-100">
                      <XCircle size={18} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* LEAVES tab */}
      {tab === 'leaves' && (
        <div className="space-y-3">
          {leaves.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Clock size={36} className="mx-auto mb-2 opacity-30" />
              <p>لا توجد طلبات إجازة</p>
            </div>
          ) : leaves.map(lv => {
            const st = LEAVE_STATUS[lv.status] ?? LEAVE_STATUS.pending
            return (
              <div key={lv.id} className="bg-white border rounded-xl p-4 flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{lv.employee_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                    {lv.is_paid ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">مدفوعة</span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">بدون راتب</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    <span className="font-medium">{lv.leave_type_name}</span>
                    {' — '}{lv.days_count} يوم ({lv.start_date} → {lv.end_date})
                  </div>
                  {lv.reason && <div className="text-xs text-gray-400 mt-0.5">{lv.reason}</div>}
                </div>
                {lv.status === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => approveLeaveMut.mutate(lv.id)}
                      className="p-1.5 bg-emerald-50 rounded-lg text-emerald-600 hover:bg-emerald-100">
                      <CheckCircle size={18} />
                    </button>
                    <button onClick={() => rejectLeaveMut.mutate(lv.id)}
                      className="p-1.5 bg-red-50 rounded-lg text-red-600 hover:bg-red-100">
                      <XCircle size={18} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Advance Modal */}
      <Modal open={showAdvForm} onClose={() => setShowAdvForm(false)} title="طلب سلفة جديدة">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">الموظف <span className="text-red-500">*</span></label>
            <select value={advForm.employee_id} onChange={e => setAdvForm(f => ({...f, employee_id: e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
              <option value="">— اختر الموظف —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">المبلغ <span className="text-red-500">*</span></label>
              <input type="number" value={advForm.amount} onChange={e => setAdvForm(f => ({...f, amount: e.target.value}))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">عدد أشهر السداد</label>
              <input type="number" min="1" value={advForm.repay_months} onChange={e => setAdvForm(f => ({...f, repay_months: e.target.value}))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">تاريخ الطلب <span className="text-red-500">*</span></label>
            <input type="date" value={advForm.request_date} onChange={e => setAdvForm(f => ({...f, request_date: e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">السبب</label>
            <textarea value={advForm.reason} onChange={e => setAdvForm(f => ({...f, reason: e.target.value}))} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowAdvForm(false)}
              className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
            <button
              onClick={() => advForm.employee_id && advForm.amount && advForm.request_date && createAdvMut.mutate()}
              disabled={!advForm.employee_id || !advForm.amount || !advForm.request_date || createAdvMut.isPending}
              className="flex-1 bg-orange-600 text-white rounded-lg py-2 text-sm hover:bg-orange-700 disabled:opacity-50"
            >
              {createAdvMut.isPending ? 'جاري الحفظ...' : 'إرسال الطلب'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Leave Modal */}
      <Modal open={showLeaveForm} onClose={() => setShowLeaveForm(false)} title="طلب إجازة جديد">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">الموظف <span className="text-red-500">*</span></label>
            <select value={leaveForm.employee_id} onChange={e => setLeaveForm(f => ({...f, employee_id: e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— اختر الموظف —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">نوع الإجازة <span className="text-red-500">*</span></label>
            <select value={leaveForm.leave_type_id} onChange={e => setLeaveForm(f => ({...f, leave_type_id: e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— اختر النوع —</option>
              {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">من</label>
              <input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(f => ({...f, start_date: e.target.value}))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">إلى</label>
              <input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(f => ({...f, end_date: e.target.value}))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">عدد الأيام</label>
            <input type="number" min="1" value={leaveForm.days_count} onChange={e => setLeaveForm(f => ({...f, days_count: e.target.value}))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">السبب</label>
            <textarea value={leaveForm.reason} onChange={e => setLeaveForm(f => ({...f, reason: e.target.value}))} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowLeaveForm(false)}
              className="flex-1 border rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
            <button
              onClick={() => leaveForm.employee_id && leaveForm.leave_type_id && createLeaveMut.mutate()}
              disabled={!leaveForm.employee_id || !leaveForm.leave_type_id || createLeaveMut.isPending}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {createLeaveMut.isPending ? 'جاري الإرسال...' : 'إرسال الطلب'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
