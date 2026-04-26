import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, Plus, MapPin, Users,
  CheckCircle2, XCircle, Clock, AlertTriangle,
  CalendarIcon, Briefcase, Navigation, Loader2,
  Bell, Target, MoreHorizontal, Edit2, X,
} from 'lucide-react'
import {
  calendarApi,
  type CalendarEvent,
  type CalendarEventDetail,
  type CreateEventInput,
  type EventType,
  type EventStatus,
} from '../../api/calendar'
import Modal from '../../components/ui/Modal'

// ─────────────────────────────────────────────────────────────
// Config maps
// ─────────────────────────────────────────────────────────────
const EVENT_TYPE_CONFIG: Record<EventType, { label: string; color: string; dot: string; icon: React.ReactNode }> = {
  task:     { label: 'مهمة',     color: 'bg-blue-100 text-blue-700 border-blue-200',    dot: 'bg-blue-500',    icon: <Briefcase   className="h-3.5 w-3.5" /> },
  meeting:  { label: 'اجتماع',   color: 'bg-violet-100 text-violet-700 border-violet-200', dot: 'bg-violet-500', icon: <Users        className="h-3.5 w-3.5" /> },
  visit:    { label: 'زيارة',    color: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: <MapPin  className="h-3.5 w-3.5" /> },
  reminder: { label: 'تذكير',    color: 'bg-amber-100 text-amber-700 border-amber-200',  dot: 'bg-amber-500',   icon: <Bell        className="h-3.5 w-3.5" /> },
  other:    { label: 'أخرى',     color: 'bg-gray-100 text-gray-700 border-gray-200',    dot: 'bg-gray-400',    icon: <CalendarIcon className="h-3.5 w-3.5" /> },
}

const STATUS_CONFIG: Record<EventStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:     { label: 'قيد الانتظار', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: <Clock        className="h-3.5 w-3.5" /> },
  in_progress: { label: 'جاري',         color: 'bg-blue-100 text-blue-700 border-blue-200',      icon: <Loader2      className="h-3.5 w-3.5 animate-spin" /> },
  done:        { label: 'منتهي ✅',     color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  cancelled:   { label: 'ملغي',         color: 'bg-red-100 text-red-700 border-red-200',         icon: <XCircle      className="h-3.5 w-3.5" /> },
}

const PRIORITY_CONFIG = {
  low:    { label: 'منخفض',   color: 'text-gray-400' },
  normal: { label: 'عادي',    color: 'text-blue-500' },
  high:   { label: 'مرتفع',   color: 'text-orange-500' },
  urgent: { label: 'عاجل 🔴', color: 'text-red-600' },
}

const MONTH_NAMES_AR = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
]
const DAY_NAMES_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function formatTime(iso: string) {
  if (!iso.includes('T')) return ''
  const [, time] = iso.split('T')
  return time.slice(0, 5)
}
function localDatetimeInput(iso?: string) {
  if (!iso) {
    const n = new Date()
    n.setMinutes(n.getMinutes() - n.getTimezoneOffset())
    return n.toISOString().slice(0, 16)
  }
  return iso.slice(0, 16)
}

