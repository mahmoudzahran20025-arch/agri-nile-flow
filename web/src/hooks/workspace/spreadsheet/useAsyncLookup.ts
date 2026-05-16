import { useState, useCallback, useRef } from 'react'

interface UseAsyncLookupOptions<T> {
  queryFn: (query: string) => Promise<T[]>
  debounceMs?: number
}

/**
 * Concurrency-safe lookup hook for smart spreadsheet cells.
 * Isolates loading state per-cell and cancels stale requests.
 */
export function useAsyncLookup<T>({ queryFn, debounceMs = 300 }: UseAsyncLookupOptions<T>) {
  const [results, setResults] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<Error | null>(null)

  const requestTokenRef = useRef(0)
  const timerRef        = useRef<ReturnType<typeof setTimeout>>()
  
  // Cache by query string to avoid hitting network for repeated cell lookups
  const cacheRef        = useRef<Record<string, T[]>>({})

  const search = useCallback((query: string) => {
    const term = query.trim()
    
    if (timerRef.current) clearTimeout(timerRef.current)
    
    if (!term) {
      setResults([])
      return
    }

    if (cacheRef.current[term]) {
      setResults(cacheRef.current[term])
      return
    }

    const currentToken = ++requestTokenRef.current

    timerRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await queryFn(term)
        
        // Stale request rejection
        if (requestTokenRef.current === currentToken) {
          cacheRef.current[term] = data
          setResults(data)
        }
      } catch (err) {
        if (requestTokenRef.current === currentToken) {
          setError(err instanceof Error ? err : new Error('Lookup failed'))
        }
      } finally {
        if (requestTokenRef.current === currentToken) {
          setLoading(false)
        }
      }
    }, debounceMs)
  }, [queryFn, debounceMs])

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    requestTokenRef.current++
    setResults([])
    setLoading(false)
    setError(null)
  }, [])

  return { search, clear, results, loading, error }
}
