/**
 * Query Keys Factory
 * Centralizes all query keys to prevent typos and ensure consistent cache invalidation.
 */

export const queryKeys = {
  // Inventory Domain
  inventory: {
    all: ['inventory'] as const,
    items: () => [...queryKeys.inventory.all, 'items'] as const,
    itemDetail: (id: number) => [...queryKeys.inventory.items(), id] as const,
    warehouses: () => [...queryKeys.inventory.all, 'warehouses'] as const,
    balances: (warehouseId?: number) => [...queryKeys.inventory.all, 'balances', warehouseId] as const,
    movements: (filters?: any) => [...queryKeys.inventory.all, 'movements', filters] as const,
    batches: (warehouseId?: number) => [...queryKeys.inventory.all, 'batches', warehouseId] as const,
  },
  
  // GL Domain
  gl: {
    all: ['gl'] as const,
    accounts: () => [...queryKeys.gl.all, 'accounts'] as const,
    accountDetail: (id: number) => [...queryKeys.gl.accounts(), id] as const,
    entries: (filters?: any) => [...queryKeys.gl.all, 'entries', filters] as const,
    postingSetup: () => [...queryKeys.gl.all, 'posting-setup'] as const,
    financialVisibility: (documentId: number, type: string) => [...queryKeys.gl.all, 'visibility', type, documentId] as const,
  },

  // Master Data
  masterData: {
    all: ['master-data'] as const,
    suppliers: () => [...queryKeys.masterData.all, 'suppliers'] as const,
    businessUnits: () => [...queryKeys.masterData.all, 'business-units'] as const,
  },
}
