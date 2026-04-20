import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wrench, Plus, ChevronDown, Trash2, Clock, CheckCircle, XCircle, PlayCircle } from 'lucide-react'
import { operationsApi, fieldsApi, configApi, employeesApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import { usePermission } from '../../hooks/usePermission'

interface WorkOrder {
  id: number; code?: string; name: string; operation_type: string
  planned_date: string; actual_date?: string; status: string
  field_name?: string; season_name?: string; area_feddan?: number; notes?: string
}
interface WorkTask {
  id: number; task_date: string; description: string; employee_name?: string
  quantity?: number; unit?: string; unit_cost: number; total_cost: number; notes?: string
}
interface OrderDetail extends WorkOrder { tasks: WorkTask[]; total_cost: number }

const STATUS_LABELS: Record<string, string> = {
  pending: 'معلق', in_progress: 'جارٍ', done: 'منجز', cancelled: 'ملغى',
}
const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-yellow', in_progress: 'badge-blue', done: 'badge-green', cancelled: 'badge-red',
}
const STATUS_ICON: Record<string, React.ReactNode> = {
  pending:     <Clock      size={12} />,
  in_progress: <PlayCircle size={12} />,
  done:        <CheckCircle size={12} />,
  cancelled:   <XCircle   size={12} />,
}

const OP_TYPES = ['ري','تسميد','رش','حصاد','حراثة','زراعة','أخرى']
const STATUSES = ['pending','in_progress','done','cancelled']

