import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, Save, CheckCircle, Send, PanelRightOpen, PanelRightClose,
  Trash2, AlertTriangle, Clock, WifiOff,
} from 'lucide-react'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
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
import type { DraftIndex } from '../../hooks/workspace/useDraftPersistenceEngine'
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

  // ── Posting Pipeline ──────────────────────────────────────────────────────
  const { post, isPosting } = useMovementPostingPipeline()

  const handlePost = useCallback(async () => {
    const snapshot = getDraftSnapshot()
    const res = await post(snapshot, setDraftStatus)
    if (res.success) {
      alert('تم الاعتماد بنجاح!')
      navigate('/inventory/movements')
    } else if (res.error) {
      alert(res.error)
    }
  }, [post, getDraftSnapshot, setDraftStatus, navigate])

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
      disabled: true,
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
          />

          <SummaryFooter
            lines={lines}
            movementType={header.movement_type}
            dirty={dirty}
          />
        </div>

        <WorkspaceSidePanel />
      </div>
    </div>
  )
}
