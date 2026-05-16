import { useState, useCallback, useEffect } from 'react'
import { LocalStoragePersistenceAdapter, type DraftIndex } from './persistenceAdapter'
import { workspaceEvents } from './workspaceEvents'

export interface DraftRecoveryState {
  availableDrafts: DraftIndex[];
  isScanning: boolean;
}

export function useDraftRecoveryManager() {
  const [state, setState] = useState<DraftRecoveryState>({
    availableDrafts: [],
    isScanning: true,
  })

  const scanForDrafts = useCallback(async () => {
    setState(prev => ({ ...prev, isScanning: true }))
    try {
      const drafts = await LocalStoragePersistenceAdapter.listDrafts()
      // Filter out drafts that are older than 30 days or deemed corrupted
      const now = Date.now()
      const validDrafts = drafts.filter(draft => {
        const draftTime = new Date(draft.updated_at).getTime()
        const isExpired = now - draftTime > 30 * 24 * 60 * 60 * 1000 // 30 days
        return !isExpired
      })
      
      // If we filtered out any, we might want to clean them up in the future
      setState({ availableDrafts: validDrafts, isScanning: false })
    } catch (error) {
      console.error('Failed to scan for drafts:', error)
      setState({ availableDrafts: [], isScanning: false })
    }
  }, [])

  useEffect(() => {
    scanForDrafts()
  }, [scanForDrafts])

  const quarantineDraft = useCallback(async (draftId: string, reason: string) => {
    workspaceEvents.emit({ type: 'DRAFT_QUARANTINED', payload: { draftId, reason } } as any)
    // Simply delete it from active index for now, could be moved to a separate quarantine store
    await LocalStoragePersistenceAdapter.deleteDraft(draftId)
    await scanForDrafts()
  }, [scanForDrafts])

  return {
    ...state,
    scanForDrafts,
    quarantineDraft,
  }
}
