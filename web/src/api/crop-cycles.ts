import { api, unwrap } from './core'

export type CropType   = 'annual' | 'long_cycle' | 'perennial'
export type CycleStatus = 'active' | 'harvested' | 'abandoned' | 'written_off'

export type WIPCategory =
  | 'materials' | 'labor' | 'equipment' | 'overhead' | 'depreciation'
  | 'irrigation' | 'land_rent' | 'fuel' | 'maintenance' | 'contractor'
  | 'transport'  | 'other'

export interface CropCycle {
  id:                    number
  company_id:            number
  field_id:              number
  season_id:             number
  crop_name:             string
  crop_type:             CropType
  planting_date:         string
  expected_harvest_date: string | null
  actual_harvest_date:   string | null
  area_feddan:           number | null
  center_code:           number | null
  status:                CycleStatus
  notes:                 string | null
  created_at:            string
  // joined
  field_name:            string
  field_code:            string
  season_name:           string
  total_wip_cost:        number
  total_settled:         number
  wip_balance:           number
}

export interface WIPLedgerEntry {
  id:               number
  crop_cycle_id:    number
  season_id:        number
  season_name:      string
  transaction_date: string
  cost_category:      WIPCategory
  cost_category_code: string | null
  subcategory_code:   string | null
  debit:            number
  credit:           number
  running_balance:  number
  description:      string | null
  source_module:    string | null
  source_id:        number | null
  journal_entry_id: number | null
}

export interface WIPSummary {
  crop_cycle_id: number
  crop_name:     string
  status:        CycleStatus
  total_wip:     number
  by_category:   { cost_category: WIPCategory; total_debit: number; total_credit: number; balance: number }[]
  by_season:     { season_id: number; season_name: string; total_debit: number; total_credit: number; balance: number }[]
}

export interface CreateCropCycleInput {
  field_id:               number
  season_id:              number
  crop_name:              string
  crop_type?:             CropType
  planting_date:          string
  expected_harvest_date?: string
  area_feddan?:           number
  center_code?:           number
  notes?:                 string
}

export const cropCyclesApi = {
  list: (params?: { field_id?: number; season_id?: number; status?: CycleStatus }) => {
    const qs = new URLSearchParams()
    if (params?.field_id)  qs.set('field_id',  String(params.field_id))
    if (params?.season_id) qs.set('season_id', String(params.season_id))
    if (params?.status)    qs.set('status',    params.status)
    const q = qs.toString()
    return unwrap<CropCycle[]>(api.get(`/crop-cycles${q ? '?' + q : ''}`))
  },

  get: (id: number) =>
    unwrap<CropCycle & { ledger: WIPLedgerEntry[] }>(
      api.get(`/crop-cycles/${id}`)
    ),

  create: (body: CreateCropCycleInput) =>
    unwrap<{ id: number }>(
      api.post('/crop-cycles', body)
    ),

  update: (id: number, body: Partial<Pick<CropCycle, 'crop_name' | 'expected_harvest_date' | 'area_feddan' | 'center_code' | 'notes'>>) =>
    unwrap<void>(
      api.patch(`/crop-cycles/${id}`, body)
    ),

  abandon: (id: number, opts?: { abandonment_date?: string; notes?: string }) =>
    unwrap<{ gl_entry_id: number | null; wip_written_off: number }>(
      api.post(`/crop-cycles/${id}/abandon`, opts ?? {})
    ),

  writeOff: (id: number, opts?: { writeoff_date?: string; notes?: string }) =>
    unwrap<{ gl_entry_id: number | null; wip_written_off: number }>(
      api.post(`/crop-cycles/${id}/write-off`, opts ?? {})
    ),

  wipSummary: (id: number) =>
    unwrap<WIPSummary>(
      api.get(`/crop-cycles/${id}/wip-summary`)
    ),
}
