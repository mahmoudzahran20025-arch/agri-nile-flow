import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const on  = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  if (!offline) return null

  return (
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center gap-2 text-sm font-medium shrink-0">
      <WifiOff size={16} />
      <span>لا يوجد اتصال بالإنترنت — أنت في وضع القراءة فقط حتى تعود الشبكة</span>
    </div>
  )
}
