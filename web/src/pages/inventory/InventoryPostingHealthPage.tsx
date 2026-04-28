/**
 * InventoryPostingHealthPage — Visual matrix of warehouse×PPG posting coverage.
 * Shows which combinations have movements but lack posting setup entries.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, AlertTriangle, CheckCircle, Package, ExternalLink } from 'lucide-react'
import { inventoryApi } from '../../api/inventory'

const EGP = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

export default function InventoryPostingHealthPage() {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'posting-health'],
    queryFn:  inventoryApi.postingHealth,
    staleTime: 60_000,
  })

  const health  = data?.data    ?? []
  const summary = data?.summary ?? { total_combos: 0, covered: 0, exact_setup: 0, missing_setup: 0, health_pct: 100 }

  const missing  = health.filter(h => !h.is_covered)

  return (
    <div className="space-y-5 pb-10">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ShieldCheck size={22} className="text-slate-400" />
            فحص صحة الترحيل المخزني
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            مصفوفة التغطية: كل تركيبة (مخزن × مجموعة ترحيل) لها حركات مخزنية
          </p>
        </div>
        <button
          className="btn-secondary gap-2"
          onClick={() => navigate('/gl/posting-setup')}
        >
          <ExternalLink size={15} /> إعداد الترحيل
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center text-brand-600">
            <Package size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">إجمالي التوليفات</p>
            <p className="text-xl font-bold">{summary.total_combos}</p>
          </div>
        </div>
        <div className={`card p-4 flex items-center gap-3 ${summary.health_pct < 100 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${summary.health_pct < 100 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
            {summary.health_pct < 100 ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
          </div>
          <div>
            <p className="text-xs text-slate-400">نسبة التغطية</p>
            <p className={`text-xl font-bold ${summary.health_pct < 100 ? 'text-amber-700' : 'text-green-700'}`}>
              {summary.health_pct}%
            </p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3 border-green-200 bg-green-50">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center text-green-600">
            <CheckCircle size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">تطابق تام</p>
            <p className="text-xl font-bold text-green-700">{summary.exact_setup}</p>
          </div>
        </div>
        <div className={`card p-4 flex items-center gap-3 ${summary.missing_setup > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${summary.missing_setup > 0 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-400'}`}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">توليفات بدون إعداد</p>
            <p className={`text-xl font-bold ${summary.missing_setup > 0 ? 'text-red-700' : 'text-slate-500'}`}>
              {summary.missing_setup}
            </p>
          </div>
        </div>
      </div>

      {/* Missing combos alert */}
      {missing.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 mb-2">
                {missing.length} تركيبة بدون إعداد ترحيل — الحركات المستقبلية ستفشل
              </p>
              <div className="space-y-1">
                {missing.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-red-700">
                    <span className="font-mono bg-red-100 px-2 py-0.5 rounded text-xs">{m.warehouse}</span>
                    <span className="text-red-400">×</span>
                    <span className="font-mono bg-red-100 px-2 py-0.5 rounded text-xs">{m.ppg ?? 'NULL'}</span>
                    <span className="text-red-400">—</span>
                    <span className="text-xs">{m.movement_count} حركة · {EGP(m.total_value)}</span>
                    {m.gaps.map((g, gi) => (
                      <span key={gi} className="text-xs bg-red-200 px-1.5 py-0.5 rounded-full">{g}</span>
                    ))}
                  </div>
                ))}
              </div>
              <button
                className="mt-3 text-sm font-medium text-red-700 hover:text-red-900 underline"
                onClick={() => navigate('/gl/posting-setup?tab=inventory')}
              >
                انتقل لإعداد الترحيل المخزني ←
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full matrix table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">مصفوفة التغطية الكاملة</h3>
        </div>
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 animate-pulse">جاري التحميل...</div>
        ) : health.length === 0 ? (
          <div className="p-12 text-center text-slate-400">لا توجد حركات مخزنية بعد</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['المخزن', 'IPG', 'مجموعة PPG', 'عدد الحركات', 'إجمالي القيمة', 'الحالة', 'الفجوات'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {health.map((row, i) => (
                  <tr key={i} className={`${!row.is_covered ? 'bg-red-50/50' : row.has_fallback_setup ? 'bg-amber-50/30' : 'hover:bg-slate-50'} transition-colors`}>
                    <td className="px-4 py-3 font-medium text-slate-700">{row.warehouse}</td>
                    <td className="px-4 py-3">
                      {row.ipg
                        ? <span className="text-xs font-mono bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{row.ipg}</span>
                        : <span className="text-xs text-red-500">بدون IPG</span>}
                    </td>
                    <td className="px-4 py-3">
                      {row.ppg
                        ? <span className="text-xs font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{row.ppg}</span>
                        : <span className="text-xs text-red-500">بدون PPG</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.movement_count.toLocaleString()}</td>
                    <td className="px-4 py-3 font-semibold text-brand-700">{EGP(row.total_value ?? 0)}</td>
                    <td className="px-4 py-3">
                      {!row.is_covered ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold border border-red-200">
                          <AlertTriangle size={10} /> مفقود
                        </span>
                      ) : row.has_fallback_setup ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">
                          ⚡ احتياطي
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold border border-green-200">
                          <CheckCircle size={10} /> مطابق
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.gaps.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.gaps.map((g, gi) => (
                            <span key={gi} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{g}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
