import { useState, useCallback, useEffect } from 'react'
import {
  type MovementDraft,
  type WorkspaceMode,
  createEmptyDraft,
} from '../../components/workspace/types'
import { useHeaderState } from './useHeaderState'
import { useDimensionState } from './useDimensionState'
import { useLineReducer } from './useLineReducer'
import { useWorkspaceOrchestrator } from './useWorkspaceOrchestrator'
import { LocalStoragePersistenceAdapter } from './persistenceAdapter'

interface UseMovementDraftOptions {
  mode?:     WorkspaceMode
  draftId?:  string | null
  initType?: string | null
  initWh?:   string | null
}

export function useMovementDraft(opts: UseMovementDraftOptions = {}) {
  const mode = opts.mode || 'create'

  // 1. Initial State Resolution (Synchronous init for render safety)
  const [initialDraft] = useState<MovementDraft>(() => {
    const fresh = createEmptyDraft()
    if (opts.initType) fresh.header.movement_type = opts.initType as any
    if (opts.initWh) fresh.header.warehouse_id = Number(opts.initWh) || null
    
    // We start with a fresh draft synchronously. 
    // If a draftId is provided, we will load it asynchronously and dispatch it.
    return fresh
  })

  const [id, setId] = useState(initialDraft.id)
  const [meta, setMeta] = useState(initialDraft.meta)
  const [version, setVersion] = useState(initialDraft.version)
  
  // 2. Isolate rendering domains
  const { header, dispatchHeaderCommand } = useHeaderState(initialDraft.header)
  const { dimensions, dispatchDimensionsCommand } = useDimensionState(initialDraft.dimensions)
  const { lines, dispatchLineCommand } = useLineReducer(initialDraft.lines)
  
  // 3. Reconstruct snapshot for Orchestrator
  const getDraftSnapshot = useCallback((): MovementDraft => {
    return {
      id,
      created_at: initialDraft.created_at,
      updated_at: new Date().toISOString(),
      version,
      header,
      dimensions,
      lines,
      meta,
    }
  }, [id, initialDraft.created_at, version, header, dimensions, lines, meta])

  // 4. Update Meta utility
  const handleMetaUpdate = useCallback((durationMs: number) => {
    setMeta(prev => ({ ...prev, last_persist_duration_ms: durationMs }))
  }, [])

  // 5. Connect Orchestrator
  const orchestrator = useWorkspaceOrchestrator({
    mode,
    draftId: id,
    getDraftSnapshot,
    onHeaderCommand: dispatchHeaderCommand,
    onDimensionCommand: dispatchDimensionsCommand,
    onLineCommand: dispatchLineCommand,
    onMetaUpdate: handleMetaUpdate,
    onVersionBumped: setVersion,
  })

  // 6. Async Draft Loading
  useEffect(() => {
    if (opts.draftId && mode !== 'create') {
      LocalStoragePersistenceAdapter.loadDraft(opts.draftId).then(loaded => {
        if (loaded) {
          setId(loaded.id)
          setMeta(loaded.meta)
          setVersion(loaded.version)
          dispatchHeaderCommand({ type: 'REPLACE_HEADER', payload: loaded.header })
          dispatchDimensionsCommand({ type: 'REPLACE_DIMENSIONS', payload: loaded.dimensions })
          dispatchLineCommand({ type: 'SET_LINES', payload: loaded.lines })
        }
      })
    }
  }, [opts.draftId, mode, dispatchHeaderCommand, dispatchDimensionsCommand, dispatchLineCommand])

  // 7. Manual Actions mapped to Orchestrator
  const saveDraft = useCallback(() => {
    orchestrator.flushNow()
  }, [orchestrator])

  const discardDraft = useCallback(async () => {
    await orchestrator.discardDraft()
    const fresh = createEmptyDraft()
    setId(fresh.id)
    setMeta(fresh.meta)
    setVersion(fresh.version)
    dispatchHeaderCommand({ type: 'REPLACE_HEADER', payload: fresh.header })
    dispatchDimensionsCommand({ type: 'REPLACE_DIMENSIONS', payload: fresh.dimensions })
    dispatchLineCommand({ type: 'SET_LINES', payload: fresh.lines })
  }, [orchestrator, dispatchHeaderCommand, dispatchDimensionsCommand, dispatchLineCommand])

  const loadDraftById = useCallback((loadId: string) => {
    LocalStoragePersistenceAdapter.loadDraft(loadId).then(loaded => {
      if (loaded) {
        setId(loaded.id)
        setMeta(loaded.meta)
        setVersion(loaded.version)
        dispatchHeaderCommand({ type: 'REPLACE_HEADER', payload: loaded.header })
        dispatchDimensionsCommand({ type: 'REPLACE_DIMENSIONS', payload: loaded.dimensions })
        dispatchLineCommand({ type: 'SET_LINES', payload: loaded.lines })
      }
    })
  }, [dispatchHeaderCommand, dispatchDimensionsCommand, dispatchLineCommand])

  return {
    // Isolated state objects
    header,
    dimensions,
    lines,
    meta,

    // Derived properties
    draftId: id,
    status: orchestrator.status,
    dirty: orchestrator.isDirty,
    isSaving: orchestrator.isSaving,
    savedDrafts: orchestrator.savedDrafts,

    // The single orchestrator dispatch method for all commands
    dispatch: orchestrator.dispatch,
    setDraftStatus: orchestrator.setDraftStatus,

    // Actions
    saveDraft,
    discardDraft,
    loadDraftById,

    // Snapshot accessor — use this instead of manually reconstructing the draft
    getDraftSnapshot,
  }
}
