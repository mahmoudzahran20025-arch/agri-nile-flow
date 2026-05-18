import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, Save, CheckCircle, Send, PanelRightOpen, PanelRightClose,
  Trash2, AlertTriangle, Clock, WifiOff, X, FileCheck, Plus, Copy,
} from 'lucide-react'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import { validateDraftForSubmission, type SubmissionValidationResult } from '../../components/workspace/validateDraftForSubmission'
import StatusPipeline from '../../components/workspace/StatusPipeline'
import MovementHeaderPanel from '../../components/workspace/MovementHeader'
import DimensionStrip from '../../components/workspace/DimensionStrip'
import LineEditor from '../../components/workspace/LineEditor'
import SummaryFooter from '../../components/workspace/SummaryFooter'
import WorkspaceSidePanel from '../../components/workspace/WorkspaceSidePanel'
import { useMovementDraft } from '../../hooks/workspace/useMovementDraft'
import { useWorkspacePanelStore } from '../../hooks/workspace/useWorkspacePanelStore'
import { useNetworkState } from '../../hooks/workspace/useNetworkState'
import { type MovementMeta, type WorkspaceMode } from '../../components/workspace/types'
import { MOVEMENT_TYPES } from '../../components/workspace/types'
import { LocalStoragePersistenceAdapter, type DraftIndex } from '../../hooks/workspace/persistenceAdapter'
import { useMovementPostingPipeline } from '../../hooks/workspace/useMovementPostingPipeline'

// ─── Draft recovery banner ──────────────────────────────────────────────────

interface RecoveryBannerProps {
  drafts: DraftIndex[]
  currentId: string
  currentMeta: MovementMeta
  onRecover: (id: string) => void
  onDismiss: () => void
}

