import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Users, Banknote, Package, MapPin, BookOpen, UserCog, Wrench, FileText, Settings } from 'lucide-react'
import { suppliersApi, employeesApi } from '../api/client'

interface SearchResult {
  id:       string
  label:    string
  sublabel?: string
  icon:     React.ReactNode
  path:     string
  category: string
}

const STATIC_LINKS: SearchResult[] = [
  { id: 'dashboard',   label: 'لوحة القيادة',     icon: <Banknote    size={16} />, path: '/dashboard',        category: 'تنقل' },
  { id: 'treasury',    label: 'الخزينة',           icon: <Banknote    size={16} />, path: '/treasury',         category: 'تنقل' },
  { id: 'partners',    label: 'الشركاء',           icon: <Users       size={16} />, path: '/treasury/partners',category: 'تنقل' },
  { id: 'inventory',   label: 'المخزون',           icon: <Package     size={16} />, path: '/inventory',        category: 'تنقل' },
  { id: 'gl-entries',  label: 'قيود اليومية',      icon: <BookOpen    size={16} />, path: '/gl/entries',       category: 'تنقل' },
  { id: 'gl-stmts',    label: 'القوائم المالية',   icon: <BookOpen    size={16} />, path: '/gl/statements',    category: 'تنقل' },
  { id: 'reports',     label: 'التقارير',          icon: <FileText    size={16} />, path: '/reports',          category: 'تنقل' },
  { id: 'fields',      label: 'الحقول',            icon: <MapPin      size={16} />, path: '/fields',           category: 'تنقل' },
  { id: 'employees',   label: 'الموظفون',          icon: <UserCog     size={16} />, path: '/employees',        category: 'تنقل' },
  { id: 'operations',  label: 'أوامر العمل',       icon: <Wrench      size={16} />, path: '/operations',       category: 'تنقل' },
  { id: 'contracts',   label: 'العقود',            icon: <FileText    size={16} />, path: '/contracts',        category: 'تنقل' },
  { id: 'config',      label: 'الإعدادات',         icon: <Settings    size={16} />, path: '/config',           category: 'تنقل' },
  { id: 'config-periods', label: 'الفترات المالية',icon: <Settings    size={16} />, path: '/config/periods',   category: 'تنقل' },
]

export default function GlobalSearch() {
  const navigate   = useNavigate()
  const [open,     setOpen]     = useState(false)
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const [loading,  setLoading]  = useState(false)
  const inputRef   = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Open on Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setResults(STATIC_LINKS.slice(0, 6))
      setSelected(0)
    }
  }, [open])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(STATIC_LINKS.slice(0, 6))
      return
    }

    // Static link matches first
    const staticMatches = STATIC_LINKS.filter(l =>
      l.label.includes(q) || l.sublabel?.includes(q)
    )

    setLoading(true)
    try {
      const [suppliersRes, employeesRes] = await Promise.allSettled([
        suppliersApi.list({ page: 1, size: 6, q }) as Promise<{ data: { code: number; name: string; activity: string | null }[] }>,
        employeesApi.list(q) as Promise<{ id: number; name: string; job_title?: string }[]>,
      ])

      const supplierResults: SearchResult[] = suppliersRes.status === 'fulfilled'
        ? (suppliersRes.value.data ?? []).slice(0, 4).map(s => ({
            id:       `s-${s.code}`,
            label:    s.name,
            sublabel: s.activity ?? undefined,
            icon:     <Users size={16} />,
            path:     `/suppliers/${s.code}`,
            category: 'موردون',
          }))
        : []

      const employeeResults: SearchResult[] = employeesRes.status === 'fulfilled'
        ? (employeesRes.value ?? []).slice(0, 3).map((e: { id: number; name: string; job_title?: string }) => ({
            id:       `e-${e.id}`,
            label:    e.name,
            sublabel: e.job_title,
            icon:     <UserCog size={16} />,
            path:     `/employees`,
            category: 'موظفون',
          }))
        : []

      setResults([...staticMatches, ...supplierResults, ...employeeResults])
      setSelected(0)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleQueryChange = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(q), 200)
  }

  const go = (path: string) => {
    navigate(path)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(s => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(s => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && results[selected]) {
      go(results[selected].path)
    }
  }

  if (!open) return null

  // Group results by category
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    ;(acc[r.category] ??= []).push(r)
    return acc
  }, {})

  let flatIdx = 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <Search size={18} className={`text-slate-400 shrink-0 ${loading ? 'animate-spin' : ''}`} />
          <input
            ref={inputRef}
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 outline-none bg-transparent"
            placeholder="ابحث عن موردين، حسابات، أو صفحات..."
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button onClick={() => handleQueryChange('')}
              className="text-slate-300 hover:text-slate-500">
              <X size={16} />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto py-2">
          {results.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">
              {loading ? 'جاري البحث...' : 'لا توجد نتائج'}
            </p>
          )}
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <p className="px-4 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">{cat}</p>
              {items.map(item => {
                const idx = flatIdx++
                return (
                  <button
                    key={item.id}
                    onClick={() => go(item.path)}
                    onMouseEnter={() => setSelected(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-right transition-colors
                      ${selected === idx ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className={`text-slate-400 ${selected === idx ? 'text-brand-500' : ''}`}>
                      {item.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${selected === idx ? 'text-brand-700' : 'text-slate-800'}`}>
                        {item.label}
                      </p>
                      {item.sublabel && (
                        <p className="text-xs text-slate-400 truncate">{item.sublabel}</p>
                      )}
                    </div>
                    {selected === idx && (
                      <kbd className="text-xs text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">↵</kbd>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-4 py-2 flex items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1"><kbd className="bg-slate-100 rounded px-1.5 py-0.5">↑↓</kbd> تنقل</span>
          <span className="flex items-center gap-1"><kbd className="bg-slate-100 rounded px-1.5 py-0.5">↵</kbd> فتح</span>
          <span className="flex items-center gap-1"><kbd className="bg-slate-100 rounded px-1.5 py-0.5">Esc</kbd> إغلاق</span>
          <span className="mr-auto flex items-center gap-1">
            <kbd className="bg-slate-100 rounded px-1.5 py-0.5">Ctrl</kbd>+<kbd className="bg-slate-100 rounded px-1.5 py-0.5">K</kbd>
          </span>
        </div>
      </div>
    </div>
  )
}