// ─────────────────────────────────────────────────────────────
// Create / Edit Event Modal
// ─────────────────────────────────────────────────────────────
function EventFormModal({
  initialDate,
  event,
  onClose,
}: {
  initialDate?: string
  event?: CalendarEventDetail
  onClose: () => void
}) {
  const qc     = useQueryClient()
  const isEdit = !!event

  const defaultStart = initialDate
    ? `${initialDate}T09:00`
    : localDatetimeInput()

  const [form, setForm] = useState<Partial<CreateEventInput>>({
    title:          event?.title        ?? '',
    event_type:     event?.event_type   ?? 'task',
    priority:       event?.priority     ?? 'normal',
    description:    event?.description  ?? '',
    start_datetime: event?.start_datetime ?? defaultStart,
    end_datetime:   event?.end_datetime  ?? '',
    all_day:        event?.all_day      ?? 0,
    location_name:  event?.location_name ?? '',
    location_lat:   event?.location_lat,
    location_lng:   event?.location_lng,
    location_tolerance_m: event?.location_tolerance_m ?? 150,
    color:          event?.color ?? '#3B82F6',
  })

  const [pickingGps, setPickingGps] = useState(false)
  const [gpsError, setGpsError] = useState('')

  const set = (k: keyof CreateEventInput, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }))

  const captureGps = () => {
    setPickingGps(true)
    setGpsError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        set('location_lat', parseFloat(pos.coords.latitude.toFixed(7)))
        set('location_lng', parseFloat(pos.coords.longitude.toFixed(7)))
        setPickingGps(false)
      },
      err => {
        setGpsError(err.code === 1 ? 'مرفوض — اسمح للمتصفح بالموقع' : 'تعذّر تحديد الموقع')
        setPickingGps(false)
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    )
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body: CreateEventInput = {
        title:          form.title!.trim(),
        event_type:     form.event_type,
        priority:       form.priority,
        description:    form.description || undefined,
        start_datetime: form.start_datetime!,
        end_datetime:   form.end_datetime || undefined,
        all_day:        form.all_day,
        location_name:  form.location_name || undefined,
        location_lat:   form.location_lat,
        location_lng:   form.location_lng,
        location_tolerance_m: form.location_tolerance_m,
        color:          form.color,
      }
      return isEdit
        ? calendarApi.updateEvent(event!.id, body)
        : calendarApi.createEvent(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      onClose()
    },
  })

  const hasLocation = !!(form.location_lat && form.location_lng)

  return (
    <Modal open title={isEdit ? 'تعديل الحدث' : 'إضافة حدث جديد'} onClose={onClose}>
      <div className="space-y-4 text-sm">

        {/* Title */}
        <div>
          <label className="block mb-1 text-gray-600 font-medium">العنوان *</label>
          <input
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            placeholder="عنوان المهمة أو الاجتماع…"
            autoFocus
          />
        </div>

        {/* Type + Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block mb-1 text-gray-600 font-medium">النوع</label>
            <select
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.event_type}
              onChange={e => set('event_type', e.target.value)}
            >
              {(Object.entries(EVENT_TYPE_CONFIG) as [EventType, {label: string}][]).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-1 text-gray-600 font-medium">الأولوية</label>
            <select
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.priority}
              onChange={e => set('priority', e.target.value)}
            >
              {(Object.entries(PRIORITY_CONFIG) as [string, {label: string}][]).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Start + End datetime */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block mb-1 text-gray-600 font-medium">تاريخ البداية *</label>
            <input
              type={form.all_day ? 'date' : 'datetime-local'}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.all_day ? form.start_datetime?.slice(0, 10) : form.start_datetime?.slice(0, 16)}
              onChange={e => set('start_datetime', form.all_day ? e.target.value : e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1 text-gray-600 font-medium">تاريخ النهاية</label>
            <input
              type={form.all_day ? 'date' : 'datetime-local'}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.all_day ? form.end_datetime?.slice(0, 10) : form.end_datetime?.slice(0, 16)}
              onChange={e => set('end_datetime', e.target.value)}
            />
          </div>
        </div>

        {/* All day toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="accent-green-600 h-4 w-4"
            checked={!!form.all_day}
            onChange={e => set('all_day', e.target.checked ? 1 : 0)}
          />
          <span className="text-gray-600">يوم كامل</span>
        </label>

        {/* Description */}
        <div>
          <label className="block mb-1 text-gray-600 font-medium">الوصف</label>
          <textarea
            rows={2}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="تفاصيل إضافية…"
          />
        </div>

        {/* Location section */}
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-gray-700 font-medium">
            <MapPin className="h-4 w-4 text-emerald-600" />
            موقع جغرافي (اختياري)
          </div>
          <input
            className="w-full border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            value={form.location_name}
            onChange={e => set('location_name', e.target.value)}
            placeholder="اسم الموقع — مثلاً: قاعة الاجتماع / حقل رقم 3"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={captureGps}
              disabled={pickingGps}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-white text-xs hover:bg-emerald-700 disabled:opacity-50"
            >
              {pickingGps ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
              {pickingGps ? 'جاري التحديد…' : 'تحديد موقعي الآن'}
            </button>
            {hasLocation && (
              <span className="text-xs text-emerald-700 font-medium">
                ✅ {form.location_lat?.toFixed(5)}, {form.location_lng?.toFixed(5)}
              </span>
            )}
            {gpsError && <span className="text-xs text-red-600">{gpsError}</span>}
          </div>
          {hasLocation && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">نطاق القبول (متر):</label>
              <input
                type="number"
                min={50} max={2000} step={50}
                className="w-24 border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                value={form.location_tolerance_m}
                onChange={e => set('location_tolerance_m', Number(e.target.value))}
              />
            </div>
          )}
        </div>

        {/* Color */}
        <div className="flex items-center gap-3">
          <label className="text-gray-600 font-medium">اللون:</label>
          {['#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#6B7280'].map(c => (
            <button
              key={c}
              type="button"
              onClick={() => set('color', c)}
              className={`h-6 w-6 rounded-full border-2 transition-transform ${form.color === c ? 'border-gray-900 scale-125' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {mutation.error && (
          <p className="text-red-600 text-xs">{(mutation.error as Error).message}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.title?.trim() || !form.start_datetime || mutation.isPending}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-white font-medium hover:bg-green-800 disabled:opacity-50"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? 'حفظ التعديلات' : 'إضافة'}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-gray-600 hover:bg-gray-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────
// Event Detail / Action Modal
// ─────────────────────────────────────────────────────────────
function EventDetailModal({
  eventId,
  onClose,
  onEdit,
}: {
  eventId: number
  onClose: () => void
  onEdit: (ev: CalendarEventDetail) => void
}) {
  const qc = useQueryClient()
  const { data: ev, isLoading } = useQuery({
    queryKey: ['calendar', 'event', eventId],
    queryFn:  () => calendarApi.getEvent(eventId),
  })

  const [arriveState, setArriveState] = useState<'idle'|'locating'|'done'|'error'>('idle')
  const [arriveResult, setArriveResult] = useState<{within_range:boolean;distance_m:number;tolerance_m:number;weak_signal:boolean}|null>(null)
  const [arriveErr, setArriveErr]       = useState('')

  const doneMut   = useMutation({ mutationFn: () => calendarApi.markDone(eventId),    onSuccess: () => { qc.invalidateQueries({ queryKey: ['calendar'] }); onClose() } })
  const cancelMut = useMutation({ mutationFn: () => calendarApi.cancelEvent(eventId), onSuccess: () => { qc.invalidateQueries({ queryKey: ['calendar'] }); onClose() } })

  const handleArrive = async () => {
    setArriveState('locating'); setArriveErr('')
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 })
      )
      const result = await calendarApi.arrive(eventId, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
      })
      setArriveResult(result)
      setArriveState('done')
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['calendar', 'event', eventId] })
    } catch (e: unknown) {
      if (e instanceof GeolocationPositionError) {
        setArriveErr(e.code === 1 ? 'مرفوض — اسمح للمتصفح' : 'تعذّر تحديد الموقع')
      } else {
        setArriveErr('حدث خطأ')
      }
      setArriveState('error')
    }
  }

  if (isLoading || !ev) {
    return (
      <Modal open title="تفاصيل الحدث" onClose={onClose}>
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </Modal>
    )
  }

  const typeCfg   = EVENT_TYPE_CONFIG[ev.event_type]
  const statusCfg = STATUS_CONFIG[ev.status]
  const priCfg    = PRIORITY_CONFIG[ev.priority ?? 'normal']
  const hasLocation = !!(ev.location_lat && ev.location_lng)
  const canArrive   = hasLocation && ev.status !== 'done' && ev.status !== 'cancelled'
  const canDone     = ev.status !== 'done' && ev.status !== 'cancelled'

  const dateStr = new Date(ev.start_datetime).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const timeStr = ev.all_day ? 'يوم كامل' : formatTime(ev.start_datetime)

  return (
    <Modal open title={ev.title} onClose={onClose}>
      <div className="space-y-4 text-sm">

        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${typeCfg.color}`}>
            {typeCfg.icon}{typeCfg.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusCfg.color}`}>
            {statusCfg.icon}{statusCfg.label}
          </span>
          <span className={`text-xs font-semibold ${priCfg.color}`}>
            {priCfg.label}
          </span>
        </div>

        {/* Date/time */}
        <div className="flex items-center gap-2 text-gray-700">
          <CalendarIcon className="h-4 w-4 text-gray-400" />
          <span>{dateStr}</span>
          {timeStr && <span className="text-gray-500">· {timeStr}</span>}
          {ev.end_datetime && <span className="text-gray-400">← {formatTime(ev.end_datetime)}</span>}
        </div>

        {/* Description */}
        {ev.description && (
          <p className="text-gray-600 bg-gray-50 rounded-lg p-3 leading-relaxed">{ev.description}</p>
        )}

        {/* Location */}
        {(hasLocation || ev.location_name) && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-1">
            <div className="flex items-center gap-2 text-emerald-700 font-medium">
              <MapPin className="h-4 w-4" />
              {ev.location_name ?? 'موقع جغرافي'}
            </div>
            {hasLocation && (
              <p className="text-xs text-emerald-600">
                {ev.location_lat?.toFixed(5)}, {ev.location_lng?.toFixed(5)}
                &nbsp;· نطاق {ev.location_tolerance_m} م
              </p>
            )}
            {ev.location_verified === 1 && ev.checkin_at && (
              <p className="text-xs text-emerald-700 font-medium">
                ✅ تم التحقق ·{' '}
                {ev.checkin_distance_m === 0
                  ? 'داخل الحدود الجغرافية'
                  : `المسافة: ${ev.checkin_distance_m} م`}
              </p>
            )}
          </div>
        )}

        {/* GPS Arrive result */}
        {arriveState === 'done' && arriveResult && (
          <div className={`rounded-lg border p-3 flex items-start gap-3 ${
            arriveResult.within_range ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
          }`}>
            {arriveResult.within_range
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            }
            <div>
              <p className={`font-semibold ${arriveResult.within_range ? 'text-emerald-700' : 'text-amber-700'}`}>
                {arriveResult.within_range ? '✅ داخل النطاق المقبول' : '⚠️ خارج النطاق المحدد'}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {arriveResult.distance_m === 0
                  ? 'داخل الحدود الجغرافية للقطعة ✅'
                  : `المسافة: ${arriveResult.distance_m} م · النطاق: ${arriveResult.tolerance_m} م`
                }
                {arriveResult.weak_signal && ' · إشارة GPS ضعيفة'}
              </p>
            </div>
          </div>
        )}
        {arriveState === 'error' && (
          <p className="text-red-600 text-xs">{arriveErr}</p>
        )}

        {/* Attendees */}
        {ev.attendees?.length > 0 && (
          <div>
            <p className="font-medium text-gray-700 mb-2 flex items-center gap-1">
              <Users className="h-4 w-4" /> الحاضرون ({ev.attendees.length})
            </p>
            <div className="space-y-1">
              {ev.attendees.map(a => (
                <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5">
                  <span className="text-gray-800">{a.user_name ?? a.employee_name ?? a.name ?? 'ضيف'}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    a.response === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                    a.response === 'declined' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {a.response === 'accepted' ? 'قبِل' : a.response === 'declined' ? 'رفض' : 'في الانتظار'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Assigned to */}
        {(ev.assigned_to_user_name || ev.assigned_to_employee_name) && (
          <p className="text-gray-600">
            <span className="font-medium">مُكلَّف لـ:</span>{' '}
            {ev.assigned_to_user_name ?? ev.assigned_to_employee_name}
          </p>
        )}

        <p className="text-xs text-gray-400">أنشئ بواسطة {ev.created_by_name}</p>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
          {canArrive && (
            <button
              onClick={handleArrive}
              disabled={arriveState === 'locating'}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {arriveState === 'locating'
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Navigation className="h-4 w-4" />
              }
              تسجيل الوصول
            </button>
          )}
          {canDone && (
            <button
              onClick={() => doneMut.mutate()}
              disabled={doneMut.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> تم الإنجاز
            </button>
          )}
          <button
            onClick={() => onEdit(ev)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-gray-700 text-sm hover:bg-gray-50"
          >
            <Edit2 className="h-4 w-4" /> تعديل
          </button>
          {ev.status !== 'cancelled' && ev.status !== 'done' && (
            <button
              onClick={() => cancelMut.mutate()}
              disabled={cancelMut.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-red-600 text-sm hover:bg-red-50 disabled:opacity-50"
            >
              <X className="h-4 w-4" /> إلغاء
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────
// Day Cell Events Popup
// ─────────────────────────────────────────────────────────────
function DayCellPopup({
  date,
  events,
  onEventClick,
  onCreateClick,
  onClose,
}: {
  date: string
  events: CalendarEvent[]
  onEventClick: (id: number) => void
  onCreateClick: (date: string) => void
  onClose: () => void
}) {
  const label = new Date(date + 'T12:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="font-semibold text-gray-900 text-sm">{label}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
          {events.map(ev => {
            const cfg = EVENT_TYPE_CONFIG[ev.event_type]
            return (
              <button
                key={ev.id}
                onClick={() => { onEventClick(ev.id); onClose() }}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-right"
              >
                <span className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${ev.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                    {ev.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500">{cfg.label}</span>
                    {!ev.all_day && <span className="text-xs text-gray-400">{formatTime(ev.start_datetime)}</span>}
                    {ev.location_lat && <MapPin className="h-3 w-3 text-emerald-500" />}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div className="px-4 py-3 border-t">
          <button
            onClick={() => { onCreateClick(date); onClose() }}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-white text-sm font-medium hover:bg-green-800"
          >
            <Plus className="h-4 w-4" /> إضافة حدث لهذا اليوم
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const today      = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())   // 0-indexed

  const [filterType, setFilterType] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  // Modal state
  const [createDate,   setCreateDate]   = useState<string | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEventDetail | null>(null)
  const [viewEventId,  setViewEventId]  = useState<number | null>(null)
  const [popupDate,    setPopupDate]    = useState<string | null>(null)

  // Date range for query
  const from = `${year}-${String(month+1).padStart(2,'0')}-01`
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const to   = `${year}-${String(month+1).padStart(2,'0')}-${daysInMonth}`

  const { data: events = [] } = useQuery({
    queryKey: ['calendar', 'events', year, month, filterType, filterStatus],
    queryFn:  () => calendarApi.getEvents({
      from, to,
      ...(filterType   ? { type:   filterType   as EventType }   : {}),
      ...(filterStatus ? { status: filterStatus as EventStatus } : {}),
    }),
  })

  // Build a lookup: dateStr → CalendarEvent[]
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of events) {
      const d = ev.start_datetime.slice(0, 10)
      if (!map.has(d)) map.set(d, [])
      map.get(d)!.push(ev)
    }
    return map
  }, [events])

  // Build calendar grid
  const firstDayOfWeek = new Date(year, month, 1).getDay()   // 0=Sun
  const totalCells = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7
  const cells: (number | null)[] = Array.from({ length: totalCells }, (_, i) => {
    const day = i - firstDayOfWeek + 1
    return day >= 1 && day <= daysInMonth ? day : null
  })

  const todayStr = toDateStr(today)

  const goPrev = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const goNext = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()) }

  const popupEvents = popupDate ? (eventsByDate.get(popupDate) ?? []) : []

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* ── Top Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b bg-white">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight className="h-5 w-5" /></button>
          <h2 className="text-lg font-bold text-gray-900 min-w-[140px] text-center">
            {MONTH_NAMES_AR[month]} {year}
          </h2>
          <button onClick={goNext} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft className="h-5 w-5" /></button>
          <button onClick={goToday} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">اليوم</button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">كل الأنواع</option>
            {(Object.entries(EVENT_TYPE_CONFIG) as [EventType, {label:string}][]).map(([k,v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">كل الحالات</option>
            {(Object.entries(STATUS_CONFIG) as [EventStatus, {label:string}][]).map(([k,v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button
            onClick={() => setCreateDate(todayStr)}
            className="flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-white text-sm font-medium hover:bg-green-800"
          >
            <Plus className="h-4 w-4" /> إضافة
          </button>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 border-b text-xs text-gray-600 flex-wrap">
        <span className="font-medium text-gray-800">{events.length} حدث هذا الشهر</span>
        {(Object.entries(EVENT_TYPE_CONFIG) as [EventType,{label:string;dot:string}][]).map(([k, cfg]) => {
          const count = events.filter(e => e.event_type === k).length
          if (!count) return null
          return (
            <span key={k} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
              {cfg.label}: {count}
            </span>
          )
        })}
      </div>

      {/* ── Calendar Grid ── */}
      <div className="flex-1 overflow-auto p-2">
        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_NAMES_AR.map(d => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-gray-500">{d}</div>
          ))}
        </div>

        {/* Date cells */}
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} className="min-h-[90px] bg-gray-50 rounded-lg opacity-30" />

            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const dayEvents = eventsByDate.get(dateStr) ?? []
            const isToday   = dateStr === todayStr
            const MAX_PILLS = 3

            return (
              <div
                key={idx}
                onClick={() => {
                  if (dayEvents.length > 0) setPopupDate(dateStr)
                  else setCreateDate(dateStr)
                }}
                className={`min-h-[90px] rounded-lg border p-1.5 cursor-pointer transition-colors hover:bg-green-50 hover:border-green-300 group ${
                  isToday
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-100 bg-white'
                }`}
              >
                {/* Day number */}
                <div className={`flex items-center justify-between mb-1`}>
                  <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-green-600 text-white' : 'text-gray-700'
                  }`}>
                    {day}
                  </span>
                  {dayEvents.length > 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); setCreateDate(dateStr) }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Plus className="h-3.5 w-3.5 text-gray-400 hover:text-green-600" />
                    </button>
                  )}
                </div>

                {/* Event pills */}
                <div className="space-y-0.5">
                  {dayEvents.slice(0, MAX_PILLS).map(ev => {
                    const cfg = EVENT_TYPE_CONFIG[ev.event_type]
                    return (
                      <button
                        key={ev.id}
                        onClick={e => { e.stopPropagation(); setViewEventId(ev.id) }}
                        title={ev.title}
                        className={`w-full flex items-center gap-1 rounded px-1.5 py-0.5 text-left ${cfg.color} border hover:opacity-80 transition-opacity`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                        <span className={`text-xs truncate flex-1 ${ev.status === 'done' ? 'line-through opacity-60' : ''}`}>
                          {!ev.all_day && <span className="font-mono mr-1">{formatTime(ev.start_datetime)}</span>}
                          {ev.title}
                        </span>
                        {ev.location_lat && <MapPin className="h-2.5 w-2.5 shrink-0 opacity-60" />}
                      </button>
                    )
                  })}
                  {dayEvents.length > MAX_PILLS && (
                    <button
                      onClick={e => { e.stopPropagation(); setPopupDate(dateStr) }}
                      className="text-xs text-gray-400 hover:text-gray-700 w-full text-right px-1"
                    >
                      <MoreHorizontal className="h-3 w-3 inline" /> +{dayEvents.length - MAX_PILLS} أكثر
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Upcoming Events Sidebar Strip ── */}
      <div className="border-t bg-white px-4 py-3">
        <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
          <Target className="h-3.5 w-3.5" /> الأحداث القادمة هذا الشهر
        </p>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {events
            .filter(e => e.status === 'pending' || e.status === 'in_progress')
            .slice(0, 8)
            .map(ev => {
              const cfg = EVENT_TYPE_CONFIG[ev.event_type]
              return (
                <button
                  key={ev.id}
                  onClick={() => setViewEventId(ev.id)}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-right hover:opacity-80 transition-opacity ${cfg.color}`}
                  style={{ minWidth: 160 }}
                >
                  <p className="text-xs font-semibold truncate max-w-[140px]">{ev.title}</p>
                  <p className="text-xs opacity-70 mt-0.5">
                    {new Date(ev.start_datetime + (ev.start_datetime.includes('T') ? '' : 'T00:00')).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                    {!ev.all_day && ` · ${formatTime(ev.start_datetime)}`}
                  </p>
                  {ev.location_name && (
                    <p className="text-xs opacity-60 mt-0.5 flex items-center gap-0.5 truncate">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />{ev.location_name}
                    </p>
                  )}
                </button>
              )
            })}
          {events.filter(e => e.status === 'pending' || e.status === 'in_progress').length === 0 && (
            <p className="text-xs text-gray-400 py-1">لا توجد أحداث قادمة هذا الشهر</p>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {(createDate || editingEvent) && (
        <EventFormModal
          initialDate={createDate ?? undefined}
          event={editingEvent ?? undefined}
          onClose={() => { setCreateDate(null); setEditingEvent(null) }}
        />
      )}

      {viewEventId && !editingEvent && (
        <EventDetailModal
          eventId={viewEventId}
          onClose={() => setViewEventId(null)}
          onEdit={ev => { setViewEventId(null); setEditingEvent(ev) }}
        />
      )}

      {popupDate && (
        <DayCellPopup
          date={popupDate}
          events={popupEvents}
          onEventClick={id => setViewEventId(id)}
          onCreateClick={d => setCreateDate(d)}
          onClose={() => setPopupDate(null)}
        />
      )}
    </div>
  )
}
