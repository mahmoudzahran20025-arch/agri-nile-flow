import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Keyboard } from 'lucide-react'

interface ShortcutDef {
  keys:  string
  label: string
  group: string
}

const SHORTCUTS: ShortcutDef[] = [
  { group: 'تنقل',        keys: 'Alt + D', label: 'لوحة التحكم'        },
  { group: 'تنقل',        keys: 'Alt + T', label: 'الخزينة'             },
  { group: 'تنقل',        keys: 'Alt + I', label: 'المخزون'             },
  { group: 'تنقل',        keys: 'Alt + S', label: 'الموردون'            },
  { group: 'تنقل',        keys: 'Alt + H', label: 'الموارد البشرية'     },
  { group: 'تنقل',        keys: 'Alt + R', label: 'التقارير'            },
  { group: 'تنقل',        keys: 'Alt + G', label: 'قيود الأستاذ العام'  },
  { group: 'تنقل',        keys: 'Alt + F', label: 'قطع الأراضي'        },
  { group: 'تنقل',        keys: 'Alt + C', label: 'الإعدادات'           },
  { group: 'النظام',      keys: 'Ctrl + K', label: 'بحث سريع'          },
  { group: 'النظام',      keys: '?',        label: 'اختصارات لوحة المفاتيح' },
  { group: 'النظام',      keys: 'Escape',   label: 'إغلاق / إلغاء'     },
]

const NAV_MAP: Record<string, string> = {
  d: '/dashboard',
  t: '/treasury',
  i: '/inventory',
  s: '/suppliers',
  h: '/hr',
  r: '/reports',
  g: '/gl/entries',
  f: '/fields',
  c: '/config',
}

const GROUPS = [...new Set(SHORTCUTS.map(s => s.group))]

function Kbd({ children }: { children: string }) {
  const parts = children.split('+').map(p => p.trim())
  return (
    <span className="flex items-center gap-1">
      {parts.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-400 text-xs">+</span>}
          <kbd className="inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-mono font-semibold bg-gray-100 border border-gray-300 rounded-md text-gray-700 shadow-sm min-w-[24px]">
            {p}
          </kbd>
        </span>
      ))}
    </span>
  )
}

export default function KeyboardShortcuts() {
  const navigate       = useNavigate()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const isInputFocused = () => {
      const tag = document.activeElement?.tagName.toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' ||
        (document.activeElement as HTMLElement)?.isContentEditable
    }

    const handler = (e: KeyboardEvent) => {
      // Alt + letter navigation
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const key = e.key.toLowerCase()
        const dest = NAV_MAP[key]
        if (dest) {
          e.preventDefault()
          navigate(dest)
          return
        }
      }

      // ? to open shortcuts panel (only when no input focused)
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey && !isInputFocused()) {
        e.preventDefault()
        setOpen(o => !o)
        return
      }

      // Escape to close panel
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2.5">
            <Keyboard size={18} className="text-brand-600" />
            <h2 className="text-base font-bold text-gray-900">اختصارات لوحة المفاتيح</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {GROUPS.map(group => (
            <div key={group}>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">{group}</p>
              <div className="space-y-1">
                {SHORTCUTS.filter(s => s.group === group).map(s => (
                  <div key={s.keys} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-700">{s.label}</span>
                    <Kbd>{s.keys}</Kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
            <span>اضغط</span><Kbd>?</Kbd><span>أو</span><Kbd>Escape</Kbd><span>للإغلاق</span>
          </div>
        </div>
      </div>
    </div>
  )
}
