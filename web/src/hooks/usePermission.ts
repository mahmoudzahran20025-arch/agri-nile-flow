import { useAppStore } from '../store/appStore'

export type Module =
  | 'treasury' | 'suppliers' | 'inventory' | 'fields'
  | 'employees' | 'operations' | 'contracts' | 'gl'
  | 'users' | 'config' | 'reports' | 'admin'

export function usePermission() {
  const { role, permissions } = useAppStore()
  
  const has = (module: string, action: string) => {
    if (role === 'super_admin' || role === 'company_admin') return true
    return permissions.includes(`${module}.${action}`)
  }

  return {
    role,
    canRead:  (module: string) => has(module, 'read') || has(module, 'view'),
    canWrite: (module: string) => has(module, 'create') || has(module, 'edit') || has(module, 'write'),
    canDelete:(module: string) => has(module, 'delete'),
    isAdmin:  () => role === 'super_admin' || role === 'company_admin',
    hasPermission: has,
  }
}
