import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToast, type Toast } from '../../contexts/ToastContext'

const ICONS = {
  success: <CheckCircle  size={18} className="text-green-500 flex-shrink-0" />,
  error:   <XCircle      size={18} className="text-red-500   flex-shrink-0" />,
  warning: <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />,
  info:    <Info         size={18} className="text-blue-500  flex-shrink-0" />,
}

const BORDERS = {
  success: 'border-r-4 border-green-500',
  error:   'border-r-4 border-red-500',
  warning: 'border-r-4 border-amber-500',
  info:    'border-r-4 border-blue-500',
}

function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
  return (
    <div
      className={`flex items-center gap-3 bg-white shadow-lg rounded-lg px-4 py-3
                  min-w-[280px] max-w-[420px] animate-[slideIn_0.2s_ease] ${BORDERS[toast.type]}`}
    >
      {ICONS[toast.type]}
      <span className="flex-1 text-sm text-gray-800">{toast.message}</span>
      <button
        onClick={() => dismiss(toast.id)}
        className="text-gray-400 hover:text-gray-600 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const { toasts, dismiss } = useToast()
  if (!toasts.length) return null

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  )
}
