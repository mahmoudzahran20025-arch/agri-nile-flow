import { api, unwrap } from './client'

export const wipApi = {
  postManualEntry: (body: {
    crop_cycle_id:      number
    cost_category_code: string
    amount:             number
    description:        string
    transaction_date:   string
  }) => unwrap(api.post<{ wip_ledger_id: number; running_balance: number }>('/wip/manual-entry', body)),

  listManualEntries: (cropCycleId: number) =>
    unwrap(api.get<Array<{
      id:                 number
      transaction_date:   string
      cost_category:      string
      cost_category_code: string | null
      debit:              number
      running_balance:    number
      description:        string | null
      category_name:      string | null
    }>>(`/wip/entries?crop_cycle_id=${cropCycleId}`)),
}
