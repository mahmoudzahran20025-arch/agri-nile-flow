import { useState, useEffect } from 'react'
import type { NetworkState } from '../../components/workspace/types'

export function useNetworkState() {
  const [networkState, setNetworkState] = useState<NetworkState>(
    navigator.onLine ? 'online' : 'offline'
  )

  useEffect(() => {
    const handleOnline = () => setNetworkState('online')
    const handleOffline = () => setNetworkState('offline')

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return networkState
}
