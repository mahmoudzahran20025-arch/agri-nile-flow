import { api, unwrap } from './core'

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
  is_active?: number
  location?: string
  season_id?: number
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
  // Optional params for backward compat with pages that filter by season
  list: (p?: { season_id?: number; q?: string }): Promise<Field[]> => {
    const qs = new URLSearchParams()
    if (p?.season_id) qs.set('season_id', String(p.season_id))
    if (p?.q)         qs.set('q', p.q)
    const url = qs.toString() ? `/fields?${qs}` : '/fields'
    return unwrap(api.get<Field[]>(url))
  },

  get: (id: number): Promise<Field> =>
    unwrap(api.get<Field>(`/fields/${id}`)),

  // Returns raw ApiResult so pages can check .success/.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: (body: any) => api.post<unknown>('/fields', body),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: (id: number, body: any) => api.patch<unknown>(`/fields/${id}`, body),

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

  costEstimate: (field_id: number, season_id: number): Promise<{
    field_id: number; season_id: number; field_name: string; field_code: string
    area_feddan: number; materials_cost: number; labor_cost: number
    land_rent: number; total_cost: number; note: string
  }> =>
    unwrap(api.get(`/fields/harvest/cost-estimate?field_id=${field_id}&season_id=${season_id}`)),

  updateHarvest: (id: number, body: Partial<HarvestRecord>): Promise<HarvestRecord> =>
    unwrap(api.patch<HarvestRecord>(`/fields/harvest/${id}`, body)),

  deleteHarvest: (id: number): Promise<void> =>
    api.delete<void>(`/fields/harvest/${id}`).then(() => undefined),
}
