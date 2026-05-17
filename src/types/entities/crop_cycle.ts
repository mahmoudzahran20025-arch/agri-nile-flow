export type CropCycleStatus = 'active' | 'harvested' | 'abandoned' | 'written_off'
export type CropType = 'annual' | 'long_cycle' | 'perennial'
export type DepreciationAllocationMethod = 'machine_hours' | 'area_ratio' | 'manual'
export type AbandonmentPolicy = 'operating_loss' | 'extraordinary_loss'

export interface CropCycleRow {
  id:                              number
  company_id:                      number
  field_id:                        number
  season_id:                       number
  crop_name:                       string
  crop_type:                       CropType
  planting_date:                   string        // YYYY-MM-DD
  expected_harvest_date:           string | null
  actual_harvest_date:             string | null
  area_feddan:                     number | null
  center_code:                     number | null
  status:                          CropCycleStatus
  abandonment_policy:              AbandonmentPolicy
  depreciation_allocation_method:  DepreciationAllocationMethod
  notes:                           string | null
  created_by:                      number | null
  created_at:                      string
  updated_at:                      string
}
