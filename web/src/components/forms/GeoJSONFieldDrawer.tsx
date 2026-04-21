import { useState, useCallback } from 'react'
import {
  MapPin, ExternalLink, Clipboard, CheckCircle2,
  AlertTriangle, Loader2, RotateCcw, Info,
} from 'lucide-react'
import { parseGeoJSON, buildGeoJSONioURL, formatFeddan, type GeoFieldResult } from '../../lib/geoUtils'

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
interface Props {
  onResult: (result: GeoFieldResult) => void
  currentResult?: GeoFieldResult | null
}

type DrawState = 'idle' | 'locating' | 'ready' | 'pasting' | 'done' | 'error'

// ─────────────────────────────────────────────────────────────
// Step indicator
// ─────────────────────────────────────────────────────────────
const STEPS = [
  { n: 1, label: 'افتح geojson.io' },
  { n: 2, label: 'اختر Satellite' },
  { n: 3, label: 'ارسم القطعة (Polygon)' },
  { n: 4, label: 'انسخ GeoJSON' },
  { n: 5, label: 'الصق هنا' },
]

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function GeoJSONFieldDrawer({ onResult, currentResult }: Props) {
  const [state,    setState]    = useState<DrawState>(currentResult ? 'done' : 'idle')
  const [url,      setUrl]      = useState('')
  const [paste,    setPaste]    = useState('')
  const [result,   setResult]   = useState<GeoFieldResult | null>(currentResult ?? null)
  const [errMsg,   setErrMsg]   = useState('')
  const [step,     setStep]     = useState(0)  // current active step 1-5

  // ── Step 1: Get GPS → open geojson.io ───────────────────────
  const handleOpen = useCallback(async () => {
    setState('locating')
    setErrMsg('')

    let lat = 26.757, lng = 29.226   // fallback: center of Egypt
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000,
        })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {
      // GPS failed — use fallback location, still open the map
    }

    const geoURL = buildGeoJSONioURL(lat, lng, 17)
    setUrl(geoURL)
    window.open(geoURL, '_blank', 'noopener,noreferrer')
    setState('ready')
    setStep(2)
  }, [])

  // ── Step 5: Parse pasted GeoJSON ────────────────────────────
  const handleParse = useCallback(() => {
    if (!paste.trim()) { setErrMsg('الرجاء لصق GeoJSON أولاً'); return }
    setState('pasting')
    setErrMsg('')

    try {
      const res = parseGeoJSON(paste)
      setResult(res)
      setState('done')
      setStep(5)
      onResult(res)
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : 'خطأ في تحليل GeoJSON')
      setState('ready')
    }
  }, [paste, onResult])

  const handleReset = () => {
    setState('idle'); setUrl(''); setPaste(''); setResult(null)
    setErrMsg(''); setStep(0)
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-100">
            <MapPin className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="font-semibold text-gray-900 text-sm">رسم حدود القطعة</p>
          <span className="text-xs text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full font-medium">
            يحسب المساحة تلقائياً
          </span>
        </div>
        {state === 'done' && (
          <button onClick={handleReset} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <RotateCcw className="h-3 w-3" /> إعادة الرسم
          </button>
        )}
      </div>

      {/* ── DONE: show result ─────────────────────── */}
      {state === 'done' && result && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg bg-emerald-50 border border-emerald-200 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-emerald-800">تم رسم الحدود بنجاح ✅</p>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-700">
                <div>
                  <span className="text-gray-500">المساحة: </span>
                  <strong className="text-emerald-700">{formatFeddan(result.area_feddan)}</strong>
                  <span className="text-gray-400 text-xs"> ({result.area_feddan.toFixed(4)} فدان)</span>
                </div>
                <div>
                  <span className="text-gray-500">المركز: </span>
                  <strong>{result.center_lat.toFixed(5)}, {result.center_lng.toFixed(5)}</strong>
                </div>
                <div>
                  <span className="text-gray-500">عدد النقاط: </span>
                  <strong>{result.coords.length - 1}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Mini preview of coords */}
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-400 hover:text-gray-600">عرض GeoJSON المحفوظ</summary>
            <pre className="mt-2 p-2 bg-gray-100 rounded text-gray-600 overflow-auto max-h-24 text-[10px]">
              {result.boundary_geojson.slice(0, 300)}…
            </pre>
          </details>
        </div>
      )}

      {/* ── IDLE: main CTA ───────────────────────── */}
      {state === 'idle' && (
        <div className="space-y-3">
          {/* Steps guide */}
          <div className="grid grid-cols-5 gap-1">
            {STEPS.map(s => (
              <div key={s.n} className="text-center">
                <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center mx-auto mb-1
                  ${step >= s.n ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {s.n}
                </div>
                <p className="text-[10px] text-gray-500 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>

          <button
            onClick={handleOpen}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
              bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            افتح geojson.io على موقعك الحالي
          </button>

          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              بعد الفتح: اضغط على أيقونة الطبقات (يمين الخريطة) → اختر <strong>Satellite</strong>
              ← ثم ارسم القطعة باستخدام أداة <strong>Polygon</strong>
            </span>
          </div>
        </div>
      )}

      {/* ── LOCATING ─────────────────────────────── */}
      {state === 'locating' && (
        <div className="flex items-center justify-center gap-2 py-4 text-gray-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          جاري تحديد موقعك لفتح الخريطة...
        </div>
      )}

      {/* ── READY: waiting for paste ─────────────── */}
      {state === 'ready' && (
        <div className="space-y-3">
          {/* Steps with active indicator */}
          <div className="grid grid-cols-5 gap-1">
            {STEPS.map(s => (
              <div key={s.n} className="text-center">
                <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center mx-auto mb-1
                  ${s.n < 5 ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400 animate-pulse'}`}>
                  {s.n === step ? '✏️' : s.n < 5 ? '✓' : s.n}
                </div>
                <p className="text-[10px] text-gray-500 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Reopen link */}
          {url && (
            <a
              href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-sm hover:bg-emerald-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              إعادة فتح geojson.io
            </a>
          )}

          {/* Paste instructions */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Clipboard className="h-4 w-4 text-emerald-600" />
              الصق GeoJSON هنا (Save → Copy GeoJSON في geojson.io)
            </label>
            <textarea
              rows={5}
              placeholder={'{\n  "type": "FeatureCollection",\n  "features": [...]\n}'}
              value={paste}
              onChange={e => { setPaste(e.target.value); setErrMsg('') }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono
                focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none
                placeholder:text-gray-300"
            />
          </div>

          {errMsg && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {errMsg}
            </div>
          )}

          <button
            onClick={handleParse}
            disabled={!paste.trim()}
            className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm
              hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            تحليل وحساب المساحة
          </button>
        </div>
      )}
    </div>
  )
}
