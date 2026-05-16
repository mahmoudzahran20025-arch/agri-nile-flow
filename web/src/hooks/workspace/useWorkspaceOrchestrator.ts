import { useRef, useCallback, useEffect, useState } from 'react'
import type { WorkspaceCommand } from './commands'
import type { WorkspaceMode, MovementDraft } from '../../components/workspace/types'
import { workspaceEvents } from './workspaceEvents'
import { LocalStoragePersistenceAdapter, type DraftIndex } from './persistenceAdapter'

const MUTEX_TIMEOUT_MS = 8000

interface OrchestratorConfig {
  mode: WorkspaceMode
  draftId: string
  getDraftSnapshot: () => MovementDraft
  onHeaderCommand: (cmd: WorkspaceCommand) => void
  onDimensionCommand: (cmd: WorkspaceCommand) => void
  onLineCommand: (cmd: WorkspaceCommand) => void
  onMetaUpdate: (durationMs: number) => void
  onVersionBumped?: (newVersion: number) => void
}

export function useWorkspaceOrchestrator(config: OrchestratorConfig) {
  // ─── Concurrency & Mutex ─────────────────────────────────────────────────────
  const isPersistingRef    = useRef(false)
  const mutexAcquiredAtRef = useRef<number>(0)
  const writeGeneration    = useRef(0)
  const pendingSaveRef     = useRef<ReturnType<typeof setTimeout>>()

  // ─── Dirty Tracking (O(1)) ───────────────────────────────────────────────────
  const dirtyRowIds   = useRef<Set<string>>(new Set())
  const dirtyDomains  = useRef<Set<'header' | 'dimensions' | 'lines'>>(new Set())
  const [status, setStatus] = useState<import('../../components/workspace/types').DraftStatus>('draft')
  
  // Helper to safely transition status
  const transitionTo = useCallback((next: import('../../components/workspace/types').DraftStatus) => {
    setStatus(prev => {
      // Don't overwrite terminal states unless explicitly requested
      if (prev === 'posted' || prev === 'posting') {
        if (next !== 'failed' && next !== 'posted' && next !== 'posting') return prev
      }
      return next
    })
  }, [])
  
  // Expose saved drafts index
  const [savedDrafts, setSavedDrafts] = useState<DraftIndex[]>([])

  // ─── Persistence Engine ──────────────────────────────────────────────────────
  const flushNow = useCallback(async () => {
    if (config.mode === 'readonly') return
    if (status !== 'dirty' && dirtyDomains.current.size === 0 && dirtyRowIds.current.size === 0) return

    // Mutex lock — with timeout to prevent permanent lockout
    const now = performance.now()
    if (isPersistingRef.current) {
      const elapsed = now - mutexAcquiredAtRef.current
      if (elapsed < MUTEX_TIMEOUT_MS) {
        // Still within timeout window — re-enqueue once to wait
        if (!pendingSaveRef.current) {
          pendingSaveRef.current = setTimeout(() => flushNow(), 500)
        }
        return
      }
      // Timeout exceeded — force-release stale lock
      console.warn(`Orchestrator: mutex held for ${Math.round(elapsed)}ms, force-releasing`)
    }

    if (pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current)
      pendingSaveRef.current = undefined
    }

    const currentGeneration = ++writeGeneration.current
    isPersistingRef.current = true
    mutexAcquiredAtRef.current = now
    transitionTo('saving')
    workspaceEvents.emit({ type: 'PERSISTENCE_START' })

    const startMs = performance.now()
    const snapshot = config.getDraftSnapshot()
    const snapshotWithBump = { ...snapshot, version: snapshot.version + 1 }

    try {
      await LocalStoragePersistenceAdapter.saveDraft(snapshotWithBump)

      const durationMs = performance.now() - startMs

      // Stale write rejection: if generation advanced while we were saving,
      // another flush slipped in — don't clear dirty flags.
      if (writeGeneration.current === currentGeneration) {
        dirtyDomains.current.clear()
        dirtyRowIds.current.clear()
        transitionTo('saved')
        config.onMetaUpdate(durationMs)
        config.onVersionBumped?.(snapshotWithBump.version)
      }

      workspaceEvents.emit({ type: 'PERSISTENCE_SUCCESS', durationMs })
      LocalStoragePersistenceAdapter.listDrafts().then(setSavedDrafts)
    } catch (err) {
      workspaceEvents.emit({ type: 'PERSISTENCE_ERROR', error: err instanceof Error ? err : new Error('Persist failed') })
      console.error('Orchestrator persist failed:', err)
    } finally {
      isPersistingRef.current = false
    }
  }, [config, status, transitionTo])

  const enqueueSave = useCallback((delayMs = 1500) => {
    if (config.mode === 'readonly') return
    if (pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current)
    }
    pendingSaveRef.current = setTimeout(() => {
      flushNow()
    }, delayMs)
  }, [config.mode, flushNow])

  // ─── Command Dispatcher ──────────────────────────────────────────────────────
  const dispatch = useCallback((command: WorkspaceCommand) => {
    // 1. Permission Check
    if (config.mode === 'readonly') {
      workspaceEvents.emit({ type: 'MODE_REJECTED', commandType: command.type, reason: 'readonly mode' })
      return
    }

    // 2. Track Dirty State & Route Command
    let enqueued = false
    transitionTo('dirty')

    if (command.type.includes('HEADER')) {
      dirtyDomains.current.add('header')
      config.onHeaderCommand(command)
      enqueued = true
    } else if (command.type.includes('DIMENSIONS')) {
      dirtyDomains.current.add('dimensions')
      config.onDimensionCommand(command)
      enqueued = true
    } else if (
      command.type === 'ADD_ROW' || 
      command.type === 'REMOVE_ROW' || 
      command.type === 'UPDATE_CELL' || 
      command.type === 'APPLY_EXCEL_PASTE' || 
      command.type === 'SET_LINES'
    ) {
      dirtyDomains.current.add('lines')
      if (command.type === 'UPDATE_CELL') dirtyRowIds.current.add(command.rowId)
      if (command.type === 'REMOVE_ROW') dirtyRowIds.current.add(command.rowId)
      if (command.type === 'APPLY_EXCEL_PASTE') {
        command.rows.forEach((_, i) => dirtyRowIds.current.add(`paste_${command.startRowId}_${i}`))
      }
      config.onLineCommand(command)
      enqueued = true
    }

    // 3. Emit & Schedule side-effects
    if (enqueued) {
      workspaceEvents.emit({ type: 'COMMAND_DISPATCHED', command })
      enqueueSave()
    }
  }, [config, enqueueSave])

  // ─── Lifecycle / Unload handlers ─────────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow()
    }
    const handlePageHide = () => flushNow()

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [flushNow])

  // Init draft index
  useEffect(() => {
    LocalStoragePersistenceAdapter.listDrafts().then(setSavedDrafts)
  }, [])

  return {
    dispatch,
    flushNow,
    status,
    setDraftStatus: transitionTo,
    isDirty: status === 'dirty' || status === 'saving',
    savedDrafts,
    // Methods for UI orchestration
    discardDraft: async () => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current)
      await LocalStoragePersistenceAdapter.deleteDraft(config.draftId)
      const list = await LocalStoragePersistenceAdapter.listDrafts()
      setSavedDrafts(list)
    }
  }
}
