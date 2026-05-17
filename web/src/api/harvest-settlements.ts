import { api, unwrap } from './core'

export interface HarvestSettlement {
  id:              number
  company_id:      number
  crop_cycle_id:   number
  disposition:     'stored' | 'sold'
  total_wip_cost:  number
  qty_tons:        number | null
  cost_per_ton:    number | null
  inventory_value: number | null
  warehouse_id:    number | null
  item_code:       number | null
  revenue:         number | null
  buyer_name:      string | null
  settlement_date: string
  status:          'draft' | 'posted' | 'reversed'
  notes:           string | null
  created_by:      number
  created_at:      string
  // joined fields
  crop_name?:      string
  crop_type?:      string
  cycle_status?:   string
  field_name?:     string
  field_code?:     string
  season_name?:    string
  planting_date?:  string
  area_feddan?:    number
}

export interface CreateHarvestSettlementInput {
  crop_cycle_id:    number
  settlement_date?: string
  disposition:      'stored' | 'sold'
  qty_tons?:        number
  inventory_value?: number
  warehouse_id?:    number
  item_code?:       number
  revenue?:         number
  buyer_name?:      string
  notes?:           string
}

export interface UpdateHarvestSettlementInput {
  settlement_date?: string
  disposition?:     'stored' | 'sold'
  qty_tons?:        number
  inventory_value?: number
  warehouse_id?:    number
  item_code?:       number
  revenue?:         number
  buyer_name?:      string
  notes?:           string
}

export const harvestSettlementsApi = {
  list: (params?: { crop_cycle_id?: number; status?: string; season_id?: number }) => {
    const qs = new URLSearchParams()
    if (params?.crop_cycle_id) qs.set('crop_cycle_id', String(params.crop_cycle_id))
    if (params?.status)        qs.set('status',        params.status)
    if (params?.season_id)     qs.set('season_id',     String(params.season_id))
    const q = qs.toString()
    return unwrap<HarvestSettlement[]>(api.get(`/harvest-settlements${q ? '?' + q : ''}`))
  },

  get: (id: number) =>
    unwrap<HarvestSettlement>(api.get(`/harvest-settlements/${id}`)),

  create: (body: CreateHarvestSettlementInput) =>
    unwrap<{ id: number; total_wip_cost: number }>(api.post('/harvest-settlements', body)),

  update: (id: number, body: UpdateHarvestSettlementInput) =>
    api.patch(`/harvest-settlements/${id}`, body),

  post: (id: number) =>
    unwrap<{ id: number; status: string }>(api.post(`/harvest-settlements/${id}/post`, {})),
}
