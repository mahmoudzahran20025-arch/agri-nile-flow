import { useEffect } from 'react'

/**
 * Binds Ctrl+N / Cmd+N to an "open new item" callback for the current page.
 * Pages that support it opt in by calling this hook with their handler.
 */
export function useNewShortcut(onNew: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey && !e.altKey) {
        const tag = (document.activeElement as HTMLElement)?.tagName.toLowerCase()
        const isEditing = tag === 'input' || tag === 'textarea' || tag === 'select' ||
          (document.activeElement as HTMLElement)?.isContentEditable
        if (!isEditing) {
          e.preventDefault()
          onNew()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onNew, enabled])
}
