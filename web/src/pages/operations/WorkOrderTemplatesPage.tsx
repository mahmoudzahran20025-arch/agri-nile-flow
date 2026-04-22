import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Layers, Plus, Loader2, X, ChevronUp, ChevronDown,
  Pencil, Trash2, CheckCircle2, Zap, ClipboardList,
  BookTemplate, ArrowLeft, Clock, Leaf,
} from 'lucide-react'
import { operationsApi, fieldsApi, configApi, type WOTemplate, type WOTemplateTask } from '../../api/client'
import Modal from '../../components/ui/Modal'

// ── Operation type config ─────────────────────────────────────
const OP_TYPES = ['ري', 'تسميد', 'رش', 'حصاد', 'حراثة', 'زراعة', 'أخرى'] as const

const OP_CFG: Record<string, {
  label: string; accent: string; bg: string; border: string; dot: string; light: string
}> = {
  'ري':          { label: 'ري',           accent: 'text-blue-700',    bg: 'bg-blue-600',    border: 'border-blue-200',   dot: 'bg-blue-500',    light: 'bg-blue-50'    },
  'تسميد':       { label: 'تسميد',        accent: 'text-purple-700',  bg: 'bg-purple-600',  border: 'border-purple-200', dot: 'bg-purple-500',  light: 'bg-purple-50'  },
  'رش':          { label: 'رش',           accent: 'text-green-700',   bg: 'bg-green-600',   border: 'border-green-200',  dot: 'bg-green-500',   light: 'bg-green-50'   },
  'حصاد':        { label: 'حصاد',         accent: 'text-orange-700',  bg: 'bg-orange-600',  border: 'border-orange-200', dot: 'bg-orange-500',  light: 'bg-orange-50'  },
  'حراثة':       { label: 'حراثة',        accent: 'text-amber-700',   bg: 'bg-amber-600',   border: 'border-amber-200',  dot: 'bg-amber-500',   light: 'bg-amber-50'   },
  'زراعة':       { label: 'زراعة',        accent: 'text-emerald-700', bg: 'bg-emerald-600', border: 'border-emerald-200',dot: 'bg-emerald-500', light: 'bg-emerald-50' },
  'أخرى':        { label: 'أخرى',         accent: 'text-gray-700',    bg: 'bg-gray-600',    border: 'border-gray-200',   dot: 'bg-gray-500',    light: 'bg-gray-50'    },
}
const DEFAULT_CFG = OP_CFG['أخرى']
function getCfg(opType: string) { return OP_CFG[opType] ?? DEFAULT_CFG }

// ── Helpers ───────────────────────────────────────────────────
interface Season { id: number; name: string }
interface Field  { id: number; name: string; area_feddan?: number }

