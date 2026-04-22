import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Wrench, Plus, Trash2, Clock, PlayCircle, CheckCircle, DollarSign,
  XCircle, Leaf, Package, Users, TrendingUp, ChevronRight, ArrowLeft,
} from 'lucide-react'
import { operationsApi, fieldsApi, configApi, employeesApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import SidePanel from '../../components/ui/SidePanel'
import { usePermission } from '../../hooks/usePermission'

// ── Types ────────────────────────────────────────────────────
interface WorkOrder {
  id: number; code?: string; name: string; operation_type: string
  planned_date: string; actual_date?: string
  status: 'pending' | 'in_progress' | 'done' | 'costed' | 'cancelled'
  field_name?: string; field_id?: number; season_name?: string
  area_feddan?: number; notes?: string
  labor_cost?: number; inventory_cost?: number
}
interface WorkTask {
  id: number; task_date: string; description: string; employee_name?: string
  quantity?: number; unit?: string; unit_cost: number; total_cost: number; notes?: string
}
interface InventoryLine {
  item_code: number; item_name?: string; unit?: string
  qty_consumed: number; cost_consumed: number; movement_count: number
}
interface OrderDetail extends WorkOrder {
  tasks: WorkTask[]
  inventory: InventoryLine[]
  labor_cost: number
  inventory_cost: number
  total_cost: number
}

// ── Constants ────────────────────────────────────────────────
const OP_TYPES = ['ري', 'تسميد', 'رش', 'حصاد', 'حراثة', 'زراعة', 'أخرى']

const LIFECYCLE: { key: WorkOrder['status']; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'pending',     label: 'معلق',       icon: <Clock        size={14} />, color: 'text-amber-600  bg-amber-50  border-amber-200'  },
  { key: 'in_progress', label: 'جارٍ',        icon: <PlayCircle   size={14} />, color: 'text-blue-600   bg-blue-50   border-blue-200'   },
  { key: 'done',        label: 'منجز',        icon: <CheckCircle  size={14} />, color: 'text-emerald-600 bg-emerald-50 border-emerald-200'},
  { key: 'costed',      label: 'مُسعَّر',     icon: <DollarSign   size={14} />, color: 'text-brand-600  bg-brand-50  border-brand-200'  },
]

const NEXT_ACTION: Partial<Record<WorkOrder['status'], { label: string; icon: React.ReactNode; cls: string; next: WorkOrder['status'] }>> = {
  pending:     { label: 'بدء التنفيذ',     icon: <PlayCircle  size={15} />, cls: 'bg-blue-600 hover:bg-blue-700 text-white',    next: 'in_progress' },
  in_progress: { label: 'إتمام العملية',    icon: <CheckCircle size={15} />, cls: 'bg-emerald-600 hover:bg-emerald-700 text-white', next: 'done'       },
  done:        { label: 'إغلاق وتسعير',    icon: <DollarSign  size={15} />, cls: 'bg-brand-600 hover:bg-brand-700 text-white',   next: 'costed'     },
}

function egp(n: number | null | undefined) {
  if (!n) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function num(n: number | null | undefined, dp = 2) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: dp }).format(n)
}

