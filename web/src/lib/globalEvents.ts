type ToastEvent = { message: string, type: 'success' | 'error' | 'info' | 'warning' }
type Listener = (e: ToastEvent) => void

const listeners = new Set<Listener>()

export const globalToast = {
  subscribe: (l: Listener) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  emit: (message: string, type: ToastEvent['type'] = 'success') => {
    listeners.forEach(l => l({ message, type }))
  }
}
