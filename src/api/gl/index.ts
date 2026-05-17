import { Hono } from 'hono'
import type { Env } from '../../types'

// Import all GL sub-modules
import accounts from './accounts'
import periods from './periods'
import entries from './entries'
import postingSetup from './posting-setup'
import batchJobs from './batch-jobs'
import reconciliation from './reconciliation'
import reports from './reports'
import integrity from './integrity'
import masterData from './master-data'
import exchangeRates from './exchange-rates'
import eventTypes from './event-types'
import accountRolePolicy from './account-role-policy'
import hardening from './hardening'
import enhancedLedger from './enhanced_ledger'
import journalEntryEngine from './journal_entry_regeneration'
import preview from './preview'
import depreciation from './depreciation'

// Main GL router - aggregator for all GL sub-modules
const gl = new Hono<{ Bindings: Env }>()

// Mount all sub-routers
// Accounts: Chart of Accounts management
gl.route('/accounts', accounts)

// Periods: Financial periods management
gl.route('/periods', periods)

// Entries: Journal entries, reversals, manual entries
gl.route('/entries', entries)

// Master Data: Material Groups, Business Units, Currencies, Roles (Phase 1)
gl.route('/master-data', masterData)

// Exchange Rates: FX rates for multi-currency support (Phase 2)
gl.route('/exchange-rates', exchangeRates)

// Event Types: Business event type catalogue (Phase 2 Task 2)
gl.route('/event-types', eventTypes)

// Account Role Policy: Role → Account mapping engine (Phase 3)
gl.route('/account-role-policy', accountRolePolicy)

// Posting Setup: Posting groups, posting rules, validation
gl.route('/', postingSetup)

// Batch Jobs: Batch posting and processing
gl.route('/', batchJobs)

// Reconciliation: Source documents reconciliation
gl.route('/reconciliation', reconciliation)

// Reports: Ledger, Trial Balance, Income Statement, Balance Sheet
gl.route('/', reports)

// Integrity: System integrity checks, audit logs, health score
gl.route('/', integrity)

// Hardening: Feature flags, baseline metrics, governance controls
gl.route('/hardening', hardening)

// Enhanced Ledger: Server-side filtered ledger + CSV export
gl.route('/', enhancedLedger)

// JE Regeneration: Rebuild journal entries from business events with trace metadata
gl.route('/regeneration', journalEntryEngine)

// Preview: Dry-run GL line resolution without writing to DB
gl.route('/', preview)

// Depreciation: Monthly batch depreciation posting and schedule view
gl.route('/', depreciation)

// Schema migrations registry — read-only admin visibility
gl.get('/migrations/registry', async (c) => {
  const db = c.env.DB
  try {
    const rows = await db
      .prepare('SELECT id, filename, name, source, applied_at FROM schema_migrations ORDER BY id ASC')
      .all<{ id: number; filename: string; name: string; source: string; applied_at: string }>()
    return c.json({ success: true, data: { total: rows.results.length, migrations: rows.results } })
  } catch {
    return c.json({ success: false, error: 'schema_migrations table not found — migration 0126 not applied' }, 404)
  }
})

// Health check endpoint for the GL module
gl.get('/health', (c) => {
  return c.json({
    success: true,
    module: 'gl',
    version: '2.0.0-refactored',
    submodules: [
      'accounts',
      'periods',
      'entries',
      'master-data',
      'posting-setup',
      'batch-jobs',
      'reconciliation',
      'reports',
      'integrity',
    ],
  })
})

export default gl
