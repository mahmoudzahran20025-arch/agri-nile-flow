import { useRef, useCallback, useEffect, useState } from 'react'
import { serializeDraft, type MovementDraft } from '../../components/workspace/types'

const STORAGE_PREFIX = 'agri_mvt_draft_'
const INDEX_KEY      = 'agri_mvt_drafts'
const MAX_DRAFTS     = 5

export interface DraftIndex {
  id:         string
  updated_at: string
  type:       string
  warehouse:  string
  line_count: number
}

function readIndex(): DraftIndex[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    return raw ? JSON.parse(raw) as DraftIndex[] : []
  } catch {
    return []
  }
}

function writeIndex(index: DraftIndex[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

export function getSavedDrafts(): DraftIndex[] {
  return readIndex()
}

export function loadDraftFromStorage(id: string): MovementDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id)
    return raw ? JSON.parse(raw) as MovementDraft : null
  } catch {
    return null
  }
}

export function removeDraftFromStorage(id: string): void {
  localStorage.removeItem(STORAGE_PREFIX + id)
  const index = readIndex().filter(d => d.id !== id)
  writeIndex(index)
}

function persistToStorage(draft: MovementDraft): void {
  const start = performance.now()
  const now = new Date().toISOString()
  const updated = {
    ...draft,
    updated_at: now,
    version: draft.version + 1,
  }

  const serialized = serializeDraft(updated)
  localStorage.setItem(STORAGE_PREFIX + updated.id, serialized)

  const index = readIndex().filter(d => d.id !== updated.id)
  index.unshift({
    id:         updated.id,
    updated_at: now,
    type:       updated.header.movement_type,
    warehouse:  String(updated.header.warehouse_id || ''), // Simple string rep for index
    line_count: updated.lines.filter(l => l.item_code !== null).length,
  })

  while (index.length > MAX_DRAFTS) {
    const evicted = index.pop()
    if (evicted) localStorage.removeItem(STORAGE_PREFIX + evicted.id)
  }
  writeIndex(index)
  updated.meta.last_persist_duration_ms = Math.round(performance.now() - start)
}

export function useDraftPersistenceEngine(
  getDraftSnapshot: () => MovementDraft,
  onPersisted?: (newVersion: number) => void,
) {
  const pendingWriteRef    = useRef<ReturnType<typeof setTimeout>>()
  const lastPersistedHash  = useRef<string>('')
  const [dirty, setDirty]  = useState(false)
  const onPersistedRef     = useRef(onPersisted)
  onPersistedRef.current   = onPersisted

  // Initialize hash
  useEffect(() => {
    lastPersistedHash.current = serializeDraft(getDraftSnapshot())
  }, [getDraftSnapshot])

  const checkDirty = useCallback(() => {
    const currentHash = serializeDraft(getDraftSnapshot())
    setDirty(currentHash !== lastPersistedHash.current)
    return currentHash !== lastPersistedHash.current
  }, [getDraftSnapshot])

  const flushNow = useCallback(() => {
    if (pendingWriteRef.current) {
      clearTimeout(pendingWriteRef.current)
      pendingWriteRef.current = undefined
    }
    const currentDraft = getDraftSnapshot()
    if (!currentDraft.meta.autosave_enabled) return

    const currentHash = serializeDraft(currentDraft)
    if (currentHash !== lastPersistedHash.current) {
      persistToStorage(currentDraft)
      lastPersistedHash.current = currentHash
      setDirty(false)
      onPersistedRef.current?.(currentDraft.version + 1)
    }
  }, [getDraftSnapshot])

  const enqueueSave = useCallback((delayMs = 1500) => {
    if (pendingWriteRef.current) {
      clearTimeout(pendingWriteRef.current)
    }
    
    // Immediate state check
    checkDirty()

    pendingWriteRef.current = setTimeout(() => {
      flushNow()
    }, delayMs)
  }, [flushNow, checkDirty])

  const cancelPending = useCallback(() => {
    if (pendingWriteRef.current) {
      clearTimeout(pendingWriteRef.current)
      pendingWriteRef.current = undefined
    }
  }, [])

  // Page hide / visibility change flush handlers
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushNow()
      }
    }
    const handlePageHide = () => {
      flushNow()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [flushNow])

  return {
    enqueueSave,
    flushNow,
    cancelPending,
    dirty,
    checkDirty,
    lastPersistedHash: lastPersistedHash.current
  }
}