export default function WorkOrdersPage() {
  const { canWrite } = usePermission()
  const qc = useQueryClient()
  const [filterStatus, setFilterStatus] = useState('')
  const [openNew, setOpenNew]           = useState(false)
  const [selectedId, setSelectedId]     = useState<number | null>(null)
  const [openTask, setOpenTask]         = useState(false)

  const [form, setForm]     = useState({ name:'', operation_type:'', planned_date:'', field_id:'', season_id:'', area_feddan:'', notes:'' })
  const [taskForm, setTF]   = useState({ task_date:'', description:'', employee_id:'', quantity:'', unit:'', unit_cost:'', notes:'' })
  const [err, setErr]       = useState('')

  const { data: ordersData, isLoading } = useQuery({
    queryKey: ['work-orders', filterStatus],
    queryFn:  () => operationsApi.listOrders({ status: filterStatus || undefined, size: 100 }),
  })
  const orders = ((ordersData as { data?: WorkOrder[] })?.data ?? []) as WorkOrder[]

  const { data: detail } = useQuery({
    queryKey: ['work-order', selectedId],
    queryFn:  () => operationsApi.getOrder(selectedId!),
    enabled:  !!selectedId,
  }) as { data?: OrderDetail }

  const { data: fields = [] }    = useQuery({ queryKey: ['fields'],    queryFn: () => fieldsApi.list() })
  const { data: seasons = [] }   = useQuery({ queryKey: ['seasons'],   queryFn: configApi.seasons })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  const createOrder = useMutation({
    mutationFn: () => operationsApi.createOrder({
      name:           form.name.trim(),
      operation_type: form.operation_type,
      planned_date:   form.planned_date,
      field_id:       form.field_id   ? Number(form.field_id)   : undefined,
      season_id:      form.season_id  ? Number(form.season_id)  : undefined,
      area_feddan:    form.area_feddan ? Number(form.area_feddan) : undefined,
      notes:          form.notes || undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr(res.error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      setOpenNew(false)
      setForm({ name:'', operation_type:'', planned_date:'', field_id:'', season_id:'', area_feddan:'', notes:'' })
      setErr('')
    },
  })

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      operationsApi.updateStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      qc.invalidateQueries({ queryKey: ['work-order', selectedId] })
    },
  })

  const addTask = useMutation({
    mutationFn: () => operationsApi.addTask(selectedId!, {
      task_date:   taskForm.task_date,
      description: taskForm.description.trim(),
      employee_id: taskForm.employee_id ? Number(taskForm.employee_id) : undefined,
      quantity:    taskForm.quantity   ? Number(taskForm.quantity)   : undefined,
      unit:        taskForm.unit       || undefined,
      unit_cost:   taskForm.unit_cost  ? Number(taskForm.unit_cost)  : 0,
      notes:       taskForm.notes      || undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr(res.error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['work-order', selectedId] })
      setOpenTask(false)
      setTF({ task_date:'', description:'', employee_id:'', quantity:'', unit:'', unit_cost:'', notes:'' })
    },
  })

  const deleteTask = useMutation({
    mutationFn: (id: number) => operationsApi.deleteTask(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['work-order', selectedId] }),
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wrench size={24} className="text-brand-600" />
          <h1 className="text-xl font-bold text-gray-900">أوامر العمل</h1>
          <span className="badge badge-blue">{orders.length} أمر</span>
        </div>
        {canWrite('operations') && (
          <button className="btn btn-primary" onClick={() => { setOpenNew(true); setErr('') }}>
            <Plus size={16} /> أمر عمل جديد
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="label mb-0">تصفية:</label>
        <select className="input w-48" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">جميع الحالات</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Orders list */}
        <div className="lg:col-span-1 space-y-3">
          {isLoading && <p className="text-gray-500 text-sm">جاري التحميل...</p>}
          {orders.map(o => (
            <div
              key={o.id}
              onClick={() => setSelectedId(o.id)}
              className={`card cursor-pointer hover:shadow-md transition-all ${selectedId === o.id ? 'ring-2 ring-brand-500' : ''}`}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="font-medium text-sm">{o.name}</span>
                <span className={`badge ${STATUS_BADGE[o.status]} flex items-center gap-1`}>
                  {STATUS_ICON[o.status]}{STATUS_LABELS[o.status]}
                </span>
              </div>
              <p className="text-xs text-gray-500">{o.operation_type} — {o.planned_date}</p>
              {o.field_name && <p className="text-xs text-brand-600 mt-1">{o.field_name}</p>}
            </div>
          ))}
          {!isLoading && orders.length === 0 && (
            <div className="card text-center text-gray-400 py-8">
              <Wrench size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد أوامر عمل</p>
            </div>
          )}
        </div>

        {/* Order detail */}
        <div className="lg:col-span-2">
          {!selectedId ? (
            <div className="card text-center text-gray-400 py-16">
              <ChevronDown size={32} className="mx-auto mb-3 opacity-30" />
              <p>اختر أمر عمل من القائمة</p>
            </div>
          ) : !detail ? (
            <p className="text-gray-500">جاري التحميل...</p>
          ) : (
            <div className="card space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold">{detail.name}</h2>
                  <p className="text-sm text-gray-500">{detail.operation_type} | {detail.planned_date}</p>
                  {detail.field_name && <p className="text-sm text-brand-600">{detail.field_name}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="input w-36 text-sm py-1"
                    value={detail.status}
                    onChange={e => changeStatus.mutate({ id: detail.id, status: e.target.value })}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <span className="font-semibold text-sm">المهام ({detail.tasks?.length ?? 0})</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">
                    إجمالي التكلفة: <strong className="text-brand-700">{Number(detail.total_cost).toLocaleString('ar-EG')} ج</strong>
                  </span>
                  {canWrite('operations') && (
                    <button
                      className="btn btn-outline text-sm py-1"
                      onClick={() => { setOpenTask(true); setErr('') }}
                    >
                      <Plus size={14} /> مهمة
                    </button>
                  )}
                </div>
              </div>

              {detail.tasks?.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">لا توجد مهام مسجلة</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="th">التاريخ</th>
                        <th className="th">الوصف</th>
                        <th className="th">الموظف</th>
                        <th className="th">الكمية</th>
                        <th className="th">التكلفة</th>
                        <th className="th"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.tasks.map(t => (
                        <tr key={t.id} className="border-b hover:bg-gray-50">
                          <td className="td">{t.task_date}</td>
                          <td className="td">{t.description}</td>
                          <td className="td text-gray-500">{t.employee_name ?? '—'}</td>
                          <td className="td">{t.quantity ? `${t.quantity} ${t.unit ?? ''}` : '—'}</td>
                          <td className="td text-brand-700 font-medium">{Number(t.total_cost).toLocaleString('ar-EG')} ج</td>
                          <td className="td">
                            <button
                              onClick={() => deleteTask.mutate(t.id)}
                              className="text-red-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detail.notes && (
                <p className="text-xs text-gray-500 border-t pt-2">{detail.notes}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* New Order Modal */}
      <Modal open={openNew} onClose={() => setOpenNew(false)} title="أمر عمل جديد" size="md">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">اسم الأمر *</label>
            <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="ري موسم القمح" />
          </div>
          <div>
            <label className="label">نوع العملية *</label>
            <select className="input" value={form.operation_type} onChange={e => setForm(p => ({ ...p, operation_type: e.target.value }))}>
              <option value="">— اختر —</option>
              {OP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">التاريخ المخطط *</label>
            <input className="input" type="date" value={form.planned_date} onChange={e => setForm(p => ({ ...p, planned_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">القطعة</label>
            <select className="input" value={form.field_id} onChange={e => setForm(p => ({ ...p, field_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(fields as { id: number; name: string }[]).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">الموسم</label>
            <select className="input" value={form.season_id} onChange={e => setForm(p => ({ ...p, season_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(seasons as { id: number; name: string }[]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">المساحة (فدان)</label>
            <input className="input" type="number" value={form.area_feddan} onChange={e => setForm(p => ({ ...p, area_feddan: e.target.value }))} />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOpenNew(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => createOrder.mutate()}
            disabled={createOrder.isPending || !form.name || !form.operation_type || !form.planned_date}
          >
            {createOrder.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </Modal>

      {/* Add Task Modal */}
      <Modal open={openTask} onClose={() => setOpenTask(false)} title="إضافة مهمة" size="md">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">التاريخ *</label>
            <input className="input" type="date" value={taskForm.task_date} onChange={e => setTF(p => ({ ...p, task_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">الموظف</label>
            <select className="input" value={taskForm.employee_id} onChange={e => setTF(p => ({ ...p, employee_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(employees as { id: number; name: string }[]).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">وصف المهمة *</label>
            <input className="input" value={taskForm.description} onChange={e => setTF(p => ({ ...p, description: e.target.value }))} placeholder="ري أرضية القطعة A01" />
          </div>
          <div>
            <label className="label">الكمية</label>
            <input className="input" type="number" value={taskForm.quantity} onChange={e => setTF(p => ({ ...p, quantity: e.target.value }))} />
          </div>
          <div>
            <label className="label">الوحدة</label>
            <input className="input" value={taskForm.unit} onChange={e => setTF(p => ({ ...p, unit: e.target.value }))} placeholder="ساعة / فدان" />
          </div>
          <div>
            <label className="label">سعر الوحدة</label>
            <input className="input" type="number" value={taskForm.unit_cost} onChange={e => setTF(p => ({ ...p, unit_cost: e.target.value }))} />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={taskForm.notes} onChange={e => setTF(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOpenTask(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => addTask.mutate()}
            disabled={addTask.isPending || !taskForm.task_date || !taskForm.description}
          >
            {addTask.isPending ? 'جاري الحفظ...' : 'إضافة'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
