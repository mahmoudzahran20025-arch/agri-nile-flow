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
