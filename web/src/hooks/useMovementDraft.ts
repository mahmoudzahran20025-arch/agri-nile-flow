import { useState, useCallback, useEffect } from 'react'
import {
  type MovementDraft,
  createEmptyDraft,
} from '../../components/workspace/types'
import {
  useDraftPersistenceEngine,
  loadDraftFromStorage,
  removeDraftFromStorage,
  getSavedDrafts,
  type DraftIndex,
} from './useDraftPersistenceEngine'
import { useHeaderState } from './useHeaderState'
import { useDimensionState } from './useDimensionState'
import { useLineReducer } from './useLineReducer'
import { workspaceEvents } from './workspaceEvents'

interface UseMovementDraftOptions {
  draftId?:  string | null
  initType?: string | null
  initWh?:   string | null
}

export function useMovementDraft(opts: UseMovementDraftOptions = {}) {
  // 1. Initial State Resolution
  const [initialDraft] = useState<MovementDraft>(() => {
    if (opts.draftId) {
      const loaded = loadDraftFromStorage(opts.draftId)
      if (loaded) return loaded
    }
    const fresh = createEmptyDraft()
    if (opts.initType) fresh.header.movement_type = opts.initType as any
    if (opts.initWh) fresh.header.warehouse_id = Number(opts.initWh) || null
    return fresh
  })

  const [id, setId] = useState(initialDraft.id)
  const [meta, setMeta] = useState(initialDraft.meta)
  const [version, setVersion] = useState(initialDraft.version)
  
  // 2. Isolate rendering domains
  const { header, setHeader, setHeaderRaw } = useHeaderState(initialDraft.header)
  const { dimensions, setDimensions, setDimensionsRaw } = useDimensionState(initialDraft.dimensions)
  const { lines, setLines, addLine, removeLine, updateLine } = useLineReducer(initialDraft.lines)
  
  const [savedDrafts, setSavedDrafts] = useState<DraftIndex[]>(getSavedDrafts)

  // 3. Reconstruct draft snapshot for persistence
  const getDraftSnapshot = useCallback((): MovementDraft => {
    return {
      id,
      created_at: initialDraft.created_at, // Simplification
      updated_at: new Date().toISOString(),
      version,
      header,
      dimensions,
      lines,
      meta,
    }
  }, [id, initialDraft.created_at, version, header, dimensions, lines, meta])

  // 4. Persistence Engine Hook
  const { enqueueSave, flushNow, cancelPending, dirty } = useDraftPersistenceEngine(getDraftSnapshot)

  // 5. Connect isolated changes to enqueueSave via Event Bus
  useEffect(() => {
    const unsubLines = workspaceEvents.on('lines:changed', () => enqueueSave())
    const unsubHeader = workspaceEvents.on('header:changed', () => enqueueSave())
    const unsubDim = workspaceEvents.on('dimensions:changed', () => enqueueSave())
    
    return () => {
      unsubLines()
      unsubHeader()
      unsubDim()
    }
  }, [enqueueSave])

  // 6. Manual Actions
  const saveDraft = useCallback(() => {
    flushNow()
    setSavedDrafts(getSavedDrafts())
  }, [flushNow])

  const discardDraft = useCallback(() => {
    cancelPending()
    removeDraftFromStorage(id)
    const fresh = createEmptyDraft()
    setId(fresh.id)
    setMeta(fresh.meta)
    setVersion(fresh.version)
    setHeaderRaw(fresh.header)
    setDimensionsRaw(fresh.dimensions)
    setLines(fresh.lines)
    setSavedDrafts(getSavedDrafts())
  }, [id, cancelPending, setHeaderRaw, setDimensionsRaw, setLines])

  const loadDraftById = useCallback((loadId: string): boolean => {
    const loaded = loadDraftFromStorage(loadId)
    if (!loaded) return false
    cancelPending()
    setId(loaded.id)
    setMeta(loaded.meta)
    setVersion(loaded.version)
    setHeaderRaw(loaded.header)
    setDimensionsRaw(loaded.dimensions)
    setLines(loaded.lines)
    return true
  }, [cancelPending, setHeaderRaw, setDimensionsRaw, setLines])

  const markPosted = useCallback(() => {
    cancelPending()
    removeDraftFromStorage(id)
    setSavedDrafts(getSavedDrafts())
  }, [id, cancelPending])

  return {
    // Isolated state objects
    header,
    dimensions,
    lines,
    meta,
    
    // Derived properties
    draftId: id,
    dirty,
    savedDrafts,

    // Updaters
    setHeader,
    setDimensions,
    setLines,
    addLine,
    removeLine,
    updateLine,

    // Actions
    saveDraft,
    discardDraft,
    loadDraftById,
    markPosted,
  }
}
