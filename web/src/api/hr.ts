// ── HR API Client ─────────────────────────────────────────────
import { api, unwrap } from './client'

// Types
export interface Branch {
  id: number; company_id: number; code: string; name: string
  address?: string; city?: string; phone?: string; manager_id?: number
  manager_name?: string; lat?: number; lng?: number
  geofence_radius_m?: number; is_active: number; created_at: string
}

export interface EmployeeJobDetails {
  id: number; employee_id: number; company_id: number
  department?: string; branch_id?: number; branch_name?: string
  position_level: string; contract_type: string; shift_type: string
  base_salary: number; housing_allow: number; transport_allow: number
  other_allows: number; social_insur: number; income_tax_pct: number
  bank_name?: string; bank_iban?: string
  start_date: string; end_date?: string; notes?: string; created_at: string
}

export interface AttendanceRecord {
  id: number; employee_id: number; employee_name: string
  company_id: number; work_date: string
  check_in?: string; check_out?: string
  check_in_lat?: number; check_in_lng?: number
  status: 'present' | 'absent' | 'late' | 'half_day' | 'holiday' | 'sick' | 'leave'
  late_minutes: number; overtime_hours: number; notes?: string
  recorded_by?: number; created_at: string
}

export interface AttendanceSummary {
  id: number; name: string
  present_days: number; absent_days: number; late_days: number
  sick_days: number; leave_days: number
  total_overtime: number; total_late_min: number
}

export interface LeaveType {
  id: number; company_id: number; name: string
  days_per_year: number; is_paid: number; is_active: number
}

export interface LeaveRequest {
  id: number; employee_id: number; employee_name: string
  company_id: number; leave_type_id: number; leave_type_name: string
  start_date: string; end_date: string; days_count: number
  reason?: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  approved_by?: number; approved_by_name?: string; approved_at?: string
  is_paid: number; notes?: string; created_at: string
}

export interface SalaryAdvance {
  id: number; employee_id: number; employee_name: string
  company_id: number; request_date: string; amount: number
  reason?: string; repay_months: number
  status: 'pending' | 'approved' | 'rejected' | 'paid'
  approved_by?: number; approved_by_name?: string; approved_at?: string
  cash_tx_id?: number; created_at: string
}

export interface PayrollRun {
  id: number; company_id: number; period_year: number; period_month: number
  run_date: string; status: 'draft' | 'approved' | 'paid' | 'cancelled'
  total_gross: number; total_deductions: number; total_net: number
  journal_entry_id?: number; approved_by?: number; approved_by_name?: string
  payment_date?: string | null; payment_gl_entry_id?: number | null
  created_by?: number; created_at: string
}

export interface PayrollItem {
  id: number; payroll_run_id: number; employee_id: number; employee_name: string
  company_id: number; working_days: number; absent_days: number
  overtime_hours: number; base_salary: number; housing_allow: number
  transport_allow: number; other_allows: number; gross_salary: number
  advance_deduct: number; social_insur: number; income_tax: number
  other_deductions: number; net_salary: number; notes?: string
}

export interface EmployeeAsset {
  id: number; employee_id: number; employee_name: string; company_id: number
  asset_name: string; asset_type?: string; serial_number?: string
  assigned_date: string; return_date?: string; condition_in?: string
  condition_out?: string; notes?: string; created_at: string
}

