import { useNavigate, useLocation } from 'react-router-dom'
import { Home, ArrowLeft, Search } from 'lucide-react'

export default function NotFoundPage() {
  const navigate  = useNavigate()
  const location  = useLocation()

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-6">
        <Search size={36} className="text-slate-400" />
      </div>

      <h1 className="text-5xl font-bold text-slate-800 mb-2">404</h1>
      <p className="text-lg font-semibold text-slate-700 mb-1">Page not found</p>
      <p className="text-sm text-slate-500 mb-2 max-w-sm">
        The path <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">{location.pathname}</code> does not exist in this application.
      </p>

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
        >
          <ArrowLeft size={16} />
          Go back
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F2D5C] text-white hover:bg-[#0d2550] text-sm font-medium transition-colors"
        >
          <Home size={16} />
          Dashboard
        </button>
      </div>
    </div>
  )
}
