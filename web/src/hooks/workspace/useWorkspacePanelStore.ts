import { create } from 'zustand'

export type SidePanelTab = 'gl' | 'stock' | 'health' | 'validation'

interface WorkspacePanelState {
  open: boolean
  activeTab: SidePanelTab
  width: number
  pinned: boolean
  loadingStates: Record<string, boolean>

  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setActiveTab: (tab: SidePanelTab) => void
  setWidth: (width: number) => void
  setPinned: (pinned: boolean) => void
  setLoading: (key: string, isLoading: boolean) => void
}

export const useWorkspacePanelStore = create<WorkspacePanelState>((set) => ({
  open: true,
  activeTab: 'gl',
  width: 380,
  pinned: false,
  loadingStates: {},

  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setActiveTab: (activeTab) => set({ activeTab }),
  setWidth: (width) => set({ width }),
  setPinned: (pinned) => set({ pinned }),
  setLoading: (key, isLoading) =>
    set((state) => ({
      loadingStates: { ...state.loadingStates, [key]: isLoading },
    })),
}))
