import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { glApi } from '../../api/gl'

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

interface AccountPickerProps {
  value: string | null
  onChange: (value: string | null) => void
  accountType?: AccountType
  showFavorites?: boolean
  label?: string
  required?: boolean
}

interface AccountLike {
  code: string
  name: string
  account_type: AccountType
  is_active?: number
}

function favoritesKey(type?: AccountType) {
  return `gl-account-favorites:${type ?? 'all'}`
}

function loadFavorites(type?: AccountType): string[] {
  try {
    const raw = localStorage.getItem(favoritesKey(type))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

const COA_CACHE_KEY_PREFIX = 'gl-coa-cache:'
const COA_CACHE_TTL_MS = 10 * 60 * 1000 // 10 min

function coaCacheKey(type?: AccountType) {
  return `${COA_CACHE_KEY_PREFIX}${type ?? 'all'}`
}

function readCoaCache(type?: AccountType): AccountLike[] | null {
  try {
    const raw = localStorage.getItem(coaCacheKey(type))
    if (!raw) return null
    const { data, expiresAt } = JSON.parse(raw) as { data: AccountLike[]; expiresAt: number }
    if (Date.now() > expiresAt) { localStorage.removeItem(coaCacheKey(type)); return null }
    return data
  } catch {
    return null
  }
}

function writeCoaCache(type: AccountType | undefined, data: AccountLike[]) {
  try {
    localStorage.setItem(coaCacheKey(type), JSON.stringify({ data, expiresAt: Date.now() + COA_CACHE_TTL_MS }))
  } catch {
    // storage quota exceeded — skip silently
  }
}

export function invalidateCoaCache() {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(COA_CACHE_KEY_PREFIX))
    keys.forEach(k => localStorage.removeItem(k))
  } catch { /* ignore */ }
}

function saveFavorite(type: AccountType | undefined, code: string | null) {
  if (!code) return
  const next = [code, ...loadFavorites(type).filter(item => item !== code)].slice(0, 8)
  localStorage.setItem(favoritesKey(type), JSON.stringify(next))
}

export function AccountPicker({ value, onChange, accountType, showFavorites = true, label, required }: AccountPickerProps) {
  const [query, setQuery] = useState('')
  const cachedInitialData = readCoaCache(accountType)
  const { data = cachedInitialData ?? [], isLoading } = useQuery({
    queryKey: ['gl-accounts', accountType ?? 'all', 'leaf'],
    queryFn: async () => {
      const result = await glApi.accounts(accountType, true)
      writeCoaCache(accountType, result as AccountLike[])
      return result
    },
    initialData: cachedInitialData ?? undefined,
    staleTime: COA_CACHE_TTL_MS,
  })

  const accounts = data as AccountLike[]
  const favorites = loadFavorites(accountType)

  const filtered = useMemo(() => {
    return accounts
      .filter(account => account.is_active !== 0)
      .filter(account => {
        if (!query.trim()) return true
        const hay = `${account.code} ${account.name}`.toLowerCase()
        return hay.includes(query.toLowerCase())
      })
      .sort((left, right) => left.code.localeCompare(right.code))
  }, [accounts, query])

  const favoriteAccounts = favorites
    .map(code => accounts.find(account => account.code === code))
    .filter((account): account is AccountLike => !!account)

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
        className="input font-mono text-sm"
        value={value ?? ''}
        onChange={event => {
          const next = event.target.value || null
          onChange(next)
          saveFavorite(accountType, next)
        }}
      >
        <option value="">{required ? 'اختر حساباً' : '— غير محدد —'}</option>
        {showFavorites && favoriteAccounts.length > 0 && (
          <optgroup label="المفضلة مؤخراً">
            {favoriteAccounts.map(account => (
              <option key={`fav-${account.code}`} value={account.code}>
                {account.code} — {account.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={isLoading ? 'جارٍ التحميل...' : 'الحسابات'}>
          {filtered.map(account => (
            <option key={account.code} value={account.code}>
              {account.code} — {account.name}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  )
}

export default AccountPicker
