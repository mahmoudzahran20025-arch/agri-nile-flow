/**
 * web/src/pages/gl/AccountRolePolicyPage.tsx
 *
 * Phase 3: Account Role Policy Engine
 * View role-to-account mappings, coverage gaps, resolve roles + manage mappings
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { glApi, type RolePolicyRow, type RoleCoverageRow, type RoleCoverageMeta } from '../../api/gl'

interface AddMappingForm {
  role_code:    string
  account_code: string
  priority:     string
  notes:        string
}

const defaultForm: AddMappingForm = {
  role_code:    '',
  account_code: '',
  priority:     '1',
  notes:        '',
}

type TabState = 'mappings' | 'coverage' | 'resolve'

export default function AccountRolePolicyPage() {
  const queryClient = useQueryClient()
  const [tab, setTab]         = useState<TabState>('mappings')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState<AddMappingForm>(defaultForm)
  const [resolveRole, setResolveRole] = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // ── Data queries ─────────────────────────────────────────────────────────────
  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey:      ['account-role-policy'],
    queryFn:       () => glApi.accountRolePolicy(true),
    refetchInterval: 60000,
  })

  const { data: coverageData, isLoading: coverageLoading } = useQuery({
    queryKey:      ['account-role-policy-coverage'],
    queryFn:       () => glApi.accountRolePolicyCoverage(),
    enabled:       tab === 'coverage',
    staleTime:     60000,
  })

  const { data: resolveData, isFetching: resolving, refetch: doResolve } = useQuery({
    queryKey:  ['role-resolve', resolveRole],
    queryFn:   () => glApi.resolveAccountByRole(resolveRole.toUpperCase()),
    enabled:   false,
    retry:     false,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (f: AddMappingForm) => glApi.createRoleMapping({
      role_code:    f.role_code.toUpperCase(),
      account_code: f.account_code,
      priority:     parseInt(f.priority) || 1,
      notes:        f.notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-role-policy'] })
      queryClient.invalidateQueries({ queryKey: ['account-role-policy-coverage'] })
      setSuccess('تم حفظ التعيين بنجاح')
      setShowAdd(false)
      setForm(defaultForm)
      setTimeout(() => setSuccess(null), 3000)
    },
    onError: (e: Error) => {
      setError(e.message || 'خطأ في حفظ التعيين')
      setTimeout(() => setError(null), 5000)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => glApi.deleteRoleMapping(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-role-policy'] })
      queryClient.invalidateQueries({ queryKey: ['account-role-policy-coverage'] })
      setSuccess('تم إلغاء تفعيل التعيين')
      setTimeout(() => setSuccess(null), 3000)
    },
    onError: (e: Error) => {
      setError(e.message || 'خطأ في الحذف')
      setTimeout(() => setError(null), 5000)
    },
  })

  const mappings: RolePolicyRow[] = (mappingsData as { data?: RolePolicyRow[] })?.data ?? []
  const coverageRows: RoleCoverageRow[] = (coverageData as { data?: RoleCoverageRow[] })?.data ?? []
  const coverageMeta: RoleCoverageMeta | null = (coverageData as { meta?: RoleCoverageMeta })?.meta ?? null
  const resolveResult = resolveData?.data ?? null

  const categoryColor = (cat: string) => {
    if (cat?.includes('INVENTORY'))      return 'bg-amber-100 text-amber-700'
    if (cat?.includes('P&L'))            return 'bg-blue-100 text-blue-700'
    if (cat?.includes('BALANCE_SHEET'))  return 'bg-purple-100 text-purple-700'
    if (cat?.includes('CONTROL'))        return 'bg-red-100 text-red-700'
    return 'bg-gray-100 text-gray-600'
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">سياسة أدوار الحسابات</h1>
            <p className="text-sm text-gray-500 mt-1">
              ربط الأدوار المحاسبية (CASH، AR، AP…) بحسابات دليل الحسابات
            </p>
          </div>
          {tab === 'mappings' && (
            <button
              onClick={() => setShowAdd(v => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition"
            >
              <span>+</span> إضافة تعيين
            </button>
          )}
        </div>

        {/* ── Alerts ── */}
        {error   && <div className="rounded-lg bg-red-50   border border-red-200   text-red-700   px-4 py-3 text-sm">{error}</div>}
        {success && <div className="rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">{success}</div>}

        {/* ── Tabs ── */}
        <div className="flex border-b border-gray-200">
          {([
            { key: 'mappings',  label: 'التعيينات' },
            { key: 'coverage',  label: 'تغطية الأدوار' },
            { key: 'resolve',   label: 'حل الدور' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition ${
                tab === t.key
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════ MAPPINGS TAB ══════════ */}
        {tab === 'mappings' && (
          <>
            {/* Add form */}
            {showAdd && (
              <div className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
                <h2 className="font-semibold text-gray-800 mb-4">إضافة / تحديث تعيين دور</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">كود الدور</label>
                    <input type="text" value={form.role_code} placeholder="CASH"
                      onChange={e => setForm(f => ({ ...f, role_code: e.target.value.toUpperCase() }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">كود الحساب</label>
                    <input type="text" value={form.account_code} placeholder="14010101"
                      onChange={e => setForm(f => ({ ...f, account_code: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">الأولوية</label>
                    <input type="number" min="1" max="99" value={form.priority}
                      onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">ملاحظات</label>
                    <input type="text" value={form.notes} placeholder="اختياري"
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button
                    disabled={createMutation.isPending || !form.role_code || !form.account_code}
                    onClick={() => createMutation.mutate(form)}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
                  >
                    {createMutation.isPending ? 'جاري الحفظ…' : 'حفظ التعيين'}
                  </button>
                  <button onClick={() => setShowAdd(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition">
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {/* Mappings table */}
            {mappingsLoading ? (
              <div className="text-center py-12 text-gray-400">جاري التحميل…</div>
            ) : (
              <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-right text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                      <th className="px-5 py-3 font-medium">الدور</th>
                      <th className="px-5 py-3 font-medium">الفئة</th>
                      <th className="px-5 py-3 font-medium">كود الحساب</th>
                      <th className="px-5 py-3 font-medium">اسم الحساب</th>
                      <th className="px-5 py-3 font-medium">نوع الحساب</th>
                      <th className="px-5 py-3 font-medium">أولوية</th>
                      <th className="px-5 py-3 font-medium">ملاحظات</th>
                      <th className="px-5 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map(m => (
                      <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                        <td className="px-5 py-3">
                          <span className="font-mono font-bold text-gray-900">{m.role_code}</span>
                          {m.role_name && <div className="text-xs text-gray-400">{m.role_name}</div>}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${categoryColor(m.role_category ?? '')}`}>
                            {m.role_category ?? '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-gray-700">{m.account_code}</td>
                        <td className="px-5 py-3 text-gray-700">{m.account_name ?? '—'}</td>
                        <td className="px-5 py-3">
                          <span className="text-xs text-gray-500">{m.account_type ?? '—'}</span>
                        </td>
                        <td className="px-5 py-3 text-center text-gray-600">{m.priority}</td>
                        <td className="px-5 py-3 text-xs text-gray-400 max-w-[160px] truncate">{m.notes ?? '—'}</td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => { if (window.confirm(`حذف تعيين ${m.role_code}?`)) deleteMutation.mutate(m.id) }}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition"
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                    {mappings.length === 0 && (
                      <tr><td colSpan={8} className="px-5 py-10 text-center text-gray-400">لا توجد تعيينات</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ══════════ COVERAGE TAB ══════════ */}
        {tab === 'coverage' && (
          <>
            {/* Coverage summary */}
            {coverageMeta && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {([
                  { label: 'إجمالي الأدوار',   value: coverageMeta.total_roles,    color: 'bg-gray-100 text-gray-700' },
                  { label: 'أدوار معيّنة',      value: coverageMeta.mapped_roles,   color: 'bg-green-100 text-green-700' },
                  { label: 'أدوار غير معيّنة', value: coverageMeta.unmapped_roles, color: 'bg-red-100 text-red-700' },
                  { label: 'نسبة التغطية',      value: `${coverageMeta.coverage_pct}%`, color: coverageMeta.coverage_pct >= 70 ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700' },
                ] as const).map((stat, i) => (
                  <div key={i} className={`rounded-xl p-4 text-center ${stat.color}`}>
                    <div className="text-2xl font-bold">{stat.value}</div>
                    <div className="text-xs mt-1">{stat.label}</div>
                  </div>
                ))}
              </div>
            )}

            {coverageMeta?.gaps && coverageMeta.gaps.length > 0 && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4">
                <h3 className="text-sm font-semibold text-red-700 mb-2">فجوات التغطية</h3>
                <div className="flex flex-wrap gap-2">
                  {coverageMeta.gaps.map(g => (
                    <span key={g} className="rounded-full bg-red-100 px-3 py-1 text-xs font-mono font-medium text-red-700">{g}</span>
                  ))}
                </div>
              </div>
            )}

            {coverageLoading ? (
              <div className="text-center py-12 text-gray-400">جاري التحميل…</div>
            ) : (
              <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-right text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                      <th className="px-5 py-3 font-medium">كود الدور</th>
                      <th className="px-5 py-3 font-medium">اسم الدور</th>
                      <th className="px-5 py-3 font-medium">الفئة</th>
                      <th className="px-5 py-3 font-medium">حالة التعيين</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverageRows.map(r => (
                      <tr key={r.role_code} className="border-b border-gray-50 hover:bg-gray-50 transition">
                        <td className="px-5 py-3 font-mono font-bold text-gray-900">{r.role_code}</td>
                        <td className="px-5 py-3 text-gray-700">{r.role_name}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${categoryColor(r.category)}`}>
                            {r.category}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.is_mapped ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {r.is_mapped ? '✓ معيّن' : '✗ غير معيّن'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {coverageRows.length === 0 && (
                      <tr><td colSpan={4} className="px-5 py-10 text-center text-gray-400">لا توجد بيانات</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ══════════ RESOLVE TAB ══════════ */}
        {tab === 'resolve' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
              <h2 className="font-semibold text-gray-800 mb-4">حل الدور → الحساب</h2>
              <p className="text-sm text-gray-500 mb-4">
                أدخل كود الدور للحصول على كود الحساب المرتبط به في محرك السياسة
              </p>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={resolveRole}
                  onChange={e => setResolveRole(e.target.value.toUpperCase())}
                  placeholder="CASH، AR، AP، INVENTORY…"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400 uppercase"
                  onKeyDown={e => e.key === 'Enter' && resolveRole && doResolve()}
                />
                <button
                  disabled={!resolveRole || resolving}
                  onClick={() => doResolve()}
                  className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  {resolving ? 'جاري الحل…' : 'حل الدور'}
                </button>
              </div>

              {resolveResult && (
                <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-gray-500">كود الدور</div>
                      <div className="font-mono font-bold text-emerald-800">{resolveResult.role_code as string}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">اسم الدور</div>
                      <div className="text-gray-800">{resolveResult.role_name as string}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">كود الحساب</div>
                      <div className="font-mono text-lg font-bold text-emerald-700">{resolveResult.account_code as string}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">اسم الحساب</div>
                      <div className="text-gray-800">{resolveResult.account_name as string}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">نوع الحساب</div>
                      <div className="text-gray-600">{resolveResult.account_type as string}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">الرصيد الطبيعي</div>
                      <div className="text-gray-600">{resolveResult.normal_balance as string}</div>
                    </div>
                    {resolveResult.notes && (
                      <div className="col-span-2">
                        <div className="text-xs text-gray-500">ملاحظات</div>
                        <div className="text-gray-600">{String(resolveResult.notes)}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Quick resolve buttons */}
              <div className="mt-4">
                <div className="text-xs text-gray-500 mb-2">حل سريع</div>
                <div className="flex flex-wrap gap-2">
                  {['CASH','BANK','AR','AP','INVENTORY','SALES','COGS','EXPENSE','WIP'].map(role => (
                    <button key={role}
                      onClick={() => { setResolveRole(role); setTimeout(() => doResolve(), 50) }}
                      className="rounded-full bg-gray-100 px-3 py-1 text-xs font-mono font-medium text-gray-700 hover:bg-emerald-100 hover:text-emerald-700 transition"
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
