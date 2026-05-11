/**
 * web/src/pages/gl/ExchangeRatesPage.tsx
 *
 * Phase 2: Exchange Rates Management
 * View all FX rates + real-time conversion + add new rate
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { glApi, type ExchangeRateRow } from '../../api/gl'

const CURRENCIES = ['EGP', 'USD', 'EUR', 'SAR', 'AED', 'GBP', 'JPY', 'CHF']

interface AddRateForm {
  from_currency: string
  to_currency:   string
  rate:          string
  effective_date: string
  source:        string
}

const defaultForm: AddRateForm = {
  from_currency:  'USD',
  to_currency:    'EGP',
  rate:           '',
  effective_date: new Date().toISOString().split('T')[0],
  source:         'MANUAL',
}

export default function ExchangeRatesPage() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd]     = useState(false)
  const [form, setForm]           = useState<AddRateForm>(defaultForm)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState<string | null>(null)

  // ── Conversion calculator state ─────────────────────────────────────────────
  const [convFrom, setConvFrom]   = useState('USD')
  const [convTo, setConvTo]       = useState('EGP')
  const [convAmount, setConvAmount] = useState('100')

  const { data: ratesData, isLoading } = useQuery({
    queryKey:      ['exchange-rates'],
    queryFn:       () => glApi.exchangeRates(),
    refetchInterval: 60000,
  })

  const { data: convResult, isFetching: converting } = useQuery({
    queryKey:  ['fx-convert', convFrom, convTo, convAmount],
    queryFn:   () => glApi.convertCurrency(convFrom, convTo, parseFloat(convAmount) || 0),
    enabled:   !!(convFrom && convTo && convAmount && parseFloat(convAmount) > 0),
    staleTime: 30000,
  })

  const createMutation = useMutation({
    mutationFn: (f: AddRateForm) => glApi.createExchangeRate({
      from_currency:  f.from_currency,
      to_currency:    f.to_currency,
      rate:           parseFloat(f.rate),
      effective_date: f.effective_date,
      source:         f.source as 'MANUAL' | 'API' | 'CBE',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] })
      queryClient.invalidateQueries({ queryKey: ['fx-convert'] })
      setSuccess('تم حفظ سعر الصرف بنجاح')
      setShowAdd(false)
      setForm(defaultForm)
      setTimeout(() => setSuccess(null), 3000)
    },
    onError: (e: Error) => {
      setError(e.message || 'خطأ في حفظ سعر الصرف')
      setTimeout(() => setError(null), 5000)
    },
  })

  const rates: ExchangeRateRow[] = (ratesData as { data?: ExchangeRateRow[] })?.data ?? []

  const grouped = rates.reduce<Record<string, ExchangeRateRow[]>>((acc, r) => {
    const key = r.from_currency
    acc[key] = acc[key] ?? []
    acc[key].push(r)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-50 p-6" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">أسعار الصرف</h1>
            <p className="text-sm text-gray-500 mt-1">
              إدارة أسعار صرف العملات الأجنبية — {rates.length} سعر مسجّل
            </p>
          </div>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition"
          >
            <span>+</span> إضافة سعر
          </button>
        </div>

        {/* ── Alerts ── */}
        {error   && <div className="rounded-lg bg-red-50   border border-red-200   text-red-700   px-4 py-3 text-sm">{error}</div>}
        {success && <div className="rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">{success}</div>}

        {/* ── Conversion Calculator ── */}
        <div className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">حاسبة التحويل الفوري</h2>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">المبلغ</label>
              <input
                type="number"
                value={convAmount}
                onChange={e => setConvAmount(e.target.value)}
                className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">من</label>
              <select value={convFrom} onChange={e => setConvFrom(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="text-gray-400 text-lg pb-2">→</div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">إلى</label>
              <select value={convTo} onChange={e => setConvTo(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px] rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2">
              {converting ? (
                <span className="text-xs text-gray-400">جاري الحساب…</span>
              ) : convResult ? (
                <div>
                  <span className="text-xl font-bold text-emerald-700">
                    {((convResult as { data?: { converted?: number } })?.data?.converted ?? 0).toLocaleString('ar-EG', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs text-gray-500 mr-2">{convTo}</span>
                  <div className="text-xs text-gray-400">
                    سعر الصرف: {((convResult as { data?: { rate?: number } })?.data?.rate ?? 0).toLocaleString('ar-EG', { minimumFractionDigits: 4 })}
                  </div>
                </div>
              ) : (
                <span className="text-xs text-gray-400">أدخل مبلغاً للتحويل</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Add Form ── */}
        {showAdd && (
          <div className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4">إضافة / تحديث سعر صرف</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">من العملة</label>
                <select value={form.from_currency} onChange={e => setForm(f => ({ ...f, from_currency: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">إلى العملة</label>
                <select value={form.to_currency} onChange={e => setForm(f => ({ ...f, to_currency: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">سعر الصرف</label>
                <input type="number" step="0.0001" value={form.rate}
                  onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
                  placeholder="50.5000"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">تاريخ السريان</label>
                <input type="date" value={form.effective_date}
                  onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">المصدر</label>
                <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="MANUAL">يدوي</option>
                  <option value="CBE">البنك المركزي المصري</option>
                  <option value="API">API تلقائي</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                disabled={createMutation.isPending || !form.rate}
                onClick={() => createMutation.mutate(form)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {createMutation.isPending ? 'جاري الحفظ…' : 'حفظ السعر'}
              </button>
              <button onClick={() => setShowAdd(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* ── Rates Table ── */}
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">جاري التحميل…</div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([currency, group]) => (
              <div key={currency} className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
                  <span className="font-semibold text-gray-800">
                    {currency} — {group.length} {group.length === 1 ? 'سعر' : 'أسعار'}
                  </span>
                </div>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-right text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                      <th className="px-5 py-2 font-medium">إلى</th>
                      <th className="px-5 py-2 font-medium">سعر الصرف</th>
                      <th className="px-5 py-2 font-medium">تاريخ السريان</th>
                      <th className="px-5 py-2 font-medium">المصدر</th>
                      <th className="px-5 py-2 font-medium">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map(r => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                        <td className="px-5 py-3 font-mono font-semibold text-gray-800">{r.to_currency}</td>
                        <td className="px-5 py-3 font-mono text-emerald-700 font-bold">
                          {r.rate.toLocaleString('ar-EG', { minimumFractionDigits: 4 })}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{r.effective_date}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.source === 'CBE' ? 'bg-blue-100 text-blue-700' :
                            r.source === 'API' ? 'bg-purple-100 text-purple-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{r.source}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                          }`}>{r.is_active ? 'فعّال' : 'معطّل'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {rates.length === 0 && (
              <div className="text-center py-12 text-gray-400">لا توجد أسعار صرف مسجّلة</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