// ── Lifecycle Stepper ────────────────────────────────────────
function LifecycleStepper({ status }: { status: WorkOrder['status'] }) {
  const stages = LIFECYCLE.filter(s => s.key !== 'cancelled')
  const currentIdx = stages.findIndex(s => s.key === status)

  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 text-red-600 text-sm font-medium">
        <XCircle size={16} /> ملغى
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1" dir="ltr">
      {stages.map((s, i) => {
        const isDone    = i < currentIdx
        const isCurrent = i === currentIdx
        return (
          <div key={s.key} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              isCurrent ? s.color + ' shadow-sm ring-1 ring-current/20' :
              isDone    ? 'text-slate-400 bg-slate-50 border-slate-200' :
                          'text-slate-300 bg-white border-slate-100'
            }`}>
              {s.icon}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < stages.length - 1 && (
              <ArrowLeft size={12} className={`mx-0.5 ${i < currentIdx ? 'text-slate-400' : 'text-slate-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Status Badge (compact) ────────────────────────────────────
function StatusBadge({ status }: { status: WorkOrder['status'] }) {
  const s = status === 'cancelled'
    ? { label: 'ملغى', color: 'text-red-600 bg-red-50 border-red-200' }
    : LIFECYCLE.find(l => l.key === status) ?? LIFECYCLE[0]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${s.color}`}>
      {s.label}
    </span>
  )
}

// ── Cost Breakdown ────────────────────────────────────────────
function CostBreakdown({ detail }: { detail: OrderDetail }) {
  const [tab, setTab] = useState<'labor' | 'inventory'>('labor')
  const grandTotal    = detail.total_cost
  const costPerFeddan = detail.area_feddan && detail.area_feddan > 0
    ? grandTotal / detail.area_feddan : null

  return (
    <div className="space-y-3">
      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 text-center">
          <p className="text-xs text-slate-400 mb-0.5">عمالة</p>
          <p className="text-sm font-bold text-slate-700">{egp(detail.labor_cost)}</p>
        </div>
        <div className="rounded-xl bg-orange-50 border border-orange-100 px-3 py-2.5 text-center">
          <p className="text-xs text-orange-500 mb-0.5">مدخلات</p>
          <p className="text-sm font-bold text-orange-700">{egp(detail.inventory_cost)}</p>
        </div>
        <div className="rounded-xl bg-brand-50 border border-brand-200 px-3 py-2.5 text-center">
          <p className="text-xs text-brand-500 mb-0.5">الإجمالي</p>
          <p className="text-sm font-bold text-brand-700">{egp(grandTotal)}</p>
        </div>
      </div>

      {costPerFeddan != null && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2.5">
          <TrendingUp size={14} className="text-emerald-600 shrink-0" />
          <span className="text-sm text-emerald-700">
            تكلفة الفدان:
            <strong className="mr-1">{egp(costPerFeddan)}</strong>
            <span className="text-emerald-500 text-xs">/ {num(detail.area_feddan, 1)} فدان</span>
          </span>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {([
          { k: 'labor' as const,     l: 'العمالة',     icon: <Users    size={12} /> },
          { k: 'inventory' as const, l: 'المدخلات',    icon: <Package  size={12} /> },
        ]).map(({ k, l, icon }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-all ${
              tab === k ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {icon}{l}
          </button>
        ))}
      </div>

      {/* Labor tab */}
      {tab === 'labor' && (
        detail.tasks.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">لا توجد مهام عمالة مسجلة</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {['التاريخ','الوصف','الموظف','الكمية','التكلفة',''].map(h => (
                    <th key={h} className="py-2 px-3 text-right text-slate-500 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.tasks.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-500">{t.task_date}</td>
                    <td className="py-2 px-3 font-medium">{t.description}</td>
                    <td className="py-2 px-3 text-slate-500">{t.employee_name ?? '—'}</td>
                    <td className="py-2 px-3">{t.quantity ? `${num(t.quantity, 1)} ${t.unit ?? ''}` : '—'}</td>
                    <td className="py-2 px-3 font-bold text-brand-700">{egp(t.total_cost)}</td>
                    <td className="py-2 px-3">
                      <DeleteTaskBtn taskId={t.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td colSpan={4} className="py-2 px-3 font-semibold text-slate-600">الإجمالي</td>
                  <td className="py-2 px-3 font-bold text-brand-700">{egp(detail.labor_cost)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {/* Inventory tab */}
      {tab === 'inventory' && (
        detail.inventory.length === 0 ? (
          <div className="text-center py-6 space-y-1">
            <Package size={28} className="mx-auto text-slate-300" />
            <p className="text-sm text-slate-400">لا توجد مدخلات مخزنية مرتبطة</p>
            <p className="text-xs text-slate-300">اربط حركات الصرف بهذا الأمر عند إنشاء حركة مخزنية</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {['الصنف','الوحدة','الكمية المُصرفة','التكلفة'].map(h => (
                    <th key={h} className="py-2 px-3 text-right text-slate-500 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.inventory.map(inv => (
                  <tr key={inv.item_code} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium">{inv.item_name ?? `#${inv.item_code}`}</td>
                    <td className="py-2 px-3 text-slate-500">{inv.unit ?? '—'}</td>
                    <td className="py-2 px-3">{num(inv.qty_consumed)}</td>
                    <td className="py-2 px-3 font-bold text-orange-700">{egp(inv.cost_consumed)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td colSpan={3} className="py-2 px-3 font-semibold text-slate-600">الإجمالي</td>
                  <td className="py-2 px-3 font-bold text-orange-700">{egp(detail.inventory_cost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  )
}

// ── Delete Task Button (needs qc inside) ─────────────────────
function DeleteTaskBtn({ taskId }: { taskId: number }) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () => operationsApi.deleteTask(taskId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['work-order'] }),
  })
  return (
    <button
      onClick={() => del.mutate()}
      className="p-1 text-red-300 hover:text-red-500 transition-colors rounded"
      title="حذف المهمة"
    >
      <Trash2 size={12} />
    </button>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function WorkOrdersPage() {
  const { canWrite } = usePermission()
  const qc = useQueryClient()

  const [filterStatus, setFilterStatus] = useState('')
  const [selectedId,   setSelectedId]   = useState<number | null>(null)
  const [panelOpen,    setPanelOpen]     = useState(false)
  const [openNew,      setOpenNew]       = useState(false)
  const [openTask,     setOpenTask]      = useState(false)
  const [confirmCosted, setConfirmCosted] = useState(false)
  const [actualDate,   setActualDate]    = useState('')
  const [err, setErr] = useState('')

  const [form, setForm] = useState({
    name: '', operation_type: '', planned_date: '', field_id: '', season_id: '', area_feddan: '', notes: '',
  })
  const [taskForm, setTF] = useState({
    task_date: '', description: '', employee_id: '', quantity: '', unit: '', unit_cost: '', notes: '',
  })

  // ── Queries ─────────────────────────────────────────────────
  const { data: ordersData, isLoading } = useQuery({
    queryKey: ['work-orders', filterStatus],
    queryFn:  () => operationsApi.listOrders({ status: filterStatus || undefined, size: 100 }),
  })
  const orders = ((ordersData as { data?: WorkOrder[] })?.data ?? []) as WorkOrder[]

  const { data: rawDetail } = useQuery({
    queryKey: ['work-order', selectedId],
    queryFn:  () => operationsApi.getOrder(selectedId!),
    enabled:  !!selectedId,
  })
  const detail = rawDetail as OrderDetail | undefined

  const { data: fields = []    } = useQuery({ queryKey: ['fields'],    queryFn: () => fieldsApi.list()    })
  const { data: seasons = []   } = useQuery({ queryKey: ['seasons'],   queryFn: configApi.seasons        })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })

  // ── Mutations ────────────────────────────────────────────────
  const createOrder = useMutation({
    mutationFn: () => operationsApi.createOrder({
      name:           form.name.trim(),
      operation_type: form.operation_type,
      planned_date:   form.planned_date,
      field_id:       form.field_id    ? Number(form.field_id)    : undefined,
      season_id:      form.season_id   ? Number(form.season_id)   : undefined,
      area_feddan:    form.area_feddan ? Number(form.area_feddan) : undefined,
      notes:          form.notes || undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr((res as { error?: string }).error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      setOpenNew(false)
      setForm({ name: '', operation_type: '', planned_date: '', field_id: '', season_id: '', area_feddan: '', notes: '' })
      setErr('')
    },
  })

  const changeStatus = useMutation({
    mutationFn: ({ id, status, actual_date }: { id: number; status: string; actual_date?: string }) =>
      operationsApi.updateStatus(id, status, actual_date),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!(res as { success: boolean }).success) { setErr((res as { error?: string }).error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      qc.invalidateQueries({ queryKey: ['work-order', selectedId] })
      setConfirmCosted(false)
      setActualDate('')
    },
  })

  const addTask = useMutation({
    mutationFn: () => operationsApi.addTask(selectedId!, {
      task_date:   taskForm.task_date,
      description: taskForm.description.trim(),
      employee_id: taskForm.employee_id ? Number(taskForm.employee_id) : undefined,
      quantity:    taskForm.quantity    ? Number(taskForm.quantity)    : undefined,
      unit:        taskForm.unit        || undefined,
      unit_cost:   taskForm.unit_cost   ? Number(taskForm.unit_cost)  : 0,
      notes:       taskForm.notes       || undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!(res as { success: boolean }).success) { setErr((res as { error?: string }).error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['work-order', selectedId] })
      setOpenTask(false)
      setTF({ task_date: '', description: '', employee_id: '', quantity: '', unit: '', unit_cost: '', notes: '' })
    },
  })

  const handleTransition = (order: WorkOrder) => {
    const action = NEXT_ACTION[order.status]
    if (!action) return
    if (action.next === 'costed') {
      setConfirmCosted(true)
      setActualDate(new Date().toISOString().slice(0, 10))
    } else {
      changeStatus.mutate({
        id: order.id, status: action.next,
        actual_date: action.next === 'done' ? new Date().toISOString().slice(0, 10) : undefined,
      })
    }
  }

  const openDetail = (id: number) => {
    setSelectedId(id)
    setPanelOpen(true)
  }

  const statusCounts = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <h1 className="page-title">أوامر العمل الزراعية</h1>
          <span className="badge badge-blue">{orders.length} أمر</span>
        </div>
        {canWrite('operations') && (
          <button className="btn-primary gap-2" onClick={() => { setOpenNew(true); setErr('') }}>
            <Plus size={16} /> أمر عمل جديد
          </button>
        )}
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setFilterStatus('')}
            className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
              filterStatus === '' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            الكل ({orders.length})
          </button>
          {LIFECYCLE.map(s => (
            <button
              key={s.key}
              onClick={() => setFilterStatus(filterStatus === s.key ? '' : s.key)}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                filterStatus === s.key ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {s.icon}
              {s.label}
              {statusCounts[s.key] ? <span className="opacity-60">({statusCounts[s.key]})</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* Orders grid */}
      {isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="card p-16 text-center">
          <Wrench size={40} className="mx-auto mb-3 text-slate-200" />
          <p className="text-slate-500 font-medium">لا توجد أوامر عمل</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {orders.map(order => {
            const action    = NEXT_ACTION[order.status]
            const totalCost = (order.labor_cost ?? 0) + (order.inventory_cost ?? 0)
            return (
              <div
                key={order.id}
                className="card hover:shadow-md transition-all cursor-pointer"
                onClick={() => openDetail(order.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-semibold text-slate-800 truncate">{order.name}</span>
                      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
                        {order.operation_type}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      {order.field_name && (
                        <span className="flex items-center gap-1 text-brand-600">
                          <Leaf size={11} />{order.field_name}
                        </span>
                      )}
                      <span>{order.planned_date}</span>
                      {order.area_feddan && <span>{num(order.area_feddan, 1)} فدان</span>}
                      {totalCost > 0 && (
                        <span className="flex items-center gap-1 text-brand-700 font-medium">
                          <TrendingUp size={11} />{egp(totalCost)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: status + action */}
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={order.status} />
                    {action && canWrite('operations') && (
                      <button
                        onClick={e => { e.stopPropagation(); handleTransition(order) }}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${action.cls}`}
                        disabled={changeStatus.isPending}
                      >
                        {action.icon}
                        <span className="hidden sm:inline">{action.label}</span>
                      </button>
                    )}
                    <ChevronRight size={16} className="text-slate-300" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Detail Side Panel ──────────────────────────────── */}
      <SidePanel
        open={panelOpen && !!selectedId}
        title={detail?.name ?? '...'}
        subtitle={detail ? `${detail.operation_type} | ${detail.planned_date}` : ''}
        onClose={() => { setPanelOpen(false); setSelectedId(null) }}
        width="520px"
      >
        {!detail ? (
          <div className="p-8 text-center text-slate-400">جاري التحميل...</div>
        ) : (
          <div className="p-5 space-y-5">

            {/* Lifecycle stepper */}
            <LifecycleStepper status={detail.status} />

            {/* Meta info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {detail.field_name && (
                <div className="flex items-center gap-2 col-span-2">
                  <Leaf size={14} className="text-brand-500 shrink-0" />
                  <span className="text-brand-700 font-medium">{detail.field_name}</span>
                  {detail.area_feddan && (
                    <span className="text-slate-400 text-xs">({num(detail.area_feddan, 1)} فدان)</span>
                  )}
                </div>
              )}
              {detail.season_name && (
                <div className="text-slate-500 text-xs">
                  الموسم: <span className="text-slate-700 font-medium">{detail.season_name}</span>
                </div>
              )}
              {detail.actual_date && (
                <div className="text-slate-500 text-xs">
                  تاريخ التنفيذ: <span className="text-slate-700 font-medium">{detail.actual_date}</span>
                </div>
              )}
              {detail.notes && (
                <div className="col-span-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                  {detail.notes}
                </div>
              )}
            </div>

            {/* Action button */}
            {(() => {
              const action = NEXT_ACTION[detail.status]
              if (!action || !canWrite('operations')) return null
              return (
                <button
                  onClick={() => handleTransition(detail)}
                  disabled={changeStatus.isPending}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all ${action.cls}`}
                >
                  {action.icon}
                  {changeStatus.isPending ? 'جاري الحفظ...' : action.label}
                </button>
              )
            })()}

            {/* Cancel button (if not terminal) */}
            {!['costed', 'cancelled'].includes(detail.status) && canWrite('operations') && (
              <button
                onClick={() => changeStatus.mutate({ id: detail.id, status: 'cancelled' })}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs text-red-500 hover:bg-red-50 transition-colors border border-red-100"
              >
                <XCircle size={13} /> إلغاء أمر العمل
              </button>
            )}

            {/* Add task button */}
            {!['costed', 'cancelled'].includes(detail.status) && canWrite('operations') && (
              <button
                onClick={() => { setOpenTask(true); setErr('') }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs text-slate-600 hover:bg-slate-100 transition-colors border border-slate-200"
              >
                <Plus size={13} /> إضافة مهمة عمالة
              </button>
            )}

            {/* Cost breakdown */}
            <CostBreakdown detail={detail} />
          </div>
        )}
      </SidePanel>

      {/* ── Confirm Costed Modal ──────────────────────────── */}
      <Modal open={confirmCosted} title="إغلاق وتسعير أمر العمل" onClose={() => setConfirmCosted(false)} size="sm">
        <div className="space-y-4">
          <div className="rounded-xl bg-brand-50 border border-brand-100 p-4 text-sm text-brand-700">
            <p className="font-semibold mb-1">⚠ هذا الإجراء نهائي</p>
            <p>بعد التسعير لن تتمكن من تعديل الحالة أو إضافة مهام جديدة.</p>
          </div>
          {detail && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">تكلفة العمالة</span>
                <span className="font-medium">{egp(detail.labor_cost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">تكلفة المدخلات</span>
                <span className="font-medium">{egp(detail.inventory_cost)}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="font-bold">الإجمالي</span>
                <span className="font-bold text-brand-700">{egp(detail.total_cost)}</span>
              </div>
            </div>
          )}
          <div>
            <label className="label text-xs">تاريخ الإتمام الفعلي</label>
            <input type="date" className="input" value={actualDate}
              onChange={e => setActualDate(e.target.value)} />
          </div>
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setConfirmCosted(false)}>إلغاء</button>
            <button
              className="btn-primary flex-1 gap-2"
              disabled={changeStatus.isPending || !actualDate}
              onClick={() => selectedId && changeStatus.mutate({ id: selectedId, status: 'costed', actual_date: actualDate })}
            >
              <DollarSign size={14} />
              {changeStatus.isPending ? 'جاري...' : 'تأكيد الإغلاق'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── New Order Modal ────────────────────────────────── */}
      <Modal open={openNew} onClose={() => setOpenNew(false)} title="أمر عمل جديد" size="md">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">اسم الأمر <span className="text-red-500">*</span></label>
            <input className="input" value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="ري موسم القمح — القطعة A01" />
          </div>
          <div>
            <label className="label">نوع العملية <span className="text-red-500">*</span></label>
            <select className="input" value={form.operation_type}
              onChange={e => setForm(p => ({ ...p, operation_type: e.target.value }))}>
              <option value="">— اختر —</option>
              {OP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">التاريخ المخطط <span className="text-red-500">*</span></label>
            <input className="input" type="date" value={form.planned_date}
              onChange={e => setForm(p => ({ ...p, planned_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">القطعة / الحقل</label>
            <select className="input" value={form.field_id}
              onChange={e => setForm(p => ({ ...p, field_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(fields as { id: number; name: string; area_feddan: number }[]).map(f => (
                <option key={f.id} value={f.id}>{f.name} ({f.area_feddan} فدان)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">الموسم</label>
            <select className="input" value={form.season_id}
              onChange={e => setForm(p => ({ ...p, season_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(seasons as { id: number; name: string }[]).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">المساحة (فدان)</label>
            <input className="input" type="number" min="0" step="0.01"
              value={form.area_feddan}
              onChange={e => setForm(p => ({ ...p, area_feddan: e.target.value }))} />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={() => setOpenNew(false)}>إلغاء</button>
          <button
            className="btn-primary"
            onClick={() => createOrder.mutate()}
            disabled={createOrder.isPending || !form.name || !form.operation_type || !form.planned_date}
          >
            {createOrder.isPending ? 'جاري الحفظ...' : 'إنشاء أمر العمل'}
          </button>
        </div>
      </Modal>

      {/* ── Add Task Modal ─────────────────────────────────── */}
      <Modal open={openTask} onClose={() => setOpenTask(false)} title="إضافة مهمة عمالة" size="md">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">التاريخ <span className="text-red-500">*</span></label>
            <input className="input" type="date" value={taskForm.task_date}
              onChange={e => setTF(p => ({ ...p, task_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">الموظف</label>
            <select className="input" value={taskForm.employee_id}
              onChange={e => setTF(p => ({ ...p, employee_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(employees as { id: number; name: string }[]).map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">وصف المهمة <span className="text-red-500">*</span></label>
            <input className="input" value={taskForm.description}
              onChange={e => setTF(p => ({ ...p, description: e.target.value }))}
              placeholder="ري أرضية القطعة" />
          </div>
          <div>
            <label className="label">الكمية</label>
            <input className="input" type="number" min="0" step="any"
              value={taskForm.quantity}
              onChange={e => setTF(p => ({ ...p, quantity: e.target.value }))} />
          </div>
          <div>
            <label className="label">الوحدة</label>
            <input className="input" value={taskForm.unit}
              onChange={e => setTF(p => ({ ...p, unit: e.target.value }))}
              placeholder="ساعة / فدان" />
          </div>
          <div>
            <label className="label">سعر الوحدة (ج.م)</label>
            <input className="input" type="number" min="0" step="0.01"
              value={taskForm.unit_cost}
              onChange={e => setTF(p => ({ ...p, unit_cost: e.target.value }))} />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={taskForm.notes}
              onChange={e => setTF(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={() => setOpenTask(false)}>إلغاء</button>
          <button
            className="btn-primary"
            onClick={() => addTask.mutate()}
            disabled={addTask.isPending || !taskForm.task_date || !taskForm.description}
          >
            {addTask.isPending ? 'جاري الحفظ...' : 'إضافة المهمة'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
