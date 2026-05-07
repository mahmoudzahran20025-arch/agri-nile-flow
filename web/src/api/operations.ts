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

export interface WOTemplateEquipment {
  id: number; template_id: number; company_id: number
  equipment_name: string; item_order: number
  estimated_hours?: number; cost_per_hour: number; notes?: string
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

  addEquipment: (orderId: number, body: {
    equipment_name: string; task_date: string
    hours_worked: number; cost_per_hour: number; notes?: string
  }) => api.post(`/operations/orders/${orderId}/equipment`, body),
  deleteEquipment: (id: number) => api.delete(`/operations/equipment/${id}`),
  summary:     (season_id?: number) =>
    unwrap(api.get<unknown[]>(`/operations/summary${season_id ? `?season_id=${season_id}` : ''}`)),
  ordersByField: (field_id: number, season_id?: number) =>
    unwrap(api.get<Array<{
      id: number; name: string; operation_type: string; status: string
      planned_date: string; actual_date: string | null
      labor_cost: number; inv_cost: number; equipment_cost: number; total_cost: number
    }>>(`/operations/orders/by-field?field_id=${field_id}${season_id ? `&season_id=${season_id}` : ''}`)),

  // Templates
  listTemplates: () =>
    unwrap(api.get<WOTemplate[]>('/operations/templates')),
  getTemplate: (id: number) =>
    unwrap(api.get<WOTemplate & { tasks: WOTemplateTask[]; equipment: WOTemplateEquipment[] }>(`/operations/templates/${id}`)),
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
  addTemplateEquipment: (tplId: number, body: {
    equipment_name: string; estimated_hours?: number; cost_per_hour?: number; notes?: string
  }) => unwrap(api.post<{ id: number }>(`/operations/templates/${tplId}/equipment`, body)),
  deleteTemplateEquipment: (equipId: number) =>
    unwrap(api.delete<null>(`/operations/template-equipment/${equipId}`)),
  useTemplate: (tplId: number, body: {
    name?: string; planned_date: string
    season_id?: number; field_id?: number; area_feddan?: number; notes?: string
  }) => unwrap(api.post<{ id: number; task_count: number; equipment_count: number }>(`/operations/templates/${tplId}/use`, body)),
}
