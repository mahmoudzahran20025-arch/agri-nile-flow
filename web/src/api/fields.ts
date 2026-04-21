import { api, unwrap } from './client'

export interface Field {
  id: number
  company_id: number
  code: string
  name: string
  area_feddan: number
  area_qirat?: number
  village?: string
  governorate?: string
  soil_type?: string
  irrigation_type?: string
  center_lat?: number
  center_lng?: number
  boundary_geojson?: string
  geofence_radius_m?: number
  status: 'active' | 'fallow' | 'rented_out' | 'sold'
  notes?: string
  created_at?: string
}

export interface HarvestRecord {
  id: number
  company_id?: number
  field_id: number
  field_name?: string
  field_code?: string
  season_id?: number
  harvest_date: string
  crop_name: string
  variety?: string
  qty_tons: number
  qty_feddan?: number
  quality_grade: 'premium' | 'standard' | 'below_standard'
  moisture_pct?: number
  impurity_pct?: number
  actual_cost: number
  sell_price_ton?: number
  revenue?: number
  profit?: number
  cost_per_feddan?: number
  notes?: string
  created_at?: string
}

export interface HarvestSummary {
  field_id: number
  field_name: string
  field_code: string
  area_feddan: number
  harvest_count: number
  total_tons: number
  avg_yield_per_feddan: number
  total_revenue: number
  total_cost: number
  total_profit: number
  avg_cost_per_feddan: number
}

export const QUALITY_LABELS: Record<string, { label: string; color: string }> = {
  premium:        { label: 'ممتاز',   color: 'bg-emerald-100 text-emerald-700' },
  standard:       { label: 'عادي',    color: 'bg-blue-100 text-blue-700' },
  below_standard: { label: 'دون المعيار', color: 'bg-amber-100 text-amber-700' },
}

export const fieldsApi = {
  list: (): Promise<Field[]> =>
    unwrap(api.get<Field[]>('/fields')),

  get: (id: number): Promise<Field> =>
    unwrap(api.get<Field>(`/fields/${id}`)),

  create: (body: Partial<Field>): Promise<Field> =>
    unwrap(api.post<Field>('/fields', body)),

  update: (id: number, body: Partial<Field>): Promise<Field> =>
    unwrap(api.patch<Field>(`/fields/${id}`, body)),

  // ── Harvest ───────────────────────────────────────────────
  listHarvests: (params?: {
    field_id?: number
    season_id?: number
    year?: string
  }): Promise<HarvestRecord[]> => {
    const qs = new URLSearchParams()
    if (params?.field_id)  qs.set('field_id',  String(params.field_id))
    if (params?.season_id) qs.set('season_id', String(params.season_id))
    if (params?.year)      qs.set('year',      params.year)
    const url = qs.toString() ? `/fields/harvest?${qs}` : '/fields/harvest'
    return unwrap(api.get<HarvestRecord[]>(url))
  },

  harvestSummary: (): Promise<HarvestSummary[]> =>
    unwrap(api.get<HarvestSummary[]>('/fields/harvest/summary')),

  createHarvest: (body: Omit<HarvestRecord, 'id' | 'company_id' | 'created_at' | 'field_name' | 'field_code'>): Promise<HarvestRecord> =>
    unwrap(api.post<HarvestRecord>('/fields/harvest', body)),

  updateHarvest: (id: number, body: Partial<HarvestRecord>): Promise<HarvestRecord> =>
    unwrap(api.patch<HarvestRecord>(`/fields/harvest/${id}`, body)),

  deleteHarvest: (id: number): Promise<void> =>
    api.delete<void>(`/fields/harvest/${id}`).then(() => undefined),
}
