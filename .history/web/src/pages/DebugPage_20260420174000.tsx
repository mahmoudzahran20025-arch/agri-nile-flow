import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { api, suppliersApi, treasuryApi, inventoryApi } from '../api/client'

export default function DebugPage() {
  const { token, user, company } = useAppStore()
  const [logs, setLogs] = useState<string[]>([])
  const [apiResults, setApiResults] = useState<Record<string, unknown>>({})

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
      log(`User: ${user?.name || 'NONE'}`)
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
      log('Testing /api/inventory/balances...')
      try {
        const inventoryResp = await inventoryApi.balances()
        log(`✅ Inventory response received:`)
        setApiResults(prev => ({ ...prev, inventory: inventoryResp }))
        log(`Data count: ${Array.isArray(inventoryResp) ? inventoryResp.length : 0}`)
      } catch (e) {
        log(`❌ Inventory error: ${String(e)}`)
      }

      log('=== API Tests Complete ===')
    } catch (e) {
      log(`💥 Unexpected error: ${String(e)}`)
    }
  }

  useEffect(() => {
    log('🚀 Debug page loaded')
    log(`Initial state - Token: ${!!token}, User: ${user?.name}, Company: ${company?.name}`)
  }, [])

  return (
    <div className="p-8 bg-slate-900 text-white min-h-screen font-mono" dir="ltr">
      <h1 className="text-2xl font-bold mb-4">🔍 Debug Console</h1>

      {/* Auth State */}
      <div className="mb-6 p-4 bg-slate-800 rounded">
        <h2 className="text-lg font-bold mb-2">Auth State</h2>
        <p>Token: <span className={token ? 'text-green-400' : 'text-red-400'}>{token ? '✅ Present' : '❌ Missing'}</span></p>
        <p>User: <span className={user ? 'text-green-400' : 'text-red-400'}>{user?.name || '❌ No user'}</span></p>
        <p>Company: <span className={company ? 'text-green-400' : 'text-red-400'}>{company?.name || '❌ No company'}</span></p>
      </div>

      {/* Test Button */}
      <button
        onClick={testApis}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded font-bold mb-6"
      >
        🧪 Run API Tests
      </button>

      {/* Logs */}
      <div className="mb-6 p-4 bg-slate-800 rounded">
        <h2 className="text-lg font-bold mb-2">📋 Logs ({logs.length})</h2>
        <div className="overflow-y-auto max-h-64 space-y-1 text-sm">
          {logs.map((log, i) => (
            <p key={i} className="text-slate-400">
              {log}
            </p>
          ))}
        </div>
      </div>

      {/* API Results */}
      {Object.keys(apiResults).length > 0 && (
        <div className="p-4 bg-slate-800 rounded">
          <h2 className="text-lg font-bold mb-2">📊 API Results</h2>
          <pre className="text-xs overflow-x-auto max-h-96 text-slate-300">
            {JSON.stringify(apiResults, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
