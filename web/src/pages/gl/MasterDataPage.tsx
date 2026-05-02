/**
 * web/src/pages/gl/MasterDataPage.tsx
 * 
 * Phase 1: Master Data Management (Material Groups, Business Units)
 * Provides UI for creating and managing dimension masters
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { glApi } from '../../api/gl'

interface TabState {
  active: 'material-groups' | 'business-units' | 'reference'
}

interface FormState {
  code: string
  name: string
  description: string
}

interface EditingState {
  id: number | null
  mode: 'view' | 'add' | 'edit'
}

export default function MasterDataPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabState['active']>('material-groups')
  const [formState, setFormState] = useState<FormState>({ code: '', name: '', description: '' })
  const [editingState, setEditingState] = useState<EditingState>({ id: null, mode: 'view' })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // ── Material Groups ─────────────────────────────────────────────────────────

  const { data: materialGroups, isLoading: mgLoading } = useQuery({
    queryKey: ['material-groups'],
    queryFn: () => glApi.materialGroups(true),
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const createMaterialGroupMutation = useMutation({
    mutationFn: (data: FormState) => glApi.createMaterialGroup({
      code: data.code,
      name: data.name,
      description: data.description || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-groups'] })
      setSuccess('تم إنشاء مجموعة المواد بنجاح')
      resetForm()
      setTimeout(() => setSuccess(null), 3000)
    },
    onError: (error: any) => {
      setError(error?.message || 'خطأ في إنشاء مجموعة المواد')
      setTimeout(() => setError(null), 5000)
    },
  })

  const updateMaterialGroupMutation = useMutation({
    mutationFn: (data: FormState & { id: number }) =>
      glApi.updateMaterialGroup(data.id, { code: data.code, name: data.name, description: data.description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-groups'] })
      setSuccess('تم تحديث مجموعة المواد بنجاح')
      resetForm()
      setTimeout(() => setSuccess(null), 3000)
    },
    onError: (error: any) => {
      setError(error?.message || 'خطأ في تحديث مجموعة المواد')
      setTimeout(() => setError(null), 5000)
    },
  })

  // ── Business Units ──────────────────────────────────────────────────────────

  const { data: businessUnits, isLoading: buLoading } = useQuery({
    queryKey: ['business-units'],
    queryFn: () => glApi.businessUnits(true),
    refetchInterval: 30000,
  })

  const createBusinessUnitMutation = useMutation({
    mutationFn: (data: FormState) => glApi.createBusinessUnit({
      code: data.code,
      name: data.name,
      description: data.description || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-units'] })
      setSuccess('تم إنشاء الوحدة التنظيمية بنجاح')
      resetForm()
      setTimeout(() => setSuccess(null), 3000)
    },
    onError: (error: any) => {
      setError(error?.message || 'خطأ في إنشاء الوحدة التنظيمية')
      setTimeout(() => setError(null), 5000)
    },
  })

  const updateBusinessUnitMutation = useMutation({
    mutationFn: (data: FormState & { id: number }) =>
      glApi.updateBusinessUnit(data.id, { code: data.code, name: data.name, description: data.description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-units'] })
      setSuccess('تم تحديث الوحدة التنظيمية بنجاح')
      resetForm()
      setTimeout(() => setSuccess(null), 3000)
    },
    onError: (error: any) => {
      setError(error?.message || 'خطأ في تحديث الوحدة التنظيمية')
      setTimeout(() => setError(null), 5000)
    },
  })

  // ── Reference Data ──────────────────────────────────────────────────────────

  const { data: accountRoles, isLoading: arLoading } = useQuery({
    queryKey: ['account-roles'],
    queryFn: () => glApi.accountRoles(),
  })

  const { data: currencies, isLoading: curLoading } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => glApi.currencies(),
  })

  const { data: costingMethods, isLoading: cmLoading } = useQuery({
    queryKey: ['costing-methods'],
    queryFn: () => glApi.costingMethods(),
  })

  // ── Handlers ────────────────────────────────────────────────────────────────

  const resetForm = () => {
    setFormState({ code: '', name: '', description: '' })
    setEditingState({ id: null, mode: 'view' })
  }

  const handleSave = async () => {
    if (!formState.code || !formState.name) {
      setError('الكود والاسم مطلوبان')
      setTimeout(() => setError(null), 3000)
      return
    }

    try {
      if (tab === 'material-groups') {
        if (editingState.mode === 'add') {
          await createMaterialGroupMutation.mutateAsync(formState)
        } else if (editingState.mode === 'edit') {
          await updateMaterialGroupMutation.mutateAsync({
            ...formState,
            id: editingState.id!,
          })
        }
      } else if (tab === 'business-units') {
        if (editingState.mode === 'add') {
          await createBusinessUnitMutation.mutateAsync(formState)
        } else if (editingState.mode === 'edit') {
          await updateBusinessUnitMutation.mutateAsync({
            ...formState,
            id: editingState.id!,
          })
        }
      }
    } catch (err) {
      console.error('Save error:', err)
    }
  }

  const handleEdit = (item: any) => {
    setFormState({
      code: item.code,
      name: item.name,
      description: item.description || '',
    })
    setEditingState({ id: item.id, mode: 'edit' })
  }

  const handleAdd = () => {
    resetForm()
    setEditingState({ id: null, mode: 'add' })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">إدارة البيانات الأساسية</h1>
          <p className="text-gray-600 mt-2">إدارة مجموعات المواد والوحدات التنظيمية والبيانات المرجعية</p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
            {success}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          <button
            onClick={() => { setTab('material-groups'); resetForm() }}
            className={`px-4 py-3 font-medium border-b-2 transition ${
              tab === 'material-groups'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-600 border-transparent hover:text-gray-900'
            }`}
          >
            مجموعات المواد
          </button>
          <button
            onClick={() => { setTab('business-units'); resetForm() }}
            className={`px-4 py-3 font-medium border-b-2 transition ${
              tab === 'business-units'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-600 border-transparent hover:text-gray-900'
            }`}
          >
            الوحدات التنظيمية
          </button>
          <button
            onClick={() => { setTab('reference'); resetForm() }}
            className={`px-4 py-3 font-medium border-b-2 transition ${
              tab === 'reference'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-600 border-transparent hover:text-gray-900'
            }`}
          >
            البيانات المرجعية
          </button>
        </div>

        {/* Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form Panel */}
          {tab !== 'reference' && (
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  {editingState.mode === 'add'
                    ? tab === 'material-groups'
                      ? 'إنشاء مجموعة مواد جديدة'
                      : 'إنشاء وحدة تنظيمية جديدة'
                    : 'تعديل'}
                </h2>

                <form className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      الكود *
                    </label>
                    <input
                      type="text"
                      value={formState.code}
                      onChange={(e) => setFormState({ ...formState, code: e.target.value.toUpperCase() })}
                      disabled={editingState.mode === 'view'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="مثال: MAT_001"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      الاسم *
                    </label>
                    <input
                      type="text"
                      value={formState.name}
                      onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                      disabled={editingState.mode === 'view'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="أدخل الاسم"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      الوصف
                    </label>
                    <textarea
                      value={formState.description}
                      onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                      disabled={editingState.mode === 'view'}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="أدخل الوصف (اختياري)"
                    />
                  </div>

                  {editingState.mode !== 'view' && (
                    <div className="flex gap-2 pt-4">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={createMaterialGroupMutation.isPending || updateMaterialGroupMutation.isPending || createBusinessUnitMutation.isPending || updateBusinessUnitMutation.isPending}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
                      >
                        حفظ
                      </button>
                      <button
                        type="button"
                        onClick={resetForm}
                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
                      >
                        إلغاء
                      </button>
                    </div>
                  )}
                </form>
              </div>
            </div>
          )}

          {/* List Panel */}
          <div className={tab === 'reference' ? 'lg:col-span-3' : 'lg:col-span-2'}>
            {tab === 'material-groups' && (
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                  <h2 className="text-xl font-bold text-gray-900">قائمة مجموعات المواد</h2>
                  <button
                    onClick={handleAdd}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition"
                  >
                    + إضافة جديد
                  </button>
                </div>

                {mgLoading ? (
                  <div className="p-6 text-center text-gray-500">جاري التحميل...</div>
                ) : (materialGroups?.data ?? []).length === 0 ? (
                  <div className="p-6 text-center text-gray-500">لا توجد مجموعات مواد</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الكود</th>
                          <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الاسم</th>
                          <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الوصف</th>
                          <th className="px-6 py-3 text-center text-sm font-medium text-gray-700">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(materialGroups?.data ?? []).map((item: any) => (
                          <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-mono text-gray-900">{item.code}</td>
                            <td className="px-6 py-4 text-sm text-gray-900">{item.name}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{item.description || '-'}</td>
                            <td className="px-6 py-4 text-center">
                              <button
                                onClick={() => handleEdit(item)}
                                className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                              >
                                تعديل
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === 'business-units' && (
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                  <h2 className="text-xl font-bold text-gray-900">قائمة الوحدات التنظيمية</h2>
                  <button
                    onClick={handleAdd}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition"
                  >
                    + إضافة جديد
                  </button>
                </div>

                {buLoading ? (
                  <div className="p-6 text-center text-gray-500">جاري التحميل...</div>
                ) : (businessUnits?.data ?? []).length === 0 ? (
                  <div className="p-6 text-center text-gray-500">لا توجد وحدات تنظيمية</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الكود</th>
                          <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الاسم</th>
                          <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الوصف</th>
                          <th className="px-6 py-3 text-center text-sm font-medium text-gray-700">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(businessUnits?.data ?? []).map((item: any) => (
                          <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-mono text-gray-900">{item.code}</td>
                            <td className="px-6 py-4 text-sm text-gray-900">{item.name}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{item.description || '-'}</td>
                            <td className="px-6 py-4 text-center">
                              <button
                                onClick={() => handleEdit(item)}
                                className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                              >
                                تعديل
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === 'reference' && (
              <div className="space-y-6">
                {/* Account Roles */}
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="p-6 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-900">أدوار الحسابات</h2>
                  </div>
                  {arLoading ? (
                    <div className="p-6 text-center text-gray-500">جاري التحميل...</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الكود</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الاسم</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الفئة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(accountRoles?.data ?? []).map((item: any) => (
                            <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-6 py-4 text-sm font-mono text-gray-900">{item.code}</td>
                              <td className="px-6 py-4 text-sm text-gray-900">{item.name}</td>
                              <td className="px-6 py-4 text-sm text-gray-600">{item.category || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Currencies */}
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="p-6 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-900">العملات</h2>
                  </div>
                  {curLoading ? (
                    <div className="p-6 text-center text-gray-500">جاري التحميل...</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الكود</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الاسم</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الرمز</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(currencies?.data ?? []).map((item: any) => (
                            <tr key={item.code} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-6 py-4 text-sm font-mono text-gray-900">{item.code}</td>
                              <td className="px-6 py-4 text-sm text-gray-900">{item.name}</td>
                              <td className="px-6 py-4 text-sm text-gray-600">{item.symbol || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Costing Methods */}
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="p-6 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-900">طرق التكلفة</h2>
                  </div>
                  {cmLoading ? (
                    <div className="p-6 text-center text-gray-500">جاري التحميل...</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الكود</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الاسم</th>
                            <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">الوصف</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(costingMethods?.data ?? []).map((item: any) => (
                            <tr key={item.code} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-6 py-4 text-sm font-mono text-gray-900">{item.code}</td>
                              <td className="px-6 py-4 text-sm text-gray-900">{item.name}</td>
                              <td className="px-6 py-4 text-sm text-gray-600">{item.description || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
