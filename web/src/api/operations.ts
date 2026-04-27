import { api, unwrap, paginatedUrl } from './core'

export interface WOTemplate {
  id: number; company_id: number
  name: string; operation_type: string; description?: string
  is_active: number; task_count?: number; created_at: string
}

export interface WOTemplateTask {
  id: number; template_id: number; company_id: number
  task_name: string; task_order: number
  estimated_hours?: number; notes?: string
}

export const operationsApi = {
  listOrders: (p?: {
    season_id?: number; field_id?: number; status?: string
    page?: number; size?: number
  }) => unwrap(api.get<unknown>(paginatedUrl('/operations/orders', p ?? {}))),

  getOrder:    (id: number) => unwrap(api.get(`/operations/orders/${id}`)),
  createOrder: (body: unknown) => api.post('/operations/orders', body),
  updateStatus:(id: number, status: string, actual_date?: string) =>
    api.patch(`/operations/orders/${id}/status`, { status, actual_date }),
  addTask:     (orderId: number, body: unknown) =>
    api.post(`/operations/orders/${orderId}/tasks`, body),
  deleteTask:  (id: number) => api.delete(`/operations/tasks/${id}`),
  summary:     (season_id?: number) =>
    unwrap(api.get<unknown[]>(`/operations/summary${season_id ? `?season_id=${season_id}` : ''}`)),

  // Templates
  listTemplates: () =>
    unwrap(api.get<WOTemplate[]>('/operations/templates')),
  getTemplate: (id: number) =>
    unwrap(api.get<WOTemplate & { tasks: WOTemplateTask[] }>(`/operations/templates/${id}`)),
  createTemplate: (body: {
    name: string; operation_type: string; description?: string
    tasks?: Array<{ task_name: string; estimated_hours?: number; notes?: string }>
  }) => unwrap(api.post<{ id: number }>('/operations/templates', body)),
  updateTemplate: (id: number, body: { name?: string; description?: string; is_active?: number }) =>
    unwrap(api.patch<null>(`/operations/templates/${id}`, body)),
  deleteTemplate: (id: number) =>
    unwrap(api.delete<null>(`/operations/templates/${id}`)),
  addTemplateTask: (tplId: number, body: {
    task_name: string; estimated_hours?: number; notes?: string
  }) => unwrap(api.post<{ id: number }>(`/operations/templates/${tplId}/tasks`, body)),
  updateTemplateTask: (taskId: number, body: {
    task_name?: string; task_order?: number; estimated_hours?: number
  }) => unwrap(api.patch<null>(`/operations/template-tasks/${taskId}`, body)),
  deleteTemplateTask: (taskId: number) =>
    unwrap(api.delete<null>(`/operations/template-tasks/${taskId}`)),
  useTemplate: (tplId: number, body: {
    name?: string; planned_date: string
    season_id?: number; field_id?: number; area_feddan?: number; notes?: string
  }) => unwrap(api.post<{ id: number; task_count: number }>(`/operations/templates/${tplId}/use`, body)),
}
