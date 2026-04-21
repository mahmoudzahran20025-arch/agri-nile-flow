import { Outlet } from 'react-router-dom'
import Sidebar      from '../components/Sidebar'
import Header       from '../components/Header'
import OfflineBanner from '../components/OfflineBanner'
import GlobalSearch  from '../components/GlobalSearch'
import MobileNav     from '../components/MobileNav'

export default function RootLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50" dir="rtl">
      {/* Global Search overlay — available on every page via Ctrl+K */}
      <GlobalSearch />

      {/* Sidebar — hidden on phones, visible on tablet+ */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <OfflineBanner />
        <Header />
        {/* pb-20 on phone for mobile nav bar; normal padding on tablet+ */}
        <main className="flex-1 overflow-y-auto p-4 md:p-5 lg:p-6 pb-20 md:pb-4 lg:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav — visible only on small screens */}
      <MobileNav />
    </div>
  )
}
