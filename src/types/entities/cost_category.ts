export interface CostCategoryRow {
  id:          number
  company_id:  number
  code:        string
  name_ar:     string
  name_en:     string | null
  parent_id:   number | null
  system_type: string       // canonical aggregation key (matches original enum values)
  is_system:   number       // 0 | 1 — system rows cannot be deleted
  is_active:   number       // 0 | 1
  sort_order:  number
  created_at:  string
}
