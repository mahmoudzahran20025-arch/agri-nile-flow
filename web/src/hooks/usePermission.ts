import { useRole } from '../store/appStore'

export type Module =
  | 'treasury'
  | 'suppliers'
  | 'inventory'
  | 'fields'
  | 'employees'
  | 'operations'
  | 'contracts'
  | 'gl'
  | 'users'
  | 'config'

const WRITE_ACCESS: Record<string, Module[]> = {
  super_admin:      ['treasury','suppliers','inventory','fields','employees','operations','contracts','gl','users','config'],
  company_admin:    ['treasury','suppliers','inventory','fields','employees','operations','contracts','gl','users','config'],
  accountant:       ['treasury','suppliers','contracts','gl'],
  warehouse_mgr:    ['inventory'],
  field_supervisor: ['fields','employees','operations'],
  viewer:           [],
}

export function usePermission() {
  const role = useRole() ?? 'viewer'
  const allowed = WRITE_ACCESS[role] ?? []

  return {
    role,
    canWrite: (module: Module) => allowed.includes(module),
    isAdmin:  () => role === 'super_admin' || role === 'company_admin',
  }
}
