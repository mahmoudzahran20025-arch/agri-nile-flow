// D1 row shape for the business_events table.
// payload is stored as JSON text; parse before use.

export type BusinessEventStatus = 'pending' | 'posted' | 'error' | 'reversed'

export interface BusinessEventRow {
  id:               number
  company_id:       number
  event_type:       string
  event_date:       string             // YYYY-MM-DD
  source_module:    string
  source_id:        number
  payload:          string             // JSON text
  status:           BusinessEventStatus
  error_message:    string | null
  journal_entry_id: number | null
  posted_by:        number | null
  posted_at:        string | null      // ISO datetime
  created_at:       string             // ISO datetime
}
