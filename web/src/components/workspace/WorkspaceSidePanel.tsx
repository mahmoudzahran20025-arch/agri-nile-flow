import { X, BookOpen, Package, Shield, ClipboardCheck } from 'lucide-react'
import { useWorkspacePanelStore, type SidePanelTab } from '../../hooks/workspace/useWorkspacePanelStore'

// ─── Tab definitions ─────────────────────────────────────────────────────────

const TABS: { key: SidePanelTab; label: string; icon: React.ReactNode }[] = [
  { key: 'gl',         label: 'القيد المحاسبي', icon: <BookOpen size={14} />       },
  { key: 'stock',      label: 'الأرصدة',        icon: <Package size={14} />        },
  { key: 'health',     label: 'صحة الترحيل',    icon: <Shield size={14} />         },
  { key: 'validation', label: 'التحقق',          icon: <ClipboardCheck size={14} /> },
]

// ─── Phase 2 placeholder bodies ──────────────────────────────────────────────

function PlaceholderBody({ tab }: { tab: SidePanelTab }) {
  const messages: Record<SidePanelTab, { title: string; desc: string }> = {
    gl: {
      title: 'معاينة القيد المحاسبي',
      desc:  'سيعرض القيد الكامل (مدين/دائن) لكل صنف في الدفعة بعد ربط محرك المعاينة in Phase 2.',
    },
    stock: {
      title: 'فحص الأرصدة',
      desc:  'سيعرض رصيد كل صنف في المخزن المختار والرصيد المتوقع بعد الحركة. Phase 2.',
    },
    health: {
      title: 'صحة الترحيل',
      desc:  'سيعرض تغطية مجموعات الترحيل (IPG/PPG) لكل صنف والثغرات المفقودة. Phase 2.',
    },
    validation: {
      title: 'تقرير التحقق',
      desc:  'سيعرض نتائج خط أنابيب التحقق: أخطاء حاجبة وتحذيرات ونسبة الجاهزية. Phase 2.',
    },
  }

  const msg = messages[tab]

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
      <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-4">
        {TABS.find(t => t.key === tab)?.icon}
      </div>
      <h4 className="text-sm font-bold text-slate-700 mb-2">{msg.title}</h4>
      <p className="text-[12px] text-slate-400 leading-relaxed max-w-[260px]">{msg.desc}</p>
      <span className="mt-4 text-[10px] font-bold text-slate-300 uppercase tracking-widest">
        Phase 2 Placeholder
      </span>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function WorkspaceSidePanel() {
  const open = useWorkspacePanelStore(s => s.open)
  const tab = useWorkspacePanelStore(s => s.activeTab)
  const width = useWorkspacePanelStore(s => s.width)
  const setOpen = useWorkspacePanelStore(s => s.setOpen)
  const setActiveTab = useWorkspacePanelStore(s => s.setActiveTab)

  if (!open) return null

  return (
    <div 
      className="bg-white border-l border-slate-200 flex flex-col shrink-0 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.08)] z-10 h-full transition-all"
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
        <h3 className="text-[13px] font-bold text-slate-700">لوحة التفاصيل</h3>
        <button
          onClick={() => setOpen(false)}
          className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 bg-white shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold transition-colors relative ${
              tab === t.key
                ? 'text-[#0F2D5C]'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.icon}
            <span className="hidden lg:inline">{t.label}</span>
            {tab === t.key && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#0F2D5C] rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto">
        <PlaceholderBody tab={tab} />
      </div>
    </div>
  )
}
