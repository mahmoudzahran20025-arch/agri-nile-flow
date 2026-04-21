import { api, unwrap } from './client'

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────
export type EventType     = 'task' | 'meeting' | 'visit' | 'reminder' | 'other'
export type EventStatus   = 'pending' | 'in_progress' | 'done' | 'cancelled'
export type EventPriority = 'low' | 'normal' | 'high' | 'urgent'
export type AttendeeResponse = 'pending' | 'accepted' | 'declined'

export interface CalendarEvent {
  id: number
  company_id: number
  created_by: number
  created_by_name: string
  assigned_to_user?: number
  assigned_to_user_name?: string
  assigned_to_employee?: number
  assigned_to_employee_name?: string

  title: string
  description?: string
  event_type: EventType
  priority: EventPriority
  status: EventStatus

  start_datetime: string    // ISO-8601 "2025-07-10T09:00"
  end_datetime?: string
  all_day: number           // 0 | 1

  location_name?: string
  location_lat?: number
  location_lng?: number
  location_tolerance_m: number

  checkin_lat?: number
  checkin_lng?: number
  checkin_at?: string
  location_verified: number  // 0 | 1
  checkin_distance_m?: number

  ref_table?: string
  ref_id?: number
  location_task_id?: number
  color: string

  attendee_count?: number
  created_at: string
  updated_at: string
}

export interface EventAttendee {
  id: number
  event_id: number
  user_id?: number
  employee_id?: number
  user_name?: string
  employee_name?: string
  name?: string
  email?: string
  response: AttendeeResponse
  created_at: string
}

export interface CalendarEventDetail extends CalendarEvent {
  attendees: EventAttendee[]
}

export interface CreateEventInput {
  title: string
  event_type?: EventType
  description?: string
  priority?: EventPriority
  start_datetime: string
  end_datetime?: string
  all_day?: number
  assigned_to_user?: number
  assigned_to_employee?: number
  location_name?: string
  location_lat?: number
  location_lng?: number
  location_tolerance_m?: number
  ref_table?: string
  ref_id?: number
  color?: string
  attendees?: Array<{
    user_id?: number
    employee_id?: number
    name?: string
    email?: string
  }>
}

export interface ArriveResult {
  within_range: boolean
  distance_m: number
  tolerance_m: number
  weak_signal: boolean
}

export interface EventListParams {
  from?: string            // YYYY-MM-DD
  to?: string              // YYYY-MM-DD
  type?: EventType
  status?: EventStatus
  assigned_to_user?: number
  assigned_to_employee?: number
}

// ──────────────────────────────────────────────────────────────
// API Methods
// ──────────────────────────────────────────────────────────────
export const calendarApi = {
  getEvents: (params?: EventListParams) => {
    const qs = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : ''
    return unwrap(api.get<CalendarEvent[]>(`/calendar/events${qs}`))
  },

  getEvent: (id: number) =>
    unwrap(api.get<CalendarEventDetail>(`/calendar/events/${id}`)),

  createEvent: (b: CreateEventInput) =>
    unwrap(api.post<{ id: number }>('/calendar/events', b)),

  updateEvent: (id: number, b: Partial<CreateEventInput> & { status?: EventStatus }) =>
    unwrap(api.patch<null>(`/calendar/events/${id}`, b)),

  markDone: (id: number) =>
    unwrap(api.patch<null>(`/calendar/events/${id}/done`, {})),

  cancelEvent: (id: number) =>
    unwrap(api.patch<null>(`/calendar/events/${id}/cancel`, {})),

  arrive: (id: number, coords: { lat: number; lng: number; accuracy_m?: number }) =>
    unwrap(api.patch<ArriveResult>(`/calendar/events/${id}/arrive`, coords)),

  addAttendee: (eventId: number, b: { user_id?: number; employee_id?: number; name?: string; email?: string }) =>
    unwrap(api.post<{ id: number }>(`/calendar/events/${eventId}/attendees`, b)),

  removeAttendee: (eventId: number, attId: number) =>
    unwrap(api.delete<null>(`/calendar/events/${eventId}/attendees/${attId}`)),

  updateAttendeeResponse: (eventId: number, attId: number, response: AttendeeResponse) =>
    unwrap(api.patch<null>(`/calendar/events/${eventId}/attendees/${attId}`, { response })),
}