function RecoveryBanner({ drafts, currentId, currentMeta, onRecover, onDismiss }: RecoveryBannerProps) {
  const others = drafts.filter(d => d.id !== currentId)
  
  if (others.length === 0 && currentMeta.recovery_state !== 'conflict') return null

  return (
    <div className={`border-b px-6 py-2.5 flex items-center gap-3 text-[12px] shrink-0 ${
      currentMeta.recovery_state === 'conflict' 
        ? 'bg-red-50 border-red-200 text-red-800'
        : 'bg-amber-50 border-amber-200 text-amber-800'
    }`}>
      <AlertTriangle size={14} className={currentMeta.recovery_state === 'conflict' ? 'text-red-600' : 'text-amber-600'} />
      <span className="font-medium">
        {currentMeta.recovery_state === 'conflict' 
          ? 'تعارض: تم العثور على نسخة أحدث من هذه المسودة.'
          : `لديك ${others.length} مسودة محفوظة سابقاً`}
      </span>
      <div className="flex items-center gap-2 mr-auto">
        {others.slice(0, 3).map(d => {
          const typeMeta = MOVEMENT_TYPES.find(m => m.value === d.type)
          const timeAgo  = formatTimeAgo(d.updated_at)
          return (
            <button
              key={d.id}
              onClick={() => onRecover(d.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
            >
              <Clock size={11} className="text-amber-500" />
              <span className="font-semibold text-amber-800">
                {typeMeta?.label ?? d.type}
              </span>
              <span className="text-amber-500">
                {d.warehouse && `· ${d.warehouse}`} · {d.line_count} صنف · {timeAgo}
              </span>
            </button>
          )
        })}
        <button
          onClick={onDismiss}
          className="text-amber-400 hover:text-amber-600 transition-colors text-[11px] font-semibold"
        >
          تجاهل
        </button>
      </div>
    </div>
  )
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)  return 'الآن'
  if (mins < 60) return `منذ ${mins} دقيقة`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `منذ ${hours} ساعة`
  return `منذ ${Math.floor(hours / 24)} يوم`
}

// ─── Post-confirmation overlay ───────────────────────────────────────────────

interface PostResult {
  transaction_id: number | null
  movement_type: string
  line_count: number
  total_value: number
  movement_date: string
}

interface PostConfirmationProps {
  result: PostResult
  onViewTransaction: () => void
  onNewMovement: () => void
}

function PostConfirmation({ result, onViewTransaction, onNewMovement }: PostConfirmationProps) {
  const typeMeta = MOVEMENT_TYPES.find(m => m.value === result.movement_type)
  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#f8fafc] gap-6 px-8">
      <div className="flex flex-col items-center gap-3 text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <FileCheck size={32} className="text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">تم الترحيل بنجاح</h2>
        <p className="text-sm text-slate-500">
          تم إنشاء الحركة وإرسالها إلى قائمة انتظار الترحيل المحاسبي.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm w-full max-w-sm divide-y divide-slate-100">
        {result.transaction_id && (
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-xs text-slate-400">رقم المعاملة</span>
            <span className="text-sm font-bold text-slate-800 font-mono">#{result.transaction_id}</span>
          </div>
        )}
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs text-slate-400">نوع الحركة</span>
          <span className="text-sm font-medium text-slate-700">{typeMeta?.label ?? result.movement_type}</span>
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs text-slate-400">عدد الأصناف</span>
          <span className="text-sm font-medium text-slate-700">{result.line_count} صنف</span>
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs text-slate-400">الإجمالي</span>
          <span className="text-sm font-bold text-slate-800">
            {result.total_value.toLocaleString('ar-EG', { minimumFractionDigits: 2 })} ج.م
          </span>
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs text-slate-400">تاريخ الحركة</span>
          <span className="text-sm font-medium text-slate-700">{result.movement_date}</span>
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs text-slate-400">حالة الترحيل المحاسبي</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">في الانتظار</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {result.transaction_id && (
          <button
            onClick={onViewTransaction}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors"
          >
            <FileCheck size={15} />
            عرض المعاملة
          </button>
        )}
        <button
          onClick={onNewMovement}
          className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Plus size={15} />
          حركة جديدة
        </button>
      </div>
    </div>
  )
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function MovementWorkspacePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const networkState = useNetworkState()

  // ── Extract URL params ──────────────────────────────────────────────────
  const urlDraftId = searchParams.get('draft')
  const urlType    = searchParams.get('type')
  const urlWh      = searchParams.get('warehouse')
  
  const mode: WorkspaceMode = useMemo(() => {
    if (searchParams.get('readonly')) return 'readonly'
    if (urlDraftId) return 'draft-edit'
    return 'create'
  }, [searchParams, urlDraftId])

  // ── Global Store ────────────────────────────────────────────────────────
  const toggleSidePanel = useWorkspacePanelStore(s => s.toggleOpen)
  const isSideOpen = useWorkspacePanelStore(s => s.open)

  // ── Draft hook ──────────────────────────────────────────────────────────
  const {
    header, dimensions, lines, meta, dirty, savedDrafts, status,
    dispatch, setDraftStatus,
    saveDraft, discardDraft, loadDraftById, getDraftSnapshot,
  } = useMovementDraft({
    mode,
    draftId:  urlDraftId,
    initType: urlType,
    initWh:   urlWh,
  })

  // ── Local UI state ──────────────────────────────────────────────────────
  const [showRecovery, setShowRecovery] = useState(true)
  const [validationResult, setValidationResult] = useState<SubmissionValidationResult | null>(null)
  const [postResult, setPostResult] = useState<PostResult | null>(null)

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveDraft()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '\\' || e.key === ']')) {
        e.preventDefault()
        toggleSidePanel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveDraft, toggleSidePanel])

  // ── Navigation guard ────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (dirty) {
      saveDraft()
    }
    navigate('/inventory/movements')
  }, [dirty, saveDraft, navigate])

  const handleRecover = useCallback((id: string) => {
    loadDraftById(id)
    setShowRecovery(false)
  }, [loadDraftById])

  const handleDiscard = useCallback(() => {
    if (window.confirm('هل تريد حذف المسودة الحالية والبدء من جديد؟')) {
      discardDraft()
    }
  }, [discardDraft])

  const handleDuplicate = useCallback(async () => {
    const snapshot = getDraftSnapshot()
    const now = new Date().toISOString()
    const newId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const copy = {
      ...snapshot,
      id: newId,
      created_at: now,
      updated_at: now,
      meta: { ...snapshot.meta, recovery_state: 'clean' as const },
    }
    await LocalStoragePersistenceAdapter.saveDraft(copy)
    navigate(`/inventory/workspace/create?draft=${newId}`)
  }, [getDraftSnapshot, navigate])

  // ── Validate ──────────────────────────────────────────────────────────────
  const handleValidate = useCallback(() => {
    const snapshot = getDraftSnapshot()
    const result = validateDraftForSubmission(snapshot)
    setValidationResult(result)
  }, [getDraftSnapshot])

  // ── Posting Pipeline ──────────────────────────────────────────────────────
  const { post, isPosting } = useMovementPostingPipeline()

  const handlePost = useCallback(async () => {
    const snapshot = getDraftSnapshot()

    // Pre-flight validation gate — block post if errors exist
    const validation = validateDraftForSubmission(snapshot)
    setValidationResult(validation)
    if (!validation.valid) return

    const res = await post(snapshot, setDraftStatus)
    if (res.success) {
      setValidationResult(null)
      setPostResult({
        transaction_id: (res as any).transaction_id ?? null,
        movement_type: snapshot.header.movement_type,
        line_count: snapshot.lines.filter(l => l.item_code).length,
        total_value: snapshot.lines.reduce((s, l) => s + (l.quantity ?? 0) * (l.unit_price ?? 0), 0),
        movement_date: snapshot.header.movement_date ?? new Date().toISOString().slice(0, 10),
      })
      discardDraft()
    } else if (res.error) {
      alert(res.error)
    }
  }, [post, getDraftSnapshot, setDraftStatus, discardDraft])

  // ── Command bar actions ─────────────────────────────────────────────────
  const actions: CommandAction[] = [
    {
      id: 'back',
      label: 'الحركات',
      icon: <ArrowRight size={15} />,
      variant: 'ghost',
      onClick: handleBack,
    },
    { id: 'sep0', isSeparator: true },
    {
      id: 'save',
      label: dirty ? 'حفظ المسودة' : 'محفوظة',
      icon: <Save size={15} />,
      variant: 'secondary',
      onClick: saveDraft,
      disabled: !dirty || mode === 'readonly',
    },
    {
      id: 'validate',
      label: 'تحقق',
      icon: <CheckCircle size={15} />,
      variant: 'secondary',
      disabled: mode === 'readonly',
      onClick: handleValidate,
    },
    {
      id: 'post',
      label: isPosting ? 'جاري الترحيل...' : 'ترحيل',
      icon: <Send size={15} />,
      variant: 'primary',
      disabled: status === 'posting' || mode === 'readonly',
      onClick: handlePost,
    },
    { id: 'sep1', isSeparator: true },
    {
      id: 'duplicate',
      label: 'نسخ',
      icon: <Copy size={15} />,
      variant: 'ghost',
      onClick: handleDuplicate,
    },
    {
      id: 'discard',
      label: 'حذف المسودة',
      icon: <Trash2 size={15} />,
      variant: 'ghost',
      onClick: handleDiscard,
      disabled: mode === 'readonly',
    },
  ]

  // ── Right slot: status + panel toggle ───────────────────────────────────
  const rightSlot = (
    <div className="flex items-center gap-3">
      {networkState === 'offline' && (
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-md border border-red-200">
          <WifiOff size={13} /> غير متصل
        </span>
      )}
      <StatusPipeline status={status} />
      <div className="w-[1px] h-6 bg-slate-200" />
      <button
        onClick={toggleSidePanel}
        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
        title={isSideOpen ? 'إخفاء اللوحة الجانبية (Ctrl+\\)' : 'إظهار اللوحة الجانبية (Ctrl+\\)'}
      >
        {isSideOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
      </button>
    </div>
  )

  // ── Render ──────────────────────────────────────────────────────────────
  if (postResult) {
    return (
      <PostConfirmation
        result={postResult}
        onViewTransaction={() => {
          if (postResult.transaction_id) navigate(`/inventory/transactions/${postResult.transaction_id}`)
        }}
        onNewMovement={() => navigate('/inventory/movements/new')}
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <CommandBar actions={actions} rightSlot={rightSlot} />

      {showRecovery && mode !== 'readonly' && (
        <RecoveryBanner
          drafts={savedDrafts}
          currentId={searchParams.get('draft') || ''}
          currentMeta={meta}
          onRecover={handleRecover}
          onDismiss={() => setShowRecovery(false)}
        />
      )}

      {validationResult && (
        <div className={`border-b px-6 py-3 shrink-0 ${
          validationResult.valid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {validationResult.valid ? (
                <p className="text-sm font-semibold text-green-700 flex items-center gap-2">
                  <CheckCircle size={15} className="text-green-600 shrink-0" />
                  المسودة صالحة للترحيل — لا توجد أخطاء
                  {validationResult.warnings.length > 0 && (
                    <span className="text-amber-600 font-medium">({validationResult.warnings.length} تحذير)</span>
                  )}
                </p>
              ) : (
                <p className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-2">
                  <AlertTriangle size={15} className="text-red-500 shrink-0" />
                  {validationResult.errors.length} خطأ يجب تصحيحه قبل الترحيل
                </p>
              )}
              {validationResult.errors.length > 0 && (
                <ul className="space-y-0.5 mt-1">
                  {validationResult.errors.map((e, i) => (
                    <li key={i} className="text-xs text-red-600 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                      {e.line_index != null ? `سطر ${e.line_index + 1}: ` : ''}{e.message}
                    </li>
                  ))}
                </ul>
              )}
              {validationResult.warnings.length > 0 && (
                <ul className="space-y-0.5 mt-1">
                  {validationResult.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-amber-600 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      {w.line_index != null ? `سطر ${w.line_index + 1}: ` : ''}{w.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => setValidationResult(null)}
              className="text-slate-400 hover:text-slate-600 transition-colors shrink-0 mt-0.5"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <MovementHeaderPanel
            header={header}
            onChange={(patch) => {
              Object.entries(patch).forEach(([key, val]) => {
                dispatch({ type: 'UPDATE_HEADER', field: key as any, value: val })
              })
            }}
          />

          <DimensionStrip
            dimensions={dimensions}
            movementType={header.movement_type}
            onChange={(patch) => {
              Object.entries(patch).forEach(([key, val]) => {
                dispatch({ type: 'UPDATE_DIMENSIONS', field: key as any, value: val })
              })
            }}
          />

          <LineEditor
            lines={lines}
            movementType={header.movement_type}
            warehouse={header.warehouse_id}
            onAddLine={() => dispatch({ type: 'ADD_ROW' })}
            onRemoveLine={(key) => dispatch({ type: 'REMOVE_ROW', rowId: key })}
            onUpdateLine={(rowId, field, value) =>
              dispatch({ type: 'UPDATE_CELL', rowId, field: field as any, value })
            }
            onApplyPaste={(startRowId, rows) =>
              dispatch({ type: 'APPLY_EXCEL_PASTE', startRowId, rows })
            }
          />

          <SummaryFooter
            lines={lines}
            movementType={header.movement_type}
            dirty={dirty}
          />
        </div>

        <WorkspaceSidePanel draft={getDraftSnapshot()} />
      </div>
    </div>
  )
}
