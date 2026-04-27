import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { glApi, PgType, PostingGroup } from '../../api/gl'

interface PostingGroupSelectorProps {
  type: PgType
  value: string | null
  onChange: (value: string | null) => void
  required?: boolean
  showStats?: boolean
  showRecent?: boolean
  usageStats?: Record<string, number>
  label?: string
  helpText?: string
}

const RECENT_LIMIT = 5

function recentKey(type: PgType) {
  return `gl-posting-group-recent:${type}`
}

function loadRecent(type: PgType): string[] {
  try {
    const raw = localStorage.getItem(recentKey(type))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveRecent(type: PgType, code: string | null) {
  if (!code) return
  const next = [code, ...loadRecent(type).filter(item => item !== code)].slice(0, RECENT_LIMIT)
  localStorage.setItem(recentKey(type), JSON.stringify(next))
}

export function PostingGroupSelector({
  type,
  value,
  onChange,
  required,
  showStats,
  showRecent = true,
  usageStats,
  label,
  helpText,
}: PostingGroupSelectorProps) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const { data = [], isLoading } = useQuery({
    queryKey: ['posting-groups', type],
    queryFn: () => glApi.postingGroups(type),
  })

  useEffect(() => {
    setRecent(loadRecent(type))
  }, [type])

  const sortedGroups = useMemo(() => {
    const active = data.filter(group => group.is_active === 1)
    const filtered = !query.trim()
      ? active
      : active.filter(group => {
          const hay = `${group.code} ${group.name} ${group.description ?? ''}`.toLowerCase()
          return hay.includes(query.toLowerCase())
        })

    return filtered.sort((left, right) => {
      const leftWeight = usageStats?.[left.code] ?? 0
      const rightWeight = usageStats?.[right.code] ?? 0
      if (rightWeight !== leftWeight) return rightWeight - leftWeight
      return left.code.localeCompare(right.code)
    })
  }, [data, query, usageStats])

  const selectedGroup = data.find(group => group.code === value)
  const recentGroups = recent
    .map(code => data.find(group => group.code === code))
    .filter((group): group is PostingGroup => !!group)

  return (
    <div className="space-y-2">
      {label && <label className="label text-xs">{label}{required && <span className="text-red-500"> *</span>}</label>}
      <input
        className="input text-sm"
        placeholder="ابحث بالكود أو الاسم"
        value={query}
        onChange={event => setQuery(event.target.value)}
      />
      <select
        className="input text-sm"
        value={value ?? ''}
        onChange={event => {
          const next = event.target.value || null
          onChange(next)
          saveRecent(type, next)
          setRecent(loadRecent(type))
        }}
      >
        <option value="">{required ? 'اختر مجموعة' : '— بدون مجموعة / الافتراضي —'}</option>
        {showRecent && recentGroups.length > 0 && (
          <optgroup label="الأحدث استخداماً">
            {recentGroups.map(group => (
              <option key={`recent-${group.code}`} value={group.code}>
                {group.code} — {group.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={isLoading ? 'جارٍ التحميل...' : 'المجموعات النشطة'}>
          {sortedGroups.map(group => (
            <option key={group.code} value={group.code}>
              {group.code} — {group.name}{showStats ? ` (${usageStats?.[group.code] ?? 0})` : ''}
            </option>
          ))}
        </optgroup>
      </select>
      {selectedGroup ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <div className="font-semibold">{selectedGroup.code} — {selectedGroup.name}</div>
          {selectedGroup.description && <div className="mt-1 text-emerald-700">{selectedGroup.description}</div>}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          سيتم استخدام قاعدة الترحيل الافتراضية إذا تُرك الحقل فارغاً.
        </div>
      )}
      {helpText && <p className="text-xs text-slate-500">{helpText}</p>}
    </div>
  )
}

export default PostingGroupSelector
