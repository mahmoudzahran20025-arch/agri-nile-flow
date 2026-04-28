import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { glApi } from '../../api/client'

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

interface AccountPickerProps {
  value:          string | null
  onChange:       (value: string | null) => void
  accountType?:   AccountType
  showFavorites?: boolean
  label?:         string
  required?:      boolean
  /** Compact mode: tighter spacing, no extra wrapper padding — for inline table cells */
  compact?:       boolean
  /**
   * Isolates localStorage keys (favorites + cache) per company.
   * Pass String(companyId) from the parent.  Omitting shares storage across tenants.
   */
  storageScope?:  string
}

interface AccountLike {
  code:         string
  name:         string
  account_type: AccountType
  is_active?:   number
}

// ── localStorage helpers ──────────────────────────────────────
function favoritesKey(type: AccountType | undefined, scope: string | undefined): string {
  return `gl-account-favorites:${type ?? 'all'}:${scope ?? 'global'}`
}

const COA_CACHE_KEY_PREFIX = 'gl-coa-cache:'
const COA_CACHE_TTL_MS     = 10 * 60 * 1000 // 10 min

function coaCacheKey(type: AccountType | undefined, scope: string | undefined): string {
  return `${COA_CACHE_KEY_PREFIX}${type ?? 'all'}:${scope ?? 'global'}`
}

function readCoaCache(type: AccountType | undefined, scope: string | undefined): AccountLike[] | null {
  try {
    const raw = localStorage.getItem(coaCacheKey(type, scope))
    if (!raw) return null
    const { data, expiresAt } = JSON.parse(raw) as { data: AccountLike[]; expiresAt: number }
    if (Date.now() > expiresAt) { localStorage.removeItem(coaCacheKey(type, scope)); return null }
    return data
  } catch { return null }
}

function writeCoaCache(type: AccountType | undefined, scope: string | undefined, data: AccountLike[]) {
  try {
    localStorage.setItem(coaCacheKey(type, scope), JSON.stringify({ data, expiresAt: Date.now() + COA_CACHE_TTL_MS }))
  } catch { /* storage quota exceeded — skip */ }
}

export function invalidateCoaCache(scope?: string) {
  try {
    const prefix = scope ? `${COA_CACHE_KEY_PREFIX}` : COA_CACHE_KEY_PREFIX
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix) && (!scope || k.includes(`:${scope}`)))
      .forEach(k => localStorage.removeItem(k))
  } catch { /* ignore */ }
}

function loadFavorites(type: AccountType | undefined, scope: string | undefined): string[] {
  try {
    const raw = localStorage.getItem(favoritesKey(type, scope))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveFavorite(type: AccountType | undefined, scope: string | undefined, code: string | null) {
  if (!code) return
  const next = [code, ...loadFavorites(type, scope).filter(item => item !== code)].slice(0, 8)
  localStorage.setItem(favoritesKey(type, scope), JSON.stringify(next))
}

// ── Component ─────────────────────────────────────────────────
export function AccountPicker({
  value, onChange, accountType, showFavorites = true,
  label, required, compact = false, storageScope,
}: AccountPickerProps) {
  const [query, setQuery] = useState('')

  const cachedInitialData = readCoaCache(accountType, storageScope)

  const { data = cachedInitialData ?? [], isLoading } = useQuery({
    // Include storageScope so different companies never share the same TanStack cache slot.
    queryKey: ['gl-accounts', accountType ?? 'all', 'leaf', storageScope ?? 'global'],
    queryFn: async () => {
      const result = await glApi.accounts(accountType, true)
      writeCoaCache(accountType, storageScope, result as AccountLike[])
      return result
    },
    initialData: cachedInitialData ?? undefined,
    staleTime:   COA_CACHE_TTL_MS,
    gcTime:      COA_CACHE_TTL_MS * 2,   // keep in memory 20 min after last use
  })

  const accounts   = data as AccountLike[]
  const favorites  = loadFavorites(accountType, storageScope)

  const filtered = useMemo(() => {
    return accounts
      .filter(a => a.is_active !== 0)
      .filter(a => {
        if (!query.trim()) return true
        return `${a.code} ${a.name}`.toLowerCase().includes(query.toLowerCase())
      })
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [accounts, query])

  const favoriteAccounts = favorites
    .map(code => accounts.find(a => a.code === code))
    .filter((a): a is AccountLike => !!a)

  return (
    <div className={compact ? 'flex flex-col gap-0.5' : 'space-y-2'}>
      {label && (
        <label className="label text-xs">
          {label}{required && <span className="text-red-500"> *</span>}
        </label>
      )}
      <input
        className={compact ? 'input text-xs py-1' : 'input text-sm'}
        placeholder="ابحث بالكود أو الاسم"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <select
        className={compact ? 'input font-mono text-xs py-1' : 'input font-mono text-sm'}
        value={value ?? ''}
        onChange={e => {
          const next = e.target.value || null
          onChange(next)
          saveFavorite(accountType, storageScope, next)
        }}
      >
        <option value="">{required ? 'اختر حساباً' : '— غير محدد —'}</option>
        {showFavorites && favoriteAccounts.length > 0 && (
          <optgroup label="المفضلة مؤخراً">
            {favoriteAccounts.map(a => (
              <option key={`fav-${a.code}`} value={a.code}>{a.code} — {a.name}</option>
            ))}
          </optgroup>
        )}
        <optgroup label={isLoading ? 'جارٍ التحميل...' : 'الحسابات'}>
          {filtered.map(a => (
            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
          ))}
        </optgroup>
      </select>
    </div>
  )
}

export default AccountPicker
