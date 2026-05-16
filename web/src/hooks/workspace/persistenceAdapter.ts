import { type MovementDraft, serializeDraft } from '../../components/workspace/types'

export interface DraftIndex {
  id:         string
  updated_at: string
  type:       string
  warehouse:  string
  line_count: number
}

export interface PersistenceAdapter {
  loadDraft(id: string): Promise<MovementDraft | null>
  saveDraft(draft: MovementDraft): Promise<void>
  deleteDraft(id: string): Promise<void>
  listDrafts(): Promise<DraftIndex[]>
}

const STORAGE_PREFIX = 'agri_mvt_draft_'
const INDEX_KEY      = 'agri_mvt_drafts'
const MAX_DRAFTS     = 5

export const LocalStoragePersistenceAdapter: PersistenceAdapter = {
  async loadDraft(id: string): Promise<MovementDraft | null> {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + id)
      return raw ? JSON.parse(raw) as MovementDraft : null
    } catch {
      return null
    }
  },

  async saveDraft(draft: MovementDraft): Promise<void> {
    try {
      const serialized = serializeDraft(draft)
      localStorage.setItem(STORAGE_PREFIX + draft.id, serialized)

      // Update Index
      let index: DraftIndex[] = []
      try {
        const rawIndex = localStorage.getItem(INDEX_KEY)
        if (rawIndex) index = JSON.parse(rawIndex)
      } catch {}

      index = index.filter(d => d.id !== draft.id)
      index.unshift({
        id:         draft.id,
        updated_at: draft.updated_at,
        type:       draft.header.movement_type,
        warehouse:  String(draft.header.warehouse_id || ''),
        line_count: draft.lines.filter(l => l.item_code !== null).length,
      })

      while (index.length > MAX_DRAFTS) {
        const evicted = index.pop()
        if (evicted) localStorage.removeItem(STORAGE_PREFIX + evicted.id)
      }

      localStorage.setItem(INDEX_KEY, JSON.stringify(index))
    } catch (e) {
      console.error('Failed to save draft to localStorage', e)
      throw e
    }
  },

  async deleteDraft(id: string): Promise<void> {
    localStorage.removeItem(STORAGE_PREFIX + id)
    try {
      let index: DraftIndex[] = []
      const rawIndex = localStorage.getItem(INDEX_KEY)
      if (rawIndex) index = JSON.parse(rawIndex)
      index = index.filter(d => d.id !== id)
      localStorage.setItem(INDEX_KEY, JSON.stringify(index))
    } catch {}
  },

  async listDrafts(): Promise<DraftIndex[]> {
    try {
      const raw = localStorage.getItem(INDEX_KEY)
      return raw ? JSON.parse(raw) as DraftIndex[] : []
    } catch {
      return []
    }
  }
}
