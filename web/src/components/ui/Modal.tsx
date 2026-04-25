import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open:     boolean
  title:    string
  onClose:  () => void
  children: ReactNode
  size?:    'sm' | 'md' | 'lg' | 'xl'
}

export default function Modal({ open, title, onClose, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full ${widths[size]} max-h-[92vh] sm:max-h-[90vh] flex flex-col`}>
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 sm:px-6 py-3 sm:py-4 border-b border-slate-200">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X size={18} />
          </button>
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 sm:py-5">
          {children}
        </div>
      </div>
    </div>
  )
}
