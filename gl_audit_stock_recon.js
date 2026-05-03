#!/usr/bin/env node
/**
 * gl_audit_stock_recon.js
 * =======================
 * Creates a GL memo journal entry + audit trail for the 48 zero-value
 * corrective inventory movements inserted by fix_negative_stock.js.
 *
 * What it does:
 *   1. Counts STOCK_RECON corrective movements in inventory_movements
 *   2. Inserts ONE draft journal_entries memo (is_posted=0, no lines)
 *   3. Inserts ONE gl_journal_audit CORRECT record referencing the memo
 *
 * The journal entry is a MEMO only (is_posted=0, no debit/credit lines)
 * because the corrections were zero-value — there is no P&L or balance sheet
 * impact.  Finance can find the underlying movements via:
 *   SELECT * FROM inventory_movements WHERE notes LIKE '%STOCK_RECON%'
 *
 * Usage:
 *   node gl_audit_stock_recon.js
 */

const { execSync } = require('child_process')

const DB          = 'agri-nile-flow-data-lake'
const COMPANY_ID  = 1
const PERIOD_ID   = 5          // "April 2026", open period covering 2026-04-01..2026-08-30
const ENTRY_DATE  = '2026-05-02'
const CREATED_BY  = 1          // system/admin user

// ── Helpers ──────────────────────────────────────────────────────────────────

function query(sql) {
  try {
    const out = execSync(
      `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return JSON.parse(out)[0]?.results ?? []
  } catch (err) {
    console.error(`  ❌  Query failed: ${err.message}`)
    process.exit(1)
  }
}

function execute(sql) {
  try {
    execSync(
      `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return true
  } catch (err) {
    console.error(`  ❌  Execute failed: ${err.message}`)
    return false
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════════════════╗')
console.log('║      GL Audit Memo — Stock Reconciliation (STOCK_RECON)         ║')
console.log('╚══════════════════════════════════════════════════════════════════╝\n')

// 1. Check for existing memo (idempotency)
const existing = query(`
  SELECT id, description FROM journal_entries
  WHERE company_id = ${COMPANY_ID}
    AND description LIKE '%STOCK_RECON%'
    AND entry_date = '${ENTRY_DATE}'
  LIMIT 1
`)
if (existing.length) {
  console.log(`  ℹ️  GL memo already exists: entry_id=${existing[0].id} — '${existing[0].description}'`)
  console.log('      Nothing to do.\n')
  process.exit(0)
}

// 2. Count STOCK_RECON corrective movements
const stats = query(`
  SELECT
    COUNT(*) AS total_movements,
    MIN(id)  AS min_id,
    MAX(id)  AS max_id,
    MIN(movement_date) AS earliest_date
  FROM inventory_movements
  WHERE company_id = ${COMPANY_ID}
    AND notes LIKE '%STOCK_RECON%'
`)[0] || {}

const count = Number(stats.total_movements ?? 0)
console.log(`  📊  Found ${count} STOCK_RECON corrective movement(s) (IDs ${stats.min_id}–${stats.max_id})\n`)

if (count === 0) {
  console.log('  ⚠️  No STOCK_RECON movements found — has fix_negative_stock.js --apply been run?\n')
  process.exit(1)
}

// 3. Insert the memo journal entry (is_posted=0, no lines — zero financial impact)
const memoDesc  = `مذكرة تسوية مخزنية: تصحيح ${count} رصيد سالب بقيمة صفرية — STOCK_RECON — ${ENTRY_DATE}`
const localId   = `stock_recon_gl_memo_${ENTRY_DATE}`

console.log(`  📝  Inserting GL memo journal entry...\n      "${memoDesc}"\n`)

const inserted = execute(`
  INSERT INTO journal_entries
    (company_id, period_id, entry_date, description, ref_type, is_posted, created_by, local_id)
  VALUES
    (${COMPANY_ID}, ${PERIOD_ID}, '${ENTRY_DATE}',
     '${memoDesc.replace(/'/g, "''")}',
     'inventory_movement', 0, ${CREATED_BY}, '${localId}')
`)
if (!inserted) process.exit(1)

// 4. Get the new entry ID
const newEntry = query(`
  SELECT id FROM journal_entries
  WHERE company_id = ${COMPANY_ID} AND local_id = '${localId}'
  LIMIT 1
`)[0]

if (!newEntry?.id) {
  console.error('  ❌  Could not retrieve new journal_entry id. Aborting.\n')
  process.exit(1)
}

const entryId = newEntry.id
console.log(`  ✅  journal_entries row created: id=${entryId}\n`)

// 5. Insert gl_journal_audit CORRECT record
const auditNotes = [
  `تم إدراج ${count} حركة تسوية مخزنية (نوع: إضافة، قيمة وحدة: صفر) بواسطة fix_negative_stock.js --apply.`,
  `نطاق التأثير: inventory_movements ids ${stats.min_id}–${stats.max_id}.`,
  `السبب: أرصدة سالبة ناتجة عن حركات صرف تجاوزت الرصيد. تم تصحيحها بحركات إضافة صفرية القيمة.`,
  `gl_posting_status = exempt_zero_value — لا أثر على الأرصدة المالية.`,
  `للاطلاع على التفاصيل: SELECT * FROM inventory_movements WHERE notes LIKE '%STOCK_RECON%'`
].join(' ')

console.log('  📋  Inserting gl_journal_audit CORRECT record...\n')

const auditInserted = execute(`
  INSERT INTO gl_journal_audit
    (journal_entry_id, entry_id, action, notes, changed_by, company_id)
  VALUES
    (${entryId}, ${entryId}, 'CORRECT',
     '${auditNotes.replace(/'/g, "''")}',
     ${CREATED_BY}, ${COMPANY_ID})
`)
if (!auditInserted) process.exit(1)

const auditRow = query(`
  SELECT id FROM gl_journal_audit
  WHERE journal_entry_id = ${entryId} AND action = 'CORRECT'
  LIMIT 1
`)[0]

console.log(`  ✅  gl_journal_audit row created: id=${auditRow?.id}\n`)

// 6. Summary
console.log('─'.repeat(70))
console.log(`  📌  GL Memo Summary`)
console.log(`      journal_entry_id  : ${entryId}`)
console.log(`      period            : April 2026 (id=${PERIOD_ID})`)
console.log(`      entry_date        : ${ENTRY_DATE}`)
console.log(`      is_posted         : 0 (memo — no financial impact)`)
console.log(`      movements covered : ${count} (ids ${stats.min_id}–${stats.max_id})`)
console.log(`      gl_journal_audit  : id=${auditRow?.id}, action=CORRECT`)
console.log('\n  ✅  GL audit trail for STOCK_RECON complete.\n')
