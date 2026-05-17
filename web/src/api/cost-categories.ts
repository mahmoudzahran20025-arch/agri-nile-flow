import { api, unwrap } from './core'

export interface CostCategory {
  id:             number
  company_id:     number
  code:           string
  name_ar:        string
  name_en:        string | null
  parent_id:      number | null
  system_type:    string
  is_system:      number
  is_active:      number
  sort_order:     number
  created_at:     string
  parent_code:    string | null
  parent_name_ar: string | null
}

export const costCategoriesApi = {
  list: (params?: { include_inactive?: boolean }) => {
    const qs = params?.include_inactive ? '?include_inactive=1' : ''
    return unwrap<CostCategory[]>(api.get(`/cost-categories${qs}`))
  },

  get: (code: string) =>
    unwrap<CostCategory>(api.get(`/cost-categories/${code}`)),

  create: (body: { code: string; name_ar: string; name_en?: string; parent_id: number; sort_order?: number }) =>
    unwrap<{ id: number }>(api.post('/cost-categories', body)),

  update: (code: string, body: { name_ar?: string; name_en?: string; is_active?: boolean; sort_order?: number }) =>
    unwrap<void>(api.patch(`/cost-categories/${code}`, body)),
}
