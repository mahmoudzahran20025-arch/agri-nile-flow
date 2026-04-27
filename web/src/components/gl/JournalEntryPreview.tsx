import { useMemo } from 'react'
import type { ValidationBlueprint } from '../../api/gl'

interface JournalEntryPreviewProps {
  blueprint: ValidationBlueprint | null
  title?: string
}

export function JournalEntryPreview({ blueprint, title = 'معاينة القيد' }: JournalEntryPreviewProps) {
  const totals = useMemo(() => {
    const debit = blueprint?.lines.reduce((sum, line) => sum + line.debit, 0) ?? 0
    const credit = blueprint?.lines.reduce((sum, line) => sum + line.credit, 0) ?? 0
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.001 }
  }, [blueprint])

  if (!blueprint) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500 mt-1">
            {totals.balanced ? '✅ القيد متوازن' : '❌ القيد غير متوازن'}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={async () => {
            await navigator.clipboard.writeText(JSON.stringify(blueprint, null, 2))
          }}
        >
          نسخ JSON
        </button>
      </div>

      {blueprint.validationErrors.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {blueprint.validationErrors.map(error => <div key={error}>{error}</div>)}
        </div>
      )}

      {blueprint.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {blueprint.warnings.map(warning => <div key={warning}>{warning}</div>)}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-right text-slate-500">
              <th className="pb-2 font-medium">الحساب</th>
              <th className="pb-2 font-medium">مدين</th>
              <th className="pb-2 font-medium">دائن</th>
              <th className="pb-2 font-medium">الوصف</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {blueprint.lines.map((line, index) => (
              <tr key={`${line.account_code}-${index}`}>
                <td className="py-2 font-mono">{line.account_code}</td>
                <td className="py-2 font-mono">{line.debit || '—'}</td>
                <td className="py-2 font-mono">{line.credit || '—'}</td>
                <td className="py-2 text-slate-500">{line.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold text-slate-700">
              <td className="pt-2">الإجمالي</td>
              <td className="pt-2 font-mono">{totals.debit}</td>
              <td className="pt-2 font-mono">{totals.credit}</td>
              <td className="pt-2">{totals.balanced ? 'متوازن' : 'غير متوازن'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export default JournalEntryPreview