// ── Branch endpoints ──────────────────────────────────────────
export const hrApi = {
  // Dashboard
  getDashboard: () => unwrap(api.get<HrDashboardData>('/hr/dashboard')),

  // Branches
  getBranches:  () => unwrap(api.get<Branch[]>('/hr/branches')),
  createBranch: (b: Partial<Branch>) => unwrap(api.post<{id:number}>('/hr/branches', b)),
  updateBranch: (id: number, b: Partial<Branch>) => unwrap(api.patch<null>(`/hr/branches/${id}`, b)),

  // Job Details
  getJobDetails:  (empId: number) => unwrap(api.get<EmployeeJobDetails>(`/hr/job-details/${empId}`)),
  upsertJobDetails: (empId: number, b: Partial<EmployeeJobDetails>) =>
    unwrap(api.put<null>(`/hr/job-details/${empId}`, b)),

  // Attendance
  getAttendance: (params: Record<string, string|number>) => {
    const qs = new URLSearchParams(params as Record<string,string>).toString()
    return unwrap(api.get<AttendanceRecord[]>(`/hr/attendance?${qs}`))
  },
  bulkAttendance: (work_date: string, records: Partial<AttendanceRecord>[]) =>
    unwrap(api.post<{saved:number}>('/hr/attendance/bulk', { work_date, records })),
  getAttendanceSummary: (year: number, month: number) =>
    unwrap(api.get<AttendanceSummary[]>(`/hr/attendance/summary?year=${year}&month=${month}`)),

  // Leave Types
  getLeaveTypes:  () => unwrap(api.get<LeaveType[]>('/hr/leave-types')),
  createLeaveType: (b: Partial<LeaveType>) => unwrap(api.post<{id:number}>('/hr/leave-types', b)),

  // Leave Requests
  getLeaveRequests: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return unwrap(api.get<LeaveRequest[]>(`/hr/leave-requests${qs}`))
  },
  createLeaveRequest:  (b: Partial<LeaveRequest>) => unwrap(api.post<{id:number}>('/hr/leave-requests', b)),
  approveLeaveRequest: (id: number) => unwrap(api.patch<null>(`/hr/leave-requests/${id}/approve`, {})),
  rejectLeaveRequest:  (id: number, notes?: string) => unwrap(api.patch<null>(`/hr/leave-requests/${id}/reject`, { notes })),

  // Salary Advances
  getSalaryAdvances: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return unwrap(api.get<SalaryAdvance[]>(`/hr/salary-advances${qs}`))
  },
  createSalaryAdvance: (b: Partial<SalaryAdvance>) => unwrap(api.post<{id:number}>('/hr/salary-advances', b)),
  approveSalaryAdvance: (id: number) => unwrap(api.patch<null>(`/hr/salary-advances/${id}/approve`, {})),
  rejectSalaryAdvance:  (id: number) => unwrap(api.patch<null>(`/hr/salary-advances/${id}/reject`, {})),

  // Payroll
  getPayrollRuns: () => unwrap(api.get<PayrollRun[]>('/hr/payroll')),
  getPayrollRun:  (id: number) => unwrap(api.get<PayrollRun & {items: PayrollItem[]}>(`/hr/payroll/${id}`)),
  runPayroll:     (year: number, month: number) => unwrap(api.post<{id:number; total_net:number}>('/hr/payroll/run', { year, month })),
  approvePayroll: (id: number) => unwrap(api.patch<null>(`/hr/payroll/${id}/approve`, {})),
  payPayroll:     (id: number, payment_date: string) =>
    unwrap(api.patch<{ payment_date: string; payment_gl_entry_id: number | null }>(`/hr/payroll/${id}/pay`, { payment_date })),

  // Assets
  getAssets:    (empId?: number) => unwrap(api.get<EmployeeAsset[]>(`/hr/assets${empId ? `?employee_id=${empId}` : ''}`)),
  createAsset:  (b: Partial<EmployeeAsset>) => unwrap(api.post<{id:number}>('/hr/assets', b)),
  returnAsset:  (id: number, b: { return_date: string; condition_out?: string }) =>
    unwrap(api.patch<null>(`/hr/assets/${id}/return`, b)),

  // Employee full profile
  getEmployeeProfile: (id: number) =>
    unwrap(api.get<{
      employee: Record<string,unknown>; job_details: EmployeeJobDetails | null
      recent_attendance: AttendanceRecord[]; advances: SalaryAdvance[]
      assets: EmployeeAsset[]; leave_requests: LeaveRequest[]
    }>(`/hr/employees/${id}/profile`)),

  // ── Geo Check-in ──────────────────────────────────────────
  geoCheckIn: (b: { employee_id: number; work_date: string; lat: number; lng: number; accuracy_m: number; field_id?: number }) =>
    unwrap(api.post<{ location_status: string; distance_m: number | null; accuracy_m: number; weak_signal: boolean }>('/hr/geo/check-in', b)),

  // ── Location Tasks ────────────────────────────────────────
  getLocationTasks: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return unwrap(api.get<LocationTask[]>(`/hr/location-tasks${qs}`))
  },
  createLocationTask: (b: CreateLocationTaskInput) => unwrap(api.post<{id: number}>('/hr/location-tasks', b)),
  arriveAtTask:       (id: number, b: { lat: number; lng: number; accuracy_m?: number }) =>
    unwrap(api.patch<ArrivalResult>(`/hr/location-tasks/${id}/arrive`, b)),
  cancelLocationTask: (id: number) => unwrap(api.patch<null>(`/hr/location-tasks/${id}/cancel`, {})),
}

// ── Geo Types ──────────────────────────────────────────────────
export interface LocationTask {
  id: number; company_id: number
  employee_id: number; employee_name: string
  assigned_by: number; assigned_by_name: string
  field_id?: number; field_name?: string; field_code?: string
  custom_lat?: number; custom_lng?: number; custom_name?: string
  tolerance_m: number; task_date: string; task_notes?: string
  status: 'pending' | 'arrived' | 'outside' | 'missed'
  arrived_at?: string; arrived_lat?: number; arrived_lng?: number
  distance_m?: number; gps_accuracy_m?: number; created_at: string
}

export interface CreateLocationTaskInput {
  employee_id: number; task_date: string
  field_id?: number
  custom_lat?: number; custom_lng?: number; custom_name?: string
  tolerance_m?: number; task_notes?: string
}

export interface ArrivalResult {
  status: 'arrived' | 'outside'
  distance_m: number | null
  tolerance_m: number
  within_range: boolean
  weak_signal: boolean
}

// ── HR Dashboard Types ─────────────────────────────────────────
export interface HrDashboardData {
  today: string
  total_employees: number
  today_attendance: {
    present: number; absent: number; late: number
    sick: number; on_leave: number; total: number
  }
  pending_leaves:   number
  pending_advances: number
  today_tasks: {
    pending: number; arrived: number; outside: number; missed: number; total: number
  }
  monthly_attendance: Array<{
    month: string; present_days: number; absent_days: number; active_employees: number
  }>
  payroll_trend: Array<{
    month: string; total_gross: number; total_deductions: number; total_net: number
  }>
  expiring_documents: number
}
