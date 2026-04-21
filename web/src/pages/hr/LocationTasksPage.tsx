import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapPin, Plus, Calendar, User, Navigation,
  CheckCircle2, XCircle, Clock, AlertTriangle, Loader2, Target,
} from 'lucide-react'
import { hrApi, type LocationTask, type CreateLocationTaskInput } from '../../api/hr'
import { api, unwrap } from '../../api/client'
import Modal from '../../components/ui/Modal'

// ─────────────────────────────────────────────────────────────
// Status config
// ─────────────────────────────────────────────────────────────
const TASK_STATUS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: 'في الانتظار', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: <Clock className="h-3.5 w-3.5" /> },
  arrived:  { label: 'وصل ✅',       color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  outside:  { label: 'خارج النطاق ⚠️', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  missed:   { label: 'غاب',          color: 'bg-red-100 text-red-700 border-red-200', icon: <XCircle className="h-3.5 w-3.5" /> },
}

// ─────────────────────────────────────────────────────────────
// Arrival modal (الموظف يسجل وصوله)
// ─────────────────────────────────────────────────────────────
function ArrivalModal({ task, onClose }: { task: LocationTask; onClose: () => void }) {
  const qc = useQueryClient()
  const [state, setState] = useState<'idle' | 'locating' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ within_range: boolean; distance_m: number | null; weak_signal: boolean } | null>(null)
  const [errMsg, setErrMsg] = useState('')

  const handleArrive = async () => {
    setState('locating')
    setErrMsg('')
    let position: GeolocationPosition
    try {
      position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 15_000, maximumAge: 0,
        })
      )
    } catch (e: unknown) {
      setErrMsg(e instanceof GeolocationPositionError && e.code === 1
        ? 'تم رفض إذن الموقع — يرجى السماح للمتصفح'
        : 'تعذّر تحديد الموقع — تأكد من تشغيل GPS')
      setState('error'); return
    }
    const { latitude: lat, longitude: lng, accuracy } = position.coords
    try {
      const res = await hrApi.arriveAtTask(task.id, { lat, lng, accuracy_m: accuracy })
      setResult(res)
      setState('done')
      qc.invalidateQueries({ queryKey: ['location-tasks'] })
    } catch {
      setErrMsg('حدث خطأ أثناء تسجيل الوصول'); setState('error')
    }
  }

  return (
    <Modal open title="تسجيل الوصول" onClose={onClose}>
      <div className="space-y-4">
        {/* Task info */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-1 text-sm">
          <p className="font-medium text-gray-900">{task.field_name ?? task.custom_name ?? 'موقع مخصص'}</p>
          <p className="text-gray-500">الموظف: {task.employee_name}</p>
          <p className="text-gray-500">نطاق القبول: <strong>{task.tolerance_m} متر</strong></p>
          {task.task_notes && <p className="text-gray-600 italic">"{task.task_notes}"</p>}
        </div>

        {/* Result */}
        {state === 'done' && result && (
          <div className={`flex items-start gap-3 rounded-lg border p-4 ${
            result.within_range
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-amber-50 border-amber-200'
          }`}>
            {result.within_range
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            }
            <div>
              <p className={`font-semibold ${result.within_range ? 'text-emerald-700' : 'text-amber-700'}`}>
                {result.within_range ? 'تم تسجيل الوصول بنجاح ✅' : 'تم التسجيل — لكنك خارج النطاق ⚠️'}
              </p>
              {result.distance_m !== null && (
                <p className="text-sm text-gray-600 mt-0.5">
                  {result.distance_m === 0
                    ? 'داخل الحدود الجغرافية للقطعة ✅'
                    : <>المسافة الفعلية: <strong>{result.distance_m} م</strong>{!result.within_range && ` (النطاق المسموح: ${task.tolerance_m} م)`}</>
                  }
                </p>
              )}
              {result.weak_signal && (
                <p className="text-xs text-amber-600 mt-1">⚠️ إشارة GPS ضعيفة — حاول في مكان مكشوف للدقة</p>
              )}
            </div>
          </div>
        )}

        {state === 'error' && (
          <div className="flex items-start gap-3 rounded-lg border bg-red-50 border-red-200 p-4">
            <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{errMsg}</p>
          </div>
        )}

        {state !== 'done' && (
          <button
            onClick={handleArrive}
            disabled={state === 'locating'}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm
              bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {state === 'locating'
              ? <><Loader2 className="h-4 w-4 animate-spin" /> جاري تحديد موقعك...</>
              : <><Navigation className="h-4 w-4" /> تسجيل وصولي الآن</>
            }
          </button>
        )}
        {state === 'done' && (
          <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">
            إغلاق
          </button>
        )}
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────
// Assign Task Modal (المدير يُسند مهمة)
// ─────────────────────────────────────────────────────────────
function AssignTaskModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState<CreateLocationTaskInput>({
    employee_id: 0, task_date: today, tolerance_m: 150,
  })
  const [locMode, setLocMode] = useState<'field' | 'custom'>('field')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => unwrap(api.get<{id:number; name:string}[]>('/employees')),
  })

  const { data: fields } = useQuery({
    queryKey: ['fields'],
    queryFn: () => unwrap(api.get<{id:number; name:string; code:string; center_lat?:number; center_lng?:number}[]>('/fields')),
  })

  const handleSave = async () => {
    if (!form.employee_id || !form.task_date) { setErrMsg('الموظف والتاريخ مطلوبان'); return }
    if (locMode === 'field' && !form.field_id) { setErrMsg('اختر الحقل'); return }
    if (locMode === 'custom' && (form.custom_lat == null || form.custom_lng == null)) {
      setErrMsg('أدخل إحداثيات الموقع المخصص'); return
    }
    setSaving(true); setErrMsg('')
    try {
      await hrApi.createLocationTask(form)
      qc.invalidateQueries({ queryKey: ['location-tasks'] })
      onClose()
    } catch { setErrMsg('حدث خطأ أثناء الحفظ'); setSaving(false) }
  }

  const set = (k: keyof CreateLocationTaskInput, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal open title="إسناد مهمة زيارة موضع" onClose={onClose}>
      <div className="space-y-4">
        {/* Employee */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">الموظف</label>
          <select
            value={form.employee_id || ''}
            onChange={e => set('employee_id', Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          >
            <option value="">اختر الموظف...</option>
            {employees?.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ المهمة</label>
          <input
            type="date" value={form.task_date}
            onChange={e => set('task_date', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>

        {/* Location mode toggle */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">نوع الموضع</label>
          <div className="flex gap-2">
            {(['field', 'custom'] as const).map(m => (
              <button key={m}
                onClick={() => { setLocMode(m); set('field_id', undefined); set('custom_lat', undefined); set('custom_lng', undefined) }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  locMode === m
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {m === 'field' ? '🌾 حقل زراعي' : '📍 موقع مخصص'}
              </button>
            ))}
          </div>
        </div>

        {/* Field selector */}
        {locMode === 'field' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الحقل</label>
            <select
              value={form.field_id || ''}
              onChange={e => set('field_id', Number(e.target.value) || undefined)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            >
              <option value="">اختر الحقل...</option>
              {fields?.map(f => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                  {f.center_lat == null ? ' (بدون GPS)' : ''}
                </option>
              ))}
            </select>
            {fields?.find(f => f.id === form.field_id) && !fields.find(f => f.id === form.field_id)?.center_lat && (
              <p className="text-xs text-amber-600 mt-1">⚠️ هذا الحقل لا يملك إحداثيات GPS — لن يتم التحقق من المسافة</p>
            )}
          </div>
        )}

        {/* Custom location */}
        {locMode === 'custom' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">اسم الموقع</label>
              <input
                type="text" placeholder="مثال: مخزن الشمال"
                value={form.custom_name || ''}
                onChange={e => set('custom_name', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">خط العرض (lat)</label>
                <input
                  type="number" step="0.000001" placeholder="24.7136"
                  value={form.custom_lat || ''}
                  onChange={e => set('custom_lat', parseFloat(e.target.value) || undefined)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">خط الطول (lng)</label>
                <input
                  type="number" step="0.000001" placeholder="46.6753"
                  value={form.custom_lng || ''}
                  onChange={e => set('custom_lng', parseFloat(e.target.value) || undefined)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tolerance */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            نطاق القبول: <strong>{form.tolerance_m} متر</strong>
          </label>
          <input
            type="range" min={50} max={1000} step={25}
            value={form.tolerance_m ?? 150}
            onChange={e => set('tolerance_m', Number(e.target.value))}
            className="w-full accent-emerald-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>50م (دقيق)</span>
            <span>1000م (متساهل)</span>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات (اختياري)</label>
          <textarea
            rows={2} placeholder="تعليمات إضافية للموظف..."
            value={form.task_notes || ''}
            onChange={e => set('task_notes', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
          />
        </div>

        {errMsg && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{errMsg}</p>}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
            إلغاء
          </button>
          <button
            onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? 'جاري الحفظ...' : 'إسناد المهمة'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function LocationTasksPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [filterDate,   setFilterDate]   = useState(today)
  const [filterStatus, setFilterStatus] = useState('')
  const [showAssign,   setShowAssign]   = useState(false)
  const [arrivalTask,  setArrivalTask]  = useState<LocationTask | null>(null)

  const params: Record<string, string> = {}
  if (filterDate)   params.date   = filterDate
  if (filterStatus) params.status = filterStatus

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['location-tasks', filterDate, filterStatus],
    queryFn:  () => hrApi.getLocationTasks(params),
  })

  const qc = useQueryClient()
  const cancelMut = useMutation({
    mutationFn: hrApi.cancelLocationTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['location-tasks'] }),
  })

  // ── Summary counters ──
  const total   = tasks.length
  const arrived = tasks.filter(t => t.status === 'arrived').length
  const pending = tasks.filter(t => t.status === 'pending').length
  const outside = tasks.filter(t => t.status === 'outside').length

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="h-6 w-6 text-emerald-600" />
            مهام زيارة المواضع
          </h1>
          <p className="text-sm text-gray-500 mt-1">إسناد وتتبع زيارات الموظفين للحقول والمواقع</p>
        </div>
        <button
          onClick={() => setShowAssign(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-medium text-sm hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          إسناد مهمة جديدة
        </button>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'إجمالي',       value: total,   color: 'text-gray-700',   bg: 'bg-gray-50'     },
          { label: 'في الانتظار', value: pending, color: 'text-yellow-700', bg: 'bg-yellow-50'   },
          { label: 'وصلوا ✅',     value: arrived, color: 'text-emerald-700',bg: 'bg-emerald-50'  },
          { label: 'خارج النطاق', value: outside, color: 'text-amber-700',  bg: 'bg-amber-50'    },
        ].map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="date" value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">كل الحالات</option>
          <option value="pending">في الانتظار</option>
          <option value="arrived">وصل</option>
          <option value="outside">خارج النطاق</option>
          <option value="missed">غاب</option>
        </select>
      </div>

      {/* Tasks list */}
      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Target className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>لا توجد مهام لهذا اليوم</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => {
            const sc = TASK_STATUS[task.status]
            return (
              <div key={task.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  {/* Left info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${sc.color}`}>
                        {sc.icon}{sc.label}
                      </span>
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {task.field_name ? `🌾 ${task.field_name}` : `📍 ${task.custom_name ?? 'موقع مخصص'}`}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                      <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{task.employee_name}</span>
                      <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{task.task_date}</span>
                      <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />نطاق: {task.tolerance_m}م</span>
                      {task.distance_m != null && (
                        <span className="flex items-center gap-1 font-medium">
                          <Navigation className="h-3.5 w-3.5" />
                          {task.distance_m}م {task.status === 'outside' ? '⚠️' : ''}
                        </span>
                      )}
                    </div>

                    {task.task_notes && (
                      <p className="mt-1 text-xs text-gray-500 italic">"{task.task_notes}"</p>
                    )}
                    {task.arrived_at && (
                      <p className="mt-1 text-xs text-gray-400">
                        وصل: {new Date(task.arrived_at).toLocaleTimeString('ar-SA')}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 shrink-0">
                    {task.status === 'pending' && (
                      <>
                        <button
                          onClick={() => setArrivalTask(task)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                        >
                          <Navigation className="h-3.5 w-3.5" />
                          تسجيل وصول
                        </button>
                        <button
                          onClick={() => cancelMut.mutate(task.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50"
                        >
                          إلغاء
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showAssign && <AssignTaskModal onClose={() => setShowAssign(false)} />}
      {arrivalTask && <ArrivalModal task={arrivalTask} onClose={() => setArrivalTask(null)} />}
    </div>
  )
}
