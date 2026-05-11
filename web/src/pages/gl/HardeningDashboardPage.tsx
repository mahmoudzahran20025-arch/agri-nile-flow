import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck, ShieldAlert, Activity, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, ToggleLeft, ToggleRight, Clock,
  Users, Package, FileText, ChevronRight, Lock,
} from 'lucide-react'
import { hardeningApi } from '../../api/gl'
import { useToast } from '../../contexts/ToastContext'
import { useAppStore } from '../../store/appStore'
import SectionCard from '../../components/ui/SectionCard'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'

function pct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${n.toFixed(2)}%`
}

const FLAG_LABELS: Record<string, { label: string; help: string; danger?: boolean }> = {
  strict_posting_mode: {
    label: 'وضع الترحيل الصارم',
    help: 'عند التفعيل: يحجب أي ترحيل إذا كانت BPG/PPG مفقودة',
    danger: true,
  },
  catch_all_allowed: {
    label: 'السماح بالقاعدة الشاملة',
    help: 'عند التعطيل: يُمنع توجيه القيود عبر قاعدة null/null',
  },
  report_fallback_mode: {
    label: 'وضع الاحتياط في التقارير',
    help: 'عند التفعيل: تسمح التقارير المالية بالعودة لجداول المعاملات',
  },
}

// ── Flag row ──────────────────────────────────────────────────
function FlagRow({
  flag,
  onToggle,
  isToggling,
  canEdit,
}: {
  flag: { flag_key: string; flag_value: number; description: string | null; set_at: string }
  onToggle: (key: string, current: number) => void
  isToggling: boolean
  canEdit: boolean
}) {
  const meta = FLAG_LABELS[flag.flag_key]
  const isOn = flag.flag_value === 1

  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0" dir="rtl">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-800">{meta?.label ?? flag.flag_key}</span>
          {meta?.danger && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 font-medium">تأثير عالي</span>
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">{meta?.help ?? flag.description}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">آخر تعديل: {flag.set_at?.slice(0, 16).replace('T', ' ')}</p>
      </div>
      {canEdit ? (
        <button
          onClick={() => onToggle(flag.flag_key, flag.flag_value)}
          disabled={isToggling}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors disabled:opacity-50"
          style={{
            background: isOn ? '#dcfce7' : '#f1f5f9',
            color:      isOn ? '#166534' : '#475569',
            borderColor: isOn ? '#86efac' : '#e2e8f0',
          }}
        >
          {isOn ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
          {isOn ? 'مُفعَّل' : 'معطَّل'}
        </button>
      ) : (
        <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium bg-slate-50 text-slate-400 border-slate-200">
          <Lock size={12} />
          {isOn ? 'مُفعَّل' : 'معطَّل'}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function HardeningDashboardPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const role = useAppStore(s => s.role)
  const isAdmin = role === 'super_admin' || role === 'company_admin'
  const [auditPage, setAuditPage] = useState(1)

  const { data: baseline, isLoading: baselineLoading, error: baselineError, refetch: refetchBaseline } = useQuery({
    queryKey: ['hardening', 'baseline'],
    queryFn:  hardeningApi.baseline,
    refetchInterval: 60_000,
  })

  const { data: flagsData, isLoading: flagsLoading, refetch: refetchFlags } = useQuery({
    queryKey: ['hardening', 'flags'],
    queryFn:  hardeningApi.flags,
  })

  const { data: pendingData } = useQuery({
    queryKey: ['hardening', 'audit', 'pending'],
    queryFn:  hardeningApi.pendingAudit,
    refetchInterval: 30_000,
  })

  const { data: auditLog } = useQuery({
    queryKey: ['hardening', 'audit', 'log', auditPage],
    queryFn:  () => hardeningApi.auditLog({ page: auditPage, size: 20 }),
  })

  const { mutate: toggleFlag, isPending: isToggling } = useMutation({
    mutationFn: async ({ key, current }: { key: string; current: number }) => {
      const newVal = current === 1 ? 0 : 1
      const reason = window.prompt(
        `سبب ${newVal === 1 ? 'تفعيل' : 'تعطيل'} "${FLAG_LABELS[key]?.label ?? key}" (مطلوب للسجل المحاسبي):`
      )
      if (!reason?.trim()) throw new Error('CANCELLED')
      return hardeningApi.setFlag(key as 'strict_posting_mode' | 'catch_all_allowed' | 'report_fallback_mode', newVal as 0 | 1, reason)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hardening'] })
      toast('تم تحديث الإعداد وتسجيله في سجل المراجعة', 'success')
    },
    onError: (e) => {
      if ((e as Error).message !== 'CANCELLED') toast('فشل التحديث', 'error')
    },
  })

  const b = baseline?.data
  const flags = Array.isArray(flagsData?.data) ? flagsData.data : []
  const pending = Array.isArray(pendingData?.data) ? pendingData.data : []
  const auditRows = Array.isArray(auditLog?.data) ? auditLog.data : []
  const auditPagination = auditLog?.pagination ?? { total: auditRows.length, size: 20 }
  const certStatus = baseline?.meta?.certification_status

  const actions: CommandAction[] = [
    { id: 'refresh', label: 'تحديث', icon: <RefreshCw size={14} />, onClick: () => { refetchBaseline(); refetchFlags() }, variant: 'secondary' },
  ]

  // Explicit error state — never leave a blank screen
  const isAccessDenied = baselineError && (String(baselineError).includes('403') || String(baselineError).includes('Forbidden') || String(baselineError).includes('غير مصرح'))
  if (isAccessDenied) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8" dir="rtl">
        <XCircle size={48} className="text-red-400" />
        <h2 className="text-[16px] font-bold text-slate-700">صلاحيات غير كافية</h2>
        <p className="text-[13px] text-slate-500 max-w-sm">هذه الصفحة متاحة لمدراء الشركة فقط. تواصل مع المدير لطلب الوصول.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]" dir="rtl">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[18px] font-bold text-[#0F2D5C]">لوحة إدارة النظام المحاسبي</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">
              حوكمة الترحيل · مؤشرات الأداء · إعدادات الوضع · سجل المراجعة
            </p>
          </div>
          <div className="flex items-center gap-2">
            {certStatus === 'certified' && (
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                <ShieldCheck size={14} /> معتمد
              </span>
            )}
            {certStatus === 'degraded' && (
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold border bg-amber-50 text-amber-700 border-amber-200">
                <ShieldAlert size={14} /> مخفّض
              </span>
            )}
            {!certStatus && !baselineLoading && (
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold border bg-slate-50 text-slate-500 border-slate-200">
                <Activity size={14} /> جار التحميل
              </span>
            )}
            {pending.length > 0 && (
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold bg-red-600 text-white animate-pulse">
                <Clock size={14} /> {pending.length} بانتظار الموافقة
              </span>
            )}
          </div>
        </div>
      </div>

      <CommandBar actions={actions} />

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

        {/* KPI strip */}
        {b && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                icon: <Activity size={18} className="text-blue-600" />,
                label: 'معدل الترحيل الناجح',
                value: pct(b.posting_success?.success_rate_pct),
                sub: `${b.posting_success?.linked ?? '—'} / ${b.posting_success?.total_events ?? '—'} حدث`,
                ok: (b.posting_success?.success_rate_pct ?? 0) >= 90,
              },
              {
                icon: <Users size={18} className="text-violet-600" />,
                label: 'انحراف الأستاذ المساعد',
                value: `${b.subledger_drift?.suppliers_with_drift ?? 0} مورد`,
                sub: 'انحراف > 0.5 جنيه',
                ok: (b.subledger_drift?.suppliers_with_drift ?? 0) === 0,
              },
              {
                icon: <Package size={18} className="text-emerald-600" />,
                label: 'اكتمال الأبعاد — موردين',
                value: (() => {
                  const s = b.dimension_completeness?.find(d => d.source === 'supplier_transactions')
                  return s ? pct(100 * s.has_center / s.total) : '—'
                })(),
                sub: 'تغطية مركز التكلفة',
                ok: (() => {
                  const s = b.dimension_completeness?.find(d => d.source === 'supplier_transactions')
                  return s ? s.has_center === s.total : true
                })(),
              },
              {
                icon: <FileText size={18} className="text-orange-600" />,
                label: 'صحة قواعد الترحيل',
                value: `${b.rule_health?.total_active_rules ?? '—'} قاعدة نشطة`,
                sub: `AP: ${b.rule_health?.ap_rule_active ? '✓ نشطة' : '✗ معطّلة'}`,
                ok: (b.rule_health?.ap_rule_active ?? 0) > 0,
              },
            ].map((k, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-slate-50">{k.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-500">{k.label}</p>
                  <p className="text-[16px] font-bold text-slate-800 tabular-nums">{k.value}</p>
                  <p className="text-[10px] text-slate-400">{k.sub}</p>
                </div>
                {k.ok
                  ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                  : <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                }
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Feature flags */}
          <SectionCard title="إعدادات الحوكمة" subtitle="تُؤثّر على سلوك الترحيل في الوقت الفعلي · كل تغيير مُسجَّل">
            {flagsLoading ? (
              <p className="text-[13px] text-slate-400 py-4 text-center">جار التحميل…</p>
            ) : flags.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-4 text-center">لا توجد إعدادات</p>
            ) : (
              <div>
                {flags.map(f => (
                  <FlagRow
                    key={f.flag_key}
                    flag={f}
                    onToggle={(key, current) => toggleFlag({ key, current })}
                    isToggling={isToggling}
                    canEdit={isAdmin}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          {/* Dimensional completeness detail */}
          {b?.dimension_completeness && (
            <SectionCard title="اكتمال الأبعاد" subtitle="center_code · season_id لكل مصدر بيانات">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-right text-slate-400 text-[11px]">
                    <th className="pb-2 font-medium">المصدر</th>
                    <th className="pb-2 font-medium">إجمالي</th>
                    <th className="pb-2 font-medium">مركز التكلفة</th>
                    <th className="pb-2 font-medium">الموسم</th>
                  </tr>
                </thead>
                <tbody>
                  {b.dimension_completeness.map(row => {
                    const centerPct = row.total > 0 ? Math.round(100 * row.has_center / row.total) : 100
                    const seasonPct = row.total > 0 ? Math.round(100 * row.has_season / row.total) : 100
                    return (
                      <tr key={row.source} className="border-t border-slate-100">
                        <td className="py-2 text-slate-600 font-medium">
                          {row.source === 'supplier_transactions' ? 'موردون' : 'مستودعات'}
                        </td>
                        <td className="py-2 text-slate-500 tabular-nums">{row.total.toLocaleString()}</td>
                        <td className="py-2">
                          <span className={`font-bold tabular-nums ${centerPct === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {centerPct}%
                          </span>
                        </td>
                        <td className="py-2">
                          <span className={`font-bold tabular-nums ${seasonPct === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {seasonPct}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </SectionCard>
          )}
        </div>

        {/* Pending approvals */}
        {pending.length > 0 && (
          <SectionCard
            title={`بانتظار الموافقة (${pending.length})`}
            subtitle="تغييرات قواعد الترحيل تحتاج موافقة مراجع آخر — Maker-Checker"
          >
            <div className="space-y-2">
              {pending.map(r => (
                <div key={r.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200" dir="rtl">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-amber-800 uppercase">{r.action}</span>
                      <span className="text-[10px] text-amber-600">القاعدة #{r.rule_id}</span>
                    </div>
                    <p className="text-[12px] text-amber-900 mt-0.5 truncate">{r.change_reason}</p>
                    <p className="text-[10px] text-amber-600 mt-0.5">بواسطة: {r.changed_by_name ?? r.changed_by} · {r.changed_at?.slice(0, 16).replace('T', ' ')}</p>
                  </div>
                  <ChevronRight size={14} className="text-amber-500 shrink-0 mt-1" />
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Audit log */}
        <SectionCard title="سجل المراجعة" subtitle="جميع تغييرات قواعد الترحيل والإعدادات">
          {!auditLog ? (
            <p className="text-[13px] text-slate-400 py-4 text-center">جار التحميل…</p>
          ) : auditRows.length === 0 ? (
            <p className="text-[13px] text-slate-400 py-4 text-center">لا توجد سجلات</p>
          ) : (
            <>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-right text-slate-400 text-[11px] border-b border-slate-100">
                    <th className="pb-2 font-medium">الإجراء</th>
                    <th className="pb-2 font-medium">السبب</th>
                    <th className="pb-2 font-medium">بواسطة</th>
                    <th className="pb-2 font-medium">الوقت</th>
                    <th className="pb-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map(r => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="py-2 font-semibold text-slate-700 uppercase text-[11px]">{r.action}</td>
                      <td className="py-2 text-slate-600 max-w-[200px] truncate">{r.change_reason}</td>
                      <td className="py-2 text-slate-500">{r.changed_by_name ?? r.changed_by}</td>
                      <td className="py-2 text-slate-400 tabular-nums whitespace-nowrap">{r.changed_at?.slice(0, 16).replace('T', ' ')}</td>
                      <td className="py-2">
                        {r.approval_status === 'approved' && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            <CheckCircle2 size={10} /> موافق
                          </span>
                        )}
                        {r.approval_status === 'pending' && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            <Clock size={10} /> معلّق
                          </span>
                        )}
                        {r.approval_status === 'rejected' && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                            <XCircle size={10} /> مرفوض
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Pagination */}
              {auditPagination.total > auditPagination.size && (
                <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-slate-100">
                  <button
                    disabled={auditPage === 1}
                    onClick={() => setAuditPage(p => p - 1)}
                    className="px-3 py-1 text-[11px] rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                  >السابق</button>
                  <span className="text-[11px] text-slate-500">
                    {auditPage} / {Math.ceil(auditPagination.total / auditPagination.size)}
                  </span>
                  <button
                    disabled={auditPage >= Math.ceil(auditPagination.total / auditPagination.size)}
                    onClick={() => setAuditPage(p => p + 1)}
                    className="px-3 py-1 text-[11px] rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                  >التالي</button>
                </div>
              )}
            </>
          )}
        </SectionCard>

      </div>
    </div>
  )
}
