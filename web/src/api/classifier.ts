import { api, unwrap } from './core'

export interface MappingRule {
  id: number
  company_id: number
  keyword: string
  category_type: 'expense' | 'supplier' | 'partner' | 'bank' | 'cost_center'
  target_id: number
  direct_gl_account?: string | null
  created_at: string
  expense_name?: string
  supplier_name?: string
  partner_name?: string
}

export interface UnmappedNarration {
  narration: string
  occurrences: number
  total_volume: number
}

export const classifierApi = {
  getUnmapped: () => unwrap(api.get<UnmappedNarration[]>('/classifier/unmapped')),
  getRules:    () => unwrap(api.get<MappingRule[]>('/classifier/rules')),
  createRule:  (body: {
    keyword: string
    category_type: 'expense' | 'supplier' | 'partner' | 'bank' | 'cost_center'
    target_id: number
    direct_gl_account?: string | null
  }) => api.post('/classifier/rules', body),
  deleteRule:  (id: number) => api.delete(`/classifier/rules/${id}`),
  reconcileLegacy: () => unwrap(api.post<{ updated_count: number }>('/classifier/reconcile-legacy', {})),
}
