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

// Main GL router - aggregator for all GL sub-modules
const gl = new Hono<{ Bindings: Env }>()

// Mount all sub-routers
// Accounts: Chart of Accounts management
gl.route('/accounts', accounts)

// Periods: Financial periods management
gl.route('/periods', periods)

// Entries: Journal entries, reversals, manual entries
gl.route('/entries', entries)
gl.route('/manual-entries', entries)

// Posting Setup: Posting groups, posting rules, validation
gl.route('/posting-groups', postingSetup)
gl.route('/posting-rules', postingSetup)
gl.route('/posting-setup', postingSetup)

// Batch Jobs: Batch posting and processing
gl.route('/batch-post', batchJobs)

// Reconciliation: Source documents reconciliation
gl.route('/reconciliation', reconciliation)

// Reports: Ledger, Trial Balance, Income Statement, Balance Sheet
gl.route('/ledger', reports)
gl.route('/trial-balance', reports)
gl.route('/trial-balance-fast', reports)
gl.route('/income-statement', reports)
gl.route('/balance-sheet', reports)

// Integrity: System integrity checks, audit logs, health score
gl.route('/integrity-check', integrity)
gl.route('/audit-log', integrity)
gl.route('/system-integrity-score', integrity)
gl.route('/orphans', integrity)

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
      'posting-setup',
      'batch-jobs',
      'reconciliation',
      'reports',
      'integrity',
    ],
  })
})

export default gl
