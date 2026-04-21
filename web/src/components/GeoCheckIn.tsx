import { useState, useCallback } from 'react'
import { MapPin, Wifi, WifiOff, AlertTriangle, CheckCircle2, Loader2, Navigation } from 'lucide-react'
import { api } from '../api/client'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface GeoResult {
  location_status: 'onsite' | 'field' | 'unverified'
  distance_m: number | null
  accuracy_m: number
  weak_signal: boolean
}

interface Props {
  employeeId: number
  workDate: string   // YYYY-MM-DD
  fieldId?: number   // اختياري — تسجيل حضور مرتبط بحقل
  onSuccess?: (result: GeoResult) => void
  compact?: boolean  // نسخة مضغوطة للاستخدام ضمن صفحات أخرى
}

// ─────────────────────────────────────────────────────────────
// Haversine (للعرض فقط — الحساب الحقيقي في الـ backend)
// ─────────────────────────────────────────────────────────────
type CheckInState = 'idle' | 'locating' | 'sending' | 'done' | 'error'

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  onsite:     { label: 'داخل النطاق ✅',     color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  field:      { label: 'في الحقل — خارج الفرع 🌾', color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' },
  unverified: { label: 'غير محدد الموقع ⚠️', color: 'text-gray-600',    bg: 'bg-gray-50 border-gray-200' },
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function GeoCheckIn({ employeeId, workDate, fieldId, onSuccess, compact }: Props) {
  const [state,    setState]    = useState<CheckInState>('idle')
  const [result,   setResult]   = useState<GeoResult | null>(null)
  const [errMsg,   setErrMsg]   = useState('')
  const [accuracy, setAccuracy] = useState<number | null>(null)

  const handleCheckIn = useCallback(async () => {
    setState('locating')
    setErrMsg('')
    setResult(null)

    // 1. اقرأ GPS من المتصفح
    let position: GeolocationPosition
    try {
      position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 0,
        })
      })
    } catch (err: unknown) {
      const msg = err instanceof GeolocationPositionError
        ? (err.code === 1 ? 'تم رفض إذن الموقع — يرجى السماح للمتصفح بالوصول للموقع'
           : err.code === 2 ? 'تعذّر تحديد الموقع — تأكد من تشغيل GPS'
           : 'انتهت مهلة تحديد الموقع — حاول في مكان مكشوف')
        : 'خطأ في تحديد الموقع'
      setErrMsg(msg)
      setState('error')
      return
    }

    const { latitude: lat, longitude: lng, accuracy: acc } = position.coords
    setAccuracy(Math.round(acc))

    // 2. أرسل للـ backend
    setState('sending')
    try {
      const res = await api.post<GeoResult>(
        '/hr/geo/check-in',
        { employee_id: employeeId, work_date: workDate, lat, lng, accuracy_m: acc, field_id: fieldId }
      )
      if (!res.success) throw new Error('Check-in failed')
      setResult(res.data)
      setState('done')
      onSuccess?.(res.data)
    } catch {
      setErrMsg('حدث خطأ أثناء حفظ تسجيل الحضور')
      setState('error')
    }
  }, [employeeId, workDate, fieldId, onSuccess])

  // ── Compact mode (زر صغير فقط) ──────────────────────────
  if (compact) {
    return (
      <button
        onClick={handleCheckIn}
        disabled={state === 'locating' || state === 'sending' || state === 'done'}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
          disabled:opacity-50
          bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-400"
      >
        {state === 'locating' || state === 'sending'
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : state === 'done'
            ? <CheckCircle2 className="h-4 w-4" />
            : <Navigation className="h-4 w-4" />
        }
        {state === 'locating' ? 'جاري تحديد الموقع...'
          : state === 'sending' ? 'جاري الحفظ...'
          : state === 'done'    ? 'تم التسجيل'
          : 'تسجيل حضور GPS'}
      </button>
    )
  }

  // ── Full card mode ────────────────────────────────────────
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-100">
          <MapPin className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <p className="font-semibold text-gray-900">تسجيل الحضور بالموقع</p>
          <p className="text-sm text-gray-500">{workDate}</p>
        </div>
      </div>

      {/* GPS Accuracy Indicator */}
      {accuracy !== null && (
        <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
          accuracy > 100
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          {accuracy > 100
            ? <WifiOff className="h-4 w-4 shrink-0" />
            : <Wifi className="h-4 w-4 shrink-0" />
          }
          <span>
            دقة GPS: <strong>{accuracy} متر</strong>
            {accuracy > 100 && ' — إشارة ضعيفة (جرّب في مكان مكشوف)'}
          </span>
        </div>
      )}

      {/* Result card */}
      {result && state === 'done' && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
          STATUS_LABELS[result.location_status]?.bg ?? 'bg-gray-50 border-gray-200'
        }`}>
          <CheckCircle2 className={`h-5 w-5 mt-0.5 shrink-0 ${STATUS_LABELS[result.location_status]?.color}`} />
          <div>
            <p className={`font-semibold ${STATUS_LABELS[result.location_status]?.color}`}>
              {STATUS_LABELS[result.location_status]?.label}
            </p>
            {result.distance_m !== null && (
              <p className="text-sm text-gray-600 mt-0.5">
                المسافة عن الفرع: <strong>{result.distance_m} م</strong>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-red-50 border-red-200">
          <AlertTriangle className="h-5 w-5 mt-0.5 text-red-600 shrink-0" />
          <p className="text-sm text-red-700">{errMsg}</p>
        </div>
      )}

      {/* Action button */}
      {state !== 'done' && (
        <button
          onClick={handleCheckIn}
          disabled={state === 'locating' || state === 'sending'}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm
            transition-all duration-200
            bg-emerald-600 text-white hover:bg-emerald-700
            disabled:opacity-60 disabled:cursor-not-allowed
            active:scale-[0.98]"
        >
          {state === 'locating' || state === 'sending'
            ? <><Loader2 className="h-4 w-4 animate-spin" /> جاري التحقق من الموقع...</>
            : <><Navigation className="h-4 w-4" /> تسجيل حضور الآن</>
          }
        </button>
      )}

      {state === 'done' && (
        <button
          onClick={() => { setState('idle'); setResult(null); setAccuracy(null) }}
          className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          تسجيل مرة أخرى
        </button>
      )}
    </div>
  )
}
