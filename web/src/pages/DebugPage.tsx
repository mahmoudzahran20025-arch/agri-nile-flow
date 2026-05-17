import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { suppliersApi, treasuryApi, inventoryApi } from '../api/client'

export default function DebugPage() {
  const { token, user, company } = useAppStore()
  const [logs, setLogs] = useState<string[]>([])
  const [apiResults, setApiResults] = useState<Record<string, unknown>>({})
  const [isHydrated, setIsHydrated] = useState(false)

  // Check if store is hydrated from localStorage
  useEffect(() => {
    // Trigger rehydration from localStorage
    useAppStore.persist.rehydrate()
    setIsHydrated(true)
    
    const msg = '🚀 DebugPage initialized - checking auth from localStorage...'
    console.log(`🔍 [DEBUG] ${msg}`)
    setLogs([`${new Date().toLocaleTimeString()}: ${msg}`])
  }, [])

  const log = (msg: string) => {
    console.log(`🔍 [DEBUG] ${msg}`)
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])
  }

  const testApis = async () => {
    try {
      log('=== Starting API Tests ===')
      
      // 1. Check token
      log(`Token exists: ${!!token}`)
      if (token) log(`Token preview: ${token.substring(0, 20)}...`)
      
      // 2. Check auth state
      log(`User: ${user?.full_name || 'NONE'}`)
      log(`Company: ${company?.name || 'NONE'}`)
      
      // 3. Test suppliers
      log('Testing /api/suppliers...')
      try {
        const suppliersResp = await suppliersApi.list({ page: 1, size: 5 })
        log(`✅ Suppliers response received:`)
        setApiResults(prev => ({ ...prev, suppliers: suppliersResp }))
        log(`Data count: ${Array.isArray(suppliersResp) ? suppliersResp.length : suppliersResp?.data?.length ?? 0}`)
      } catch (e) {
        log(`❌ Suppliers error: ${String(e)}`)
      }

      // 4. Test treasury
      log('Testing /api/treasury/transactions...')
      try {
        const treasuryResp = await treasuryApi.list({ page: 1, size: 5 })
        log(`✅ Treasury response received:`)
        setApiResults(prev => ({ ...prev, treasury: treasuryResp }))
        log(`Data count: ${Array.isArray(treasuryResp) ? treasuryResp.length : treasuryResp?.data?.length ?? 0}`)
      } catch (e) {
        log(`❌ Treasury error: ${String(e)}`)
      }

      // 5. Test inventory
      log('Testing /api/inventory/stock-balances...')
      try {
        const inventoryResp = await inventoryApi.balancesList({ size: 10 })
        log(`✅ Inventory response received:`)
        setApiResults(prev => ({ ...prev, inventory: inventoryResp }))
        log(`Data count: ${inventoryResp?.data?.length ?? 0} (total: ${inventoryResp?.pagination?.total ?? 0})`)
      } catch (e) {
        log(`❌ Inventory error: ${String(e)}`)
      }

      log('=== API Tests Complete ===')
    } catch (e) {
      log(`💥 Unexpected error: ${String(e)}`)
    }
  }

  const checkLocalStorage = () => {
    log('=== Checking localStorage ===')
    try {
      const stored = localStorage.getItem('agro_app')
      if (stored) {
        log(`✅ Found agro_app in localStorage`)
        const parsed = JSON.parse(stored)
        log(`State keys: ${Object.keys(parsed.state || {}).join(', ')}`)
        if (parsed.state?.token) {
          log(`✅ Token found in stored state: ${parsed.state.token.substring(0, 20)}...`)
        }
      } else {
        log(`❌ No agro_app found in localStorage`)
      }
      
      const tokenKey = localStorage.getItem('agro_token')
      if (tokenKey) {
        log(`✅ Found agro_token separately: ${tokenKey.substring(0, 20)}...`)
      } else {
        log(`❌ No agro_token found`)
      }
    } catch (e) {
      log(`❌ localStorage check error: ${String(e)}`)
    }
    log('=== localStorage check complete ===')
  }

  if (!isHydrated) {
    return (
      <div className="p-8 bg-slate-900 text-white min-h-screen font-mono">
        <h1 className="text-2xl font-bold mb-4">🔍 Debug Console</h1>
        <p className="text-yellow-400">⏳ Loading auth state from localStorage...</p>
      </div>
    )
  }

  return (
    <div className="p-8 bg-slate-900 text-white min-h-screen font-mono" dir="ltr">
      <h1 className="text-2xl font-bold mb-4">🔍 Debug Console</h1>

      {/* Auth State */}
      <div className="mb-6 p-4 bg-slate-800 rounded">
        <h2 className="text-lg font-bold mb-2">Auth State</h2>
        <p>Token: <span className={token ? 'text-green-400' : 'text-red-400'}>{token ? '✅ Present' : '❌ Missing'}</span></p>
        <p>User: <span className={user ? 'text-green-400' : 'text-red-400'}>{user?.full_name || '❌ No user'}</span></p>
        <p>Company: <span className={company ? 'text-green-400' : 'text-red-400'}>{company?.name || '❌ No company'}</span></p>
        
        {!token && (
          <div className="mt-4 p-3 bg-red-900 border border-red-600 rounded">
            <p className="text-red-300 font-bold">⚠️ NOT LOGGED IN!</p>
            <p className="text-red-200 text-sm mt-2">Please login first:</p>
            <ol className="text-red-200 text-sm mt-2 ml-4 list-decimal">
              <li>Go to: <a href="/" className="text-blue-400 underline">Home</a></li>
              <li>Click "Login"</li>
              <li>Email: admin@nawa.eg</li>
              <li>Password: Admin@2025</li>
              <li>Company: نواة المستقبل</li>
              <li>Return to this Debug page</li>
            </ol>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="mb-6 flex gap-2 flex-wrap">
        <button
          onClick={testApis}
          disabled={!token}
          className={`px-4 py-2 rounded font-bold ${
            token ? 'bg-green-600 hover:bg-green-700 cursor-pointer' : 'bg-gray-500 cursor-not-allowed opacity-50'
          }`}
        >
          🧪 Run API Tests {!token && '(Login First)'}
        </button>
        
        <button
          onClick={checkLocalStorage}
          className="px-4 py-2 rounded font-bold bg-blue-600 hover:bg-blue-700"
        >
          📦 Check localStorage
        </button>

        <button
          onClick={() => {
            setLogs([])
            setApiResults({})
          }}
          className="px-4 py-2 rounded font-bold bg-slate-600 hover:bg-slate-700"
        >
          🗑️ Clear Logs
        </button>
      </div>

      {/* Logs */}
      <div className="mb-6 p-4 bg-slate-800 rounded">
        <h2 className="text-lg font-bold mb-2">📋 Logs ({logs.length})</h2>
        <div className="h-48 overflow-y-auto bg-slate-900 p-2 rounded border border-slate-700 text-xs text-gray-300">
          {logs.length === 0 ? (
            <p className="text-gray-500">No logs yet. Click a button above to start.</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="py-1 border-b border-slate-700">
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* API Results */}
      {Object.keys(apiResults).length > 0 && (
        <div className="mb-6 p-4 bg-slate-800 rounded">
          <h2 className="text-lg font-bold mb-2">📊 API Results</h2>
          <div className="space-y-4">
            {Object.entries(apiResults).map(([key, value]) => (
              <div key={key} className="bg-slate-900 p-3 rounded border border-slate-700">
                <h3 className="font-bold text-blue-400 mb-2">{key}:</h3>
                <pre className="text-xs overflow-auto max-h-48 text-gray-300">
                  {JSON.stringify(value, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