// ════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════
export default function WorkOrderTemplatesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [filterType, setFilterType]   = useState<string>('all')
  const [editTpl, setEditTpl]         = useState<WOTemplate | null>(null)
  const [useTpl, setUseTpl]           = useState<WOTemplate | null>(null)
  const [showCreate, setShowCreate]   = useState(false)
  const [successWoId, setSuccessWoId] = useState<{ id: number; name: string } | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['wo-templates'],
    queryFn:  operationsApi.listTemplates,
    staleTime: 60_000,
  })

  const deleteMut = useMutation({
    mutationFn: operationsApi.deleteTemplate,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['wo-templates'] }),
  })

  const usedTypes = [...new Set(templates.map(t => t.operation_type))]
  const filtered  = filterType === 'all'
    ? templates
    : templates.filter(t => t.operation_type === filterType)
  const grouped: Record<string, WOTemplate[]> = {}
  for (const t of filtered) {
    if (!grouped[t.operation_type]) grouped[t.operation_type] = []
    grouped[t.operation_type].push(t)
  }

  const totalTasks = templates.reduce((s, t) => s + (t.task_count ?? 0), 0)

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" dir="rtl">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-sm">
              <Layers size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">نماذج أوامر العمل</h1>
              <p className="text-sm text-gray-500 mt-0.5">قوالب جاهزة لإنشاء أوامر عمل بضغطة واحدة</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-sm"
        >
          <Plus size={16} /> نموذج جديد
        </button>
      </div>

      {/* ── Stats ──────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'إجمالي النماذج',     value: templates.length, color: 'text-indigo-600',  bg: 'bg-indigo-50'  },
          { label: 'إجمالي المهام',       value: totalTasks,       color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'أنواع العمليات',      value: usedTypes.length, color: 'text-amber-600',   bg: 'bg-amber-50'   },
        ].map(stat => (
          <div key={stat.label} className={`rounded-xl ${stat.bg} border border-white p-4 text-center`}>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filter tabs ────────────────────────────────────── */}
      {usedTypes.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${filterType === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300'}`}
          >
            الكل ({templates.length})
          </button>
          {usedTypes.map(t => {
            const cfg = getCfg(t)
            const count = templates.filter(tp => tp.operation_type === t).length
            return (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                  ${filterType === t
                    ? `${cfg.bg} text-white shadow-sm`
                    : `bg-white border ${cfg.border} ${cfg.accent} hover:${cfg.light}`}`}
              >
                {t} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* ── Content ────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-20 text-gray-400">
          <Loader2 className="animate-spin" size={36} />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState onAdd={() => setShowCreate(true)} />
      ) : Object.keys(grouped).length === 0 ? (
        <p className="text-center py-12 text-gray-400">لا توجد نماذج لهذا النوع</p>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([opType, tpls]) => {
            const cfg = getCfg(opType)
            return (
              <section key={opType}>
                {/* Section header */}
                {filterType === 'all' && (
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`h-px flex-1 ${cfg.border} border-t`} />
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${cfg.light} border ${cfg.border}`}>
                      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                      <span className={`text-sm font-bold ${cfg.accent}`}>{opType}</span>
                      <span className={`text-xs ${cfg.accent} opacity-60`}>{tpls.length} نموذج</span>
                    </div>
                    <div className={`h-px flex-1 ${cfg.border} border-t`} />
                  </div>
                )}

                {/* Cards grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {tpls.map(tpl => (
                    <TemplateCard
                      key={tpl.id}
                      tpl={tpl}
                      onEdit={() => setEditTpl(tpl)}
                      onUse={() => setUseTpl(tpl)}
                      onDelete={() => {
                        if (confirm(`حذف نموذج "${tpl.name}"؟`)) deleteMut.mutate(tpl.id)
                      }}
                    />
                  ))}
                  {/* Add card */}
                  <button
                    onClick={() => setShowCreate(true)}
                    className={`min-h-[180px] rounded-2xl border-2 border-dashed ${cfg.border}
                      flex flex-col items-center justify-center gap-2 text-sm ${cfg.accent}
                      hover:${cfg.light} transition-colors opacity-60 hover:opacity-100`}
                  >
                    <Plus size={24} />
                    <span>إضافة نموذج {opType}</span>
                  </button>
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────── */}
      {showCreate && (
        <CreateTemplateModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false)
            qc.invalidateQueries({ queryKey: ['wo-templates'] })
          }}
        />
      )}

      {editTpl && (
        <EditTemplateModal
          tpl={editTpl}
          onClose={() => setEditTpl(null)}
        />
      )}

      {useTpl && (
        <UseTemplateModal
          tpl={useTpl}
          onClose={() => setUseTpl(null)}
          onSuccess={(woId, woName) => {
            setUseTpl(null)
            setSuccessWoId({ id: woId, name: woName })
          }}
        />
      )}

      {/* ── Success banner ─────────────────────────────────── */}
      {successWoId && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-bounce-once">
          <div className="flex items-center gap-3 bg-emerald-600 text-white px-5 py-3.5 rounded-2xl shadow-xl">
            <CheckCircle2 size={20} />
            <div>
              <p className="font-semibold text-sm">تم إنشاء أمر العمل</p>
              <p className="text-xs text-emerald-100">{successWoId.name}</p>
            </div>
            <button
              onClick={() => { setSuccessWoId(null); navigate('/operations') }}
              className="flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors mr-1"
            >
              <ArrowLeft size={12} /> عرض الأمر
            </button>
            <button onClick={() => setSuccessWoId(null)} className="text-emerald-200 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-20">
      <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto mb-5">
        <BookTemplate size={36} className="text-indigo-400" />
      </div>
      <h3 className="text-lg font-bold text-gray-700 mb-2">لا توجد نماذج بعد</h3>
      <p className="text-sm text-gray-400 max-w-xs mx-auto mb-6">
        ابدأ بإنشاء نموذج أمر عمل جاهز يوفّر عليك الوقت في كل مرة تبدأ عملية زراعية
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
      >
        <Plus size={16} /> إنشاء أول نموذج
      </button>
    </div>
  )
}

