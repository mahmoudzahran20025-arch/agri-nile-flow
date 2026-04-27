/**
 * PostingValidation — Dry-run posting engine validation widget.
 *
 * Usage:
 *   <PostingValidation type="supplier_invoice" bpg_code="DOM" ppg_code="AGRI" ap_code="21010001" amount={5000} />
 *
 * Shows:
 *   ✅ Ready to post — journal preview table
 *   ⚠️ Warnings only — allow submit with confirmation
 *   🔴 Blocked — errors list, disable submit
 */
import { useEffect, useState } from 'react'
import { glApi, ValidationBlueprint } from '../../api/gl'

interface PostingValidationProps {
  type: 'inventory_in' | 'inventory_out' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
  bpg_code?:      string | null
  ppg_code?:      string | null
  ipg_code?:      string | null
  ap_code?:       string
  cash_code?:     string
  receivable_code?: string
  amount?:        number
  onResult?:      (result: ValidationBlueprint | null) => void
}

export default function PostingValidation(props: PostingValidationProps) {
  const { type, bpg_code, ppg_code, ipg_code, ap_code, cash_code, receivable_code, amount, onResult } = props

  const [result,  setResult]  = useState<ValidationBlueprint | null>(null)
  const [loading, setLoading] = useState(false)

  // Re-validate whenever relevant props change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    glApi.validatePosting({ type, bpg_code, ppg_code, ipg_code, ap_code, cash_code, receivable_code, amount })
      .then(r => {
        if (!cancelled) { setResult(r); onResult?.(r) }
      })
      .catch(() => {
        if (!cancelled) { setResult(null); onResult?.(null) }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [type, bpg_code, ppg_code, ipg_code, ap_code, cash_code, receivable_code, amount]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-400 animate-pulse">
        🔄 جارٍ التحقق من إعداد الترحيل...
      </div>
    )
  }

  if (!result) return null

  const { isBlocked, validationErrors, warnings, lines } = result

  return (
    <div className={`rounded-lg border p-4 text-sm space-y-3 ${
      isBlocked
        ? 'border-red-200 bg-red-50'
        : warnings.length > 0
        ? 'border-amber-200 bg-amber-50'
        : 'border-emerald-200 bg-emerald-50'
    }`}>
      {/* Status header */}
      <div className="flex items-center gap-2 font-medium">
        {isBlocked ? (
          <><span className="text-red-600 text-base">🔴</span><span className="text-red-700">الترحيل محظور — يرجى حل المشاكل أدناه</span></>
        ) : warnings.length > 0 ? (
          <><span className="text-amber-600 text-base">⚠️</span><span className="text-amber-700">جاهز مع تنبيهات</span></>
        ) : (
          <><span className="text-emerald-600 text-base">✅</span><span className="text-emerald-700">جاهز للترحيل</span></>
        )}
      </div>

      {/* Errors */}
      {validationErrors.length > 0 && (
        <ul className="space-y-1">
          {validationErrors.map((e, i) => (
            <li key={i} className="text-red-700 flex items-start gap-1.5">
              <span className="shrink-0 mt-0.5">•</span> {e}
            </li>
          ))}
        </ul>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <ul className="space-y-1">
          {warnings.map((w, i) => (
            <li key={i} className="text-amber-700 flex items-start gap-1.5 text-xs">
              <span className="shrink-0 mt-0.5">⚠</span> {w}
            </li>
          ))}
        </ul>
      )}

      {/* Journal preview */}
      {!isBlocked && lines.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 select-none">
            عرض القيود المحاسبية المتوقعة ({lines.length} سطر)
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-right pb-1 font-medium text-slate-600">الحساب</th>
                  <th className="text-right pb-1 font-medium text-slate-600">مدين</th>
                  <th className="text-right pb-1 font-medium text-slate-600">دائن</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 font-mono text-slate-700">{l.account_code}</td>
                    <td className="py-1 text-emerald-700 font-medium">{l.debit  > 0 ? l.debit.toLocaleString()  : '—'}</td>
                    <td className="py-1 text-rose-700   font-medium">{l.credit > 0 ? l.credit.toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
