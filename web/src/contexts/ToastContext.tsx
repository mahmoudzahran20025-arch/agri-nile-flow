import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { globalToast } from '../lib/globalEvents'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id:         number
  type:       ToastType
  message:    string
  undoLabel?: string
  onUndo?:    () => void
}

interface ToastCtx {
  toasts:    Toast[]
  toast:     (message: string, type?: ToastType) => void
  toastUndo: (message: string, onUndo: () => void, label?: string) => void
  dismiss:   (id: number) => void
}

const ToastContext = createContext<ToastCtx | null>(null)

let _id = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++_id
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const toastUndo = useCallback((message: string, onUndo: () => void, label = 'تراجع') => {
    const id = ++_id
    setToasts(prev => [...prev, { id, type: 'info', message, undoLabel: label, onUndo }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000)
  }, [])

  useEffect(() => {
    const unsub = globalToast.subscribe(({ message, type }) => {
      toast(message, type)
    })
    return () => { unsub }
  }, [toast])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, toast, toastUndo, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}
