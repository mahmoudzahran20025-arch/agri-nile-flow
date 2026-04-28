import { ReactNode } from 'react'
import QueryError from './QueryError'

interface Props {
  isLoading:     boolean
  isError:       boolean
  isEmpty:       boolean
  onRetry?:      () => void
  emptyMessage?: string
  /** Number of skeleton rows to render while loading */
  loadingRows?:  number
  className?:    string
  children:      ReactNode
}

/**
 * Unified query state wrapper.
 * Handles loading / error / empty states consistently.
 * Render children only when data is present.
 */
export default function QueryBoundary({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  emptyMessage = 'لا توجد بيانات',
  loadingRows  = 5,
  className    = '',
  children,
}: Props) {
  if (isError) {
    return <QueryError onRetry={onRetry} className={className} />
  }

  if (isLoading) {
    return (
      <div className={`space-y-2 ${className}`}>
        {Array.from({ length: loadingRows }).map((_, i) => (
          <div key={i} className="card animate-pulse h-12 bg-gray-100/70" />
        ))}
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div className={`card text-center py-14 text-gray-400 ${className}`}>
        <p className="text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return <>{children}</>
}