// ── Template Card ─────────────────────────────────────────────
function TemplateCard({
  tpl, onEdit, onUse, onDelete,
}: {
  tpl: WOTemplate
  onEdit: () => void
  onUse: () => void
  onDelete: () => void
}) {
  const cfg = getCfg(tpl.operation_type)
  const { data } = useQuery({
    queryKey: ['wo-template', tpl.id],
    queryFn:  () => operationsApi.getTemplate(tpl.id),
    staleTime: 120_000,
  })
  const tasks = data?.tasks ?? []
  const PREVIEW = 3

  return (
    <div className={`group rounded-2xl border ${cfg.border} bg-white shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col`}>
      {/* Card accent bar */}
      <div className={`h-1.5 w-full ${cfg.bg}`} />

      {/* Card header */}
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold uppercase tracking-wide ${cfg.accent} ${cfg.light} rounded-full px-2 py-0.5`}>
              {tpl.operation_type}
            </span>
            {tpl.task_count != null && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                <ClipboardList size={10} /> {tpl.task_count} مهمة
              </span>
            )}
          </div>
          <h3 className="font-bold text-gray-800 text-sm leading-snug truncate">{tpl.name}</h3>
          {tpl.description && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{tpl.description}</p>
          )}
        </div>
        {/* Actions */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            title="تعديل"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="حذف"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Tasks preview */}
      <div className="px-4 flex-1">
        {tasks.length === 0 ? (
          <p className="text-xs text-gray-300 italic py-2">لا توجد مهام — أضف من التعديل</p>
        ) : (
          <ul className="space-y-1 py-1">
            {tasks.slice(0, PREVIEW).map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 text-xs text-gray-600">
                <span className={`w-4 h-4 rounded-full ${cfg.light} ${cfg.accent} flex items-center justify-center text-[9px] font-bold shrink-0`}>
                  {i + 1}
                </span>
                <span className="truncate">{t.task_name}</span>
                {t.estimated_hours && (
                  <span className="text-gray-300 flex items-center gap-0.5 shrink-0">
                    <Clock size={9} /> {t.estimated_hours}س
                  </span>
                )}
              </li>
            ))}
            {tasks.length > PREVIEW && (
              <li className="text-xs text-gray-400 pr-6">
                + {tasks.length - PREVIEW} مهام أخرى
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Use button */}
      <div className="px-4 pb-4 pt-3 border-t border-gray-50 mt-2">
        <button
          onClick={onUse}
          className={`w-full flex items-center justify-center gap-2 ${cfg.bg}
            hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-xl
            transition-all shadow-sm hover:shadow active:scale-[0.98]`}
        >
          <Zap size={14} /> إنشاء أمر عمل
        </button>
      </div>
    </div>
  )
}

// ── Create Template Modal ─────────────────────────────────────
interface NewTask { task_name: string; estimated_hours: string }

function CreateTemplateModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [name, setName]       = useState('')
  const [opType, setOpType]   = useState<string>('ري')
  const [desc, setDesc]       = useState('')
  const [tasks, setTasks]     = useState<NewTask[]>([{ task_name: '', estimated_hours: '' }])
  const addTaskRef = useRef<HTMLInputElement>(null)

  const createMut = useMutation({
    mutationFn: () => operationsApi.createTemplate({
      name, operation_type: opType, description: desc || undefined,
      tasks: tasks
        .filter(t => t.task_name.trim())
        .map(t => ({
          task_name:       t.task_name,
          estimated_hours: t.estimated_hours ? Number(t.estimated_hours) : undefined,
        })),
    }),
    onSuccess,
  })

  return (
    <Modal open onClose={onClose} title="إنشاء نموذج جديد">
      <div className="space-y-5 p-1 max-h-[72vh] overflow-y-auto">

        {/* Name + Type */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">اسم النموذج *</label>
            <input
              autoFocus
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="مثال: ري الموسم الصيفي"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">نوع العملية *</label>
            <select
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
              value={opType}
              onChange={e => setOpType(e.target.value)}
            >
              {OP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">وصف مختصر</label>
            <input
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="اختياري"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
          </div>
        </div>

        {/* Tasks builder */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-gray-700">المهام التسلسلية</label>
            <button
              onClick={() => {
                setTasks(t => [...t, { task_name: '', estimated_hours: '' }])
                setTimeout(() => addTaskRef.current?.focus(), 50)
              }}
              className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              <Plus size={12} /> مهمة جديدة
            </button>
          </div>

          <div className="space-y-2">
            {tasks.map((task, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">
                  {idx + 1}
                </span>
                <input
                  ref={idx === tasks.length - 1 ? addTaskRef : undefined}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-indigo-400"
                  placeholder={`المهمة ${idx + 1}`}
                  value={task.task_name}
                  onChange={e => setTasks(ts => ts.map((t, i) => i === idx ? { ...t, task_name: e.target.value } : t))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setTasks(t => [...t, { task_name: '', estimated_hours: '' }])
                      setTimeout(() => addTaskRef.current?.focus(), 50)
                    }
                  }}
                />
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number" min="0.5" step="0.5"
                    className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center focus:ring-1 focus:ring-indigo-400"
                    placeholder="ساعات"
                    value={task.estimated_hours}
                    onChange={e => setTasks(ts => ts.map((t, i) => i === idx ? { ...t, estimated_hours: e.target.value } : t))}
                  />
                  <button
                    onClick={() => setTasks(ts => ts.filter((_, i) => i !== idx))}
                    disabled={tasks.length === 1}
                    className="p-1.5 text-gray-300 hover:text-red-400 disabled:opacity-20 transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
            <Leaf size={10} /> اضغط Enter لإضافة مهمة جديدة بسرعة
          </p>
        </div>

        <div className="flex gap-3 pt-2 sticky bottom-0 bg-white pb-1">
          <button
            onClick={() => createMut.mutate()}
            disabled={!name.trim() || !opType || createMut.isPending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            إنشاء النموذج
          </button>
          <button onClick={onClose} className="px-4 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">إلغاء</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Edit Template Modal ───────────────────────────────────────
function EditTemplateModal({ tpl, onClose }: { tpl: WOTemplate; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName]     = useState(tpl.name)
  const [desc, setDesc]     = useState(tpl.description ?? '')
  const [newTask, setNewTask] = useState('')
  const [newHours, setNewHours] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['wo-template', tpl.id],
    queryFn:  () => operationsApi.getTemplate(tpl.id),
    staleTime: 0,
  })
  const tasks: WOTemplateTask[] = data?.tasks ?? []

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['wo-template', tpl.id] })
    qc.invalidateQueries({ queryKey: ['wo-templates'] })
  }

  const updateMut = useMutation({
    mutationFn: () => operationsApi.updateTemplate(tpl.id, {
      name:        name.trim() || tpl.name,
      description: desc || undefined,
    }),
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })

  const addTaskMut = useMutation({
    mutationFn: (taskName: string) => operationsApi.addTemplateTask(tpl.id, {
      task_name:       taskName,
      estimated_hours: newHours ? Number(newHours) : undefined,
    }),
    onSuccess: () => { setNewTask(''); setNewHours(''); invalidate() },
  })

  const delTaskMut = useMutation({
    mutationFn: (id: number) => operationsApi.deleteTemplateTask(id),
    onSuccess: invalidate,
  })

  const updateTaskMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { task_name?: string; task_order?: number } }) =>
      operationsApi.updateTemplateTask(id, body),
    onSuccess: () => { setEditingId(null); invalidate() },
  })

  function moveTask(task: WOTemplateTask, dir: 'up' | 'down') {
    const sorted = [...tasks].sort((a, b) => a.task_order - b.task_order)
    const idx    = sorted.findIndex(t => t.id === task.id)
    const swap   = dir === 'up' ? sorted[idx - 1] : sorted[idx + 1]
    if (!swap) return
    const a = updateTaskMut.mutateAsync({ id: task.id, body: { task_order: swap.task_order } })
    const b = updateTaskMut.mutateAsync({ id: swap.id,  body: { task_order: task.task_order } })
    Promise.all([a, b]).then(invalidate)
  }

  const cfg = getCfg(tpl.operation_type)

  return (
    <Modal open onClose={onClose} title={`تعديل: ${tpl.name}`}>
      <div className="space-y-5 p-1 max-h-[75vh] overflow-y-auto">

        {/* Name / Desc */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">اسم النموذج</label>
            <input
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">الوصف</label>
            <input
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="اختياري"
            />
          </div>
        </div>

        {/* Task list manager */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">المهام التسلسلية</p>
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="animate-spin text-gray-400" size={18} /></div>
          ) : tasks.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">لا توجد مهام — أضف أولى المهام أدناه</p>
          ) : (
            <div className="space-y-1.5 mb-3">
              {[...tasks].sort((a, b) => a.task_order - b.task_order).map((task, idx, arr) => (
                <div key={task.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${cfg.border} ${cfg.light} group`}>
                  {/* Order badge */}
                  <span className={`w-5 h-5 rounded-full ${cfg.bg} text-white flex items-center justify-center text-[10px] font-bold shrink-0`}>
                    {idx + 1}
                  </span>

                  {/* Task name — inline edit */}
                  {editingId === task.id ? (
                    <input
                      autoFocus
                      className="flex-1 border border-indigo-300 rounded-lg px-2 py-1 text-sm focus:ring-1 focus:ring-indigo-400"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={() => {
                        if (editingName.trim() && editingName !== task.task_name)
                          updateTaskMut.mutate({ id: task.id, body: { task_name: editingName } })
                        else setEditingId(null)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter')   (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape')  setEditingId(null)
                      }}
                    />
                  ) : (
                    <span
                      className="flex-1 text-sm text-gray-700 cursor-pointer hover:text-indigo-600 transition-colors"
                      onClick={() => { setEditingId(task.id); setEditingName(task.task_name) }}
                      title="انقر للتعديل"
                    >
                      {task.task_name}
                    </span>
                  )}

                  {task.estimated_hours && (
                    <span className="text-[10px] text-gray-400 flex items-center gap-0.5 shrink-0">
                      <Clock size={9} /> {task.estimated_hours}س
                    </span>
                  )}

                  {/* Row actions */}
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => moveTask(task, 'up')}
                      disabled={idx === 0}
                      className="p-1 text-gray-400 hover:text-indigo-500 disabled:opacity-20 transition-colors"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      onClick={() => moveTask(task, 'down')}
                      disabled={idx === arr.length - 1}
                      className="p-1 text-gray-400 hover:text-indigo-500 disabled:opacity-20 transition-colors"
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      onClick={() => delTaskMut.mutate(task.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add task inline */}
          <div className="flex items-center gap-2 mt-2">
            <input
              className="flex-1 border border-dashed border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 bg-gray-50"
              placeholder="+ اكتب مهمة جديدة واضغط Enter"
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newTask.trim()) addTaskMut.mutate(newTask.trim())
              }}
            />
            <input
              type="number" min="0.5" step="0.5"
              className="w-20 border border-gray-200 rounded-xl px-2 py-2 text-xs text-center focus:ring-1 focus:ring-indigo-400"
              placeholder="ساعات"
              value={newHours}
              onChange={e => setNewHours(e.target.value)}
            />
            <button
              onClick={() => newTask.trim() && addTaskMut.mutate(newTask.trim())}
              disabled={!newTask.trim() || addTaskMut.isPending}
              className={`px-3 py-2 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-40 ${cfg.bg} hover:opacity-90`}
            >
              {addTaskMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 pt-2 sticky bottom-0 bg-white pb-1">
          <button
            onClick={() => updateMut.mutate()}
            disabled={updateMut.isPending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {updateMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            حفظ التغييرات
          </button>
          <button onClick={onClose} className="px-4 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">إغلاق</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Use Template Modal ────────────────────────────────────────
function UseTemplateModal({
  tpl, onClose, onSuccess,
}: {
  tpl: WOTemplate
  onClose: () => void
  onSuccess: (id: number, name: string) => void
}) {
  const [woName,      setWoName]      = useState(tpl.name)
  const [date,        setDate]        = useState(new Date().toISOString().slice(0, 10))
  const [seasonId,    setSeasonId]    = useState('')
  const [fieldId,     setFieldId]     = useState('')
  const [area,        setArea]        = useState('')
  const [notes,       setNotes]       = useState('')

  const { data: seasons = [] } = useQuery({ queryKey: ['seasons'], queryFn: configApi.seasons })
  const { data: fields  = [] } = useQuery({ queryKey: ['fields'],  queryFn: () => fieldsApi.list() })

  const { data: tplDetail } = useQuery({
    queryKey: ['wo-template', tpl.id],
    queryFn:  () => operationsApi.getTemplate(tpl.id),
    staleTime: 120_000,
  })
  const tasks = tplDetail?.tasks ?? []

  const useMut = useMutation({
    mutationFn: () => operationsApi.useTemplate(tpl.id, {
      name:      woName.trim() || tpl.name,
      planned_date: date,
      season_id: seasonId ? Number(seasonId) : undefined,
      field_id:  fieldId  ? Number(fieldId)  : undefined,
      area_feddan: area   ? Number(area)      : undefined,
      notes:     notes || undefined,
    }),
    onSuccess: (res) => onSuccess(res.id, woName || tpl.name),
  })

  const cfg = getCfg(tpl.operation_type)

  return (
    <Modal open onClose={onClose} title="إنشاء أمر عمل من النموذج">
      <div className="space-y-4 p-1 max-h-[75vh] overflow-y-auto">

        {/* Template badge */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${cfg.light} border ${cfg.border}`}>
          <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
            <Layers size={16} className="text-white" />
          </div>
          <div>
            <p className={`text-sm font-bold ${cfg.accent}`}>{tpl.name}</p>
            <p className="text-xs text-gray-500">
              {tpl.operation_type} · {tasks.length} مهمة ستُنشأ تلقائياً
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">اسم أمر العمل</label>
            <input
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              value={woName}
              onChange={e => setWoName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">تاريخ التخطيط *</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">المساحة (فدان)</label>
            <input
              type="number" min="0" step="any"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="اختياري"
              value={area}
              onChange={e => setArea(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">الموسم</label>
            <select
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
              value={seasonId}
              onChange={e => setSeasonId(e.target.value)}
            >
              <option value="">— بدون موسم —</option>
              {(seasons as Season[]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">القطعة</label>
            <select
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
              value={fieldId}
              onChange={e => {
                setFieldId(e.target.value)
                if (e.target.value) {
                  const f = (fields as Field[]).find(f => f.id === Number(e.target.value))
                  if (f?.area_feddan) setArea(String(f.area_feddan))
                }
              }}
            >
              <option value="">— بدون قطعة —</option>
              {(fields as Field[]).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">ملاحظات</label>
            <input
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="اختياري"
            />
          </div>
        </div>

        {/* Tasks preview */}
        {tasks.length > 0 && (
          <div className={`rounded-xl border ${cfg.border} ${cfg.light} p-3`}>
            <p className={`text-xs font-bold ${cfg.accent} mb-2`}>المهام التي ستُنشأ تلقائياً:</p>
            <ul className="space-y-1">
              {tasks.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs text-gray-600">
                  <CheckCircle2 size={11} className={cfg.accent} />
                  <span>{t.task_name}</span>
                  {t.estimated_hours && <span className="text-gray-400">({t.estimated_hours}س)</span>}
                </li>
              ))}
              {tasks.length > 6 && (
                <li className="text-xs text-gray-400 pr-4">+ {tasks.length - 6} مهام أخرى</li>
              )}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 pt-2 sticky bottom-0 bg-white pb-1">
          <button
            onClick={() => useMut.mutate()}
            disabled={!date || useMut.isPending}
            className={`flex-1 ${cfg.bg} hover:opacity-90 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold transition-all flex items-center justify-center gap-2`}
          >
            {useMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            إنشاء أمر العمل
          </button>
          <button onClick={onClose} className="px-4 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">إلغاء</button>
        </div>
      </div>
    </Modal>
  )
}
