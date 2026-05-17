import { api, unwrap } from './core'

export interface BulkImportResult {
  inserted: number
  updated:  number
  failed:   number
  total:    number
  results:  Array<{ code: number; name: string; status: 'ok' | 'error'; error?: string }>
}

export const configApi = {
  seasons:           () => unwrap(api.get('/config/seasons')),
  createSeason:      (body: unknown) => api.post('/config/seasons', body),
  updateSeasonStatus:(id: number, status: string) =>
    api.patch(`/config/seasons/${id}/status`, { status }),
  seasonCloseCheck:  (id: number) =>
    unwrap(api.get(`/config/seasons/${id}/close-check`)),
  closeSeason:       (id: number, close_notes?: string, force?: boolean) =>
    unwrap(api.post<{ id: number; status: string }>(`/config/seasons/${id}/close`, { close_notes, force })),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items:       () => unwrap(api.get<any[]>('/config/items')),
  createItem:  (body: unknown) => api.post('/config/items', body),
  updateItem:  (code: number, body: unknown) => api.patch(`/config/items/${code}`, body),

  costCenters:    () => unwrap(api.get('/config/cost_centers')),
  accounts:       () => unwrap(api.get('/config/accounts')),
  expenseTypes:   () => unwrap(api.get('/config/expense_types')),
  equipmentTypes: () => unwrap(api.get('/config/equipment_types')),
  operationTypes: () => unwrap(api.get<{ id: number; name: string; sort_order: number; is_active: number }[]>('/config/operation_types')),
  companies:      () => unwrap(api.get('/config/companies')),

  bulkImportItems:     (rows: unknown[]) =>
    unwrap(api.post<BulkImportResult>('/config/items/bulk-import', { rows })),
  bulkImportSuppliers: (rows: unknown[]) =>
    unwrap(api.post<BulkImportResult>('/config/suppliers/bulk-import', { rows })),

  integrations:      () =>
    unwrap(api.get<{ module_key: string; is_enabled: number }[]>('/config/gl-integrations')),
  updateIntegration: (
    key: string,
    is_enabled: boolean,
    options?: { force?: boolean; reason?: string }
  ) => {
    const qs = options?.force ? '?force=1' : ''
    return api.patch(`/config/gl-integrations/${key}${qs}`, {
      is_enabled,
      reason: options?.reason,
    })
  },
}
