/**
 * Backward-compatibility barrel.
 *
 * All domain files in this directory import from './core'.
 * Legacy files (fields.ts, documents.ts, hr.ts, finance.ts, calendar.ts) and
 * all page components that import from './client' or '../../api/client' continue
 * to work without changes — everything is re-exported from here.
 *
 * New code should import directly from the domain file:
 *   import { suppliersApi } from '../api/suppliers'
 *   import { glApi } from '../api/gl'
 */

// ─── Core HTTP primitives ────────────────────────────────────────────────────
export { api, request, unwrap, unwrapPaginated, paginatedUrl, BASE_URL } from './core'
export type { } from './core'

// ─── Domain APIs ────────────────────────────────────────────────────────────
export { authApi }         from './auth'
export { dashboardApi }    from './dashboard'
export { suppliersApi }    from './suppliers'
export { treasuryApi }     from './treasury'
export { inventoryApi }    from './inventory'
export { configApi }       from './config'
export { usersApi }        from './users'
export { employeesApi }    from './employees'
export { operationsApi }   from './operations'
export { contractsApi }    from './contracts'
export { budgetsApi }      from './budgets'
export { reportsApi }      from './reports'
export { glApi }           from './gl'
export { auditApi }        from './audit'
export { adminApi }        from './admin'
export { classifierApi }   from './classifier'
export { exportUrl, downloadCsv } from './export'

// ─── Domain types re-exported for consumers ──────────────────────────────────
export type { RbacMatrix }                           from './auth'
export type { WOTemplate, WOTemplateTask }           from './operations'
export type { IntegrityCheck, IntegrityCheckResult } from './gl'
export type { AuditLogRow, ErrorLogEntry, AuditStats } from './audit'
export type {
  CompanyOverview, SwitchedUser, SwitchedCompany, AdminSwitchPayload
} from './admin'

// ─── Previously-extracted domains (also re-exported for backward compat) ─────
export { hrApi }                                                  from './hr'
export { financeApi }                                             from './finance'
export { calendarApi }                                            from './calendar'
export { fieldsApi }                                              from './fields'
export { documentsApi }                                           from './documents'

// Domain types from previously-extracted files
export type {
  Branch, EmployeeJobDetails, AttendanceRecord, AttendanceSummary,
  LeaveType, LeaveRequest, SalaryAdvance, PayrollRun, PayrollItem,
  EmployeeAsset, LocationTask, CreateLocationTaskInput, ArrivalResult,
  HrDashboardData,
} from './hr'
export type {
  BankAccount, BankStatement, BankReconciliation,
  PurchaseOrder, POItem, MatchStatus, POMatchRow, POInvoiceSummary,
  APAgingRow, CashTxSearchResult,
} from './finance'
export type {
  CalendarEvent, EventAttendee, CalendarEventDetail, CreateEventInput,
  ArriveResult, EventListParams, EventType, EventStatus, EventPriority, AttendeeResponse,
} from './calendar'
export type { Field, HarvestRecord, HarvestSummary }              from './fields'
export type { Document, DocumentAlert }                           from './documents'
