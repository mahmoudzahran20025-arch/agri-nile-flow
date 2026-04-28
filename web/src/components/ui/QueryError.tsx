import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  message?:  string
  onRetry?:  () => void
  className?: string
}

/**
 * Consistent error state for failed queries.
 * Drop-in replacement for blank UI when isError=true.
 */
export default function QueryError({ message, onRetry, className = '' }: Props) {
  return (
    <div className={`rounded-xl border border-red-200 bg-red-50 p-6 flex flex-col items-center gap-3 text-center ${className}`}>
      <AlertTriangle size={32} className="text-red-400" />
      <p className="text-sm font-medium text-red-700">
        {message ?? 'حدث خطأ أثناء تحميل البيانات'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-800 border border-red-300 hover:border-red-400 bg-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw size={12} /> إعادة المحاولة
        </button>
      )}
    </div>
  )
}
