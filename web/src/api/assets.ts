import { api, unwrap } from './core'

export interface FixedAsset {
  id: number
  asset_code: string
  name: string
  category: 'equipment' | 'vehicle' | 'irrigation' | 'building' | 'land_improvement' | 'other'
  acquisition_date: string
  cost: number
  salvage_value: number
  useful_life_months: number
  depreciation_method: 'straight_line' | 'declining_balance'
  field_id: number | null
  season_id: number | null
  is_active: number
  notes: string | null
  created_at: string
  supplier_transaction_id: number | null
  journal_entry_id: number | null
  // WIP allocation routing (Phase 5)
  crop_cycle_id:                  number | null
  allocation_method:              'percentage' | 'machine_hours' | 'acreage' | 'manual' | null
  depreciation_allocation_method: 'machine_hours' | 'area_ratio' | 'manual' | null
}

export interface DepreciationScheduleRow {
  id: number
  asset_id: number
  period_year: number
  period_month: number
  amount: number
  accumulated: number
  journal_entry_id: number | null
  status: 'pending' | 'posted' | 'skipped'
}

export interface DepreciationRunResult {
  posted: number
  skipped: number
  errors: string[]
}

export const assetsApi = {
  list: () =>
    unwrap(api.get<FixedAsset[]>('/assets')),

  create: (body: {
    asset_code: string
    name: string
    category: string
    acquisition_date: string
    cost: number
    salvage_value?: number
    useful_life_months?: number
    depreciation_method?: string
    field_id?: number
    season_id?: number
    notes?: string
  }) =>
    unwrap(api.post<{ id: number }>('/assets', body)),

  update: (id: number, body: {
    name?: string
    cost?: number
    salvage_value?: number
    useful_life_months?: number
    is_active?: boolean
    notes?: string
    crop_cycle_id?: number | null
    allocation_method?: string | null
    depreciation_allocation_method?: string | null
  }) =>
    unwrap(api.patch<void>(`/assets/${id}`, body)),

  schedule: (id: number) =>
    unwrap(api.get<{ schedule: DepreciationScheduleRow[] }>(`/assets/${id}/schedule`)),

  runDepreciation: () =>
    unwrap(api.post<DepreciationRunResult>('/assets/run-depreciation', {})),
}
