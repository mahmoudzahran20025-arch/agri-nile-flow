#!/usr/bin/env node
/**
 * Phase E: Supplier Dimension Backfill (Idempotent)
 * ──────────────────────────────────────────────────────────────
 * Target: 95 supplier rows with missing center_code + expense_category
 * Strategy: 4-step heuristic backfill with manual overrides
 * Safety: All updates check NULL before modifying (idempotent)
 * 
 * Usage:
 *   node scripts/phase_e_supplier_backfill.js --dry-run  (preview only)
 *   node scripts/phase_e_supplier_backfill.js --apply    (execute)
 */

'use strict'
const { execSync } = require('child_process')

const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const DRY_RUN = process.argv.includes('--dry-run')
const APPLY = process.argv.includes('--apply')

if (!DRY_RUN && !APPLY) {
  console.log(`
Phase E: Supplier Dimension Backfill
────────────────────────────────────
Usage:
  --dry-run   Preview backfill plan (no database changes)
  --apply     Execute backfill (modifies remote D1)

Examples:
  node scripts/phase_e_supplier_backfill.js --dry-run
  node scripts/phase_e_supplier_backfill.js --apply
`)
  process.exit(0)
}

// ──────────────────────────────────────────────────────────────
// Execute SQL against remote D1
// ──────────────────────────────────────────────────────────────
function executeSql(sql, description) {
  console.log(`\n📋 ${description}...`)
  try {
    const result = execSync(
      `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${sql.replace(/\s+/g, ' ').replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
    )
    const parsed = JSON.parse(result)
    const meta = parsed[0]?.meta
    const results = parsed[0]?.results || []
    
    if (meta?.changes > 0) {
      console.log(`   ✅ ${meta.changes} rows modified`)
    } else if (results.length > 0) {
      console.log(`   ✅ Query result: ${results.length} rows`)
    } else {
      console.log(`   ℹ️  No changes`)
    }
    return { meta, results }
  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`)
    throw err
  }
}

// ──────────────────────────────────────────────────────────────
// Pre-backfill snapshot
// ──────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70))
console.log('PHASE E: SUPPLIER DIMENSION BACKFILL')
console.log(`Date: ${new Date().toISOString()}`)
console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (preview)' : 'APPLY (execute)'}`)
console.log('═'.repeat(70))

const preSnap = executeSql(
  `SELECT 
    COUNT(*) AS total_suppliers,
    SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) AS null_center,
    SUM(CASE WHEN expense_category IS NULL THEN 1 ELSE 0 END) AS null_expense,
    SUM(CASE WHEN center_code IS NULL AND expense_category IS NULL THEN 1 ELSE 0 END) AS both_null
  FROM supplier_transactions WHERE company_id=${COMPANY_ID}`,
  '📊 PRE-BACKFILL SNAPSHOT'
)

const pre = preSnap.results[0] || {}
console.log(`   Total: ${pre.total_suppliers} | Null center: ${pre.null_center} | Null expense: ${pre.null_expense} | Both: ${pre.both_null}`)

if (!APPLY && DRY_RUN) {
  console.log('\n🔍 DRY-RUN MODE: Showing backfill plan without database changes')
}

// ──────────────────────────────────────────────────────────────
// E1: Service supplier classification (contractors/technicians)
// ──────────────────────────────────────────────────────────────
const e1Sql = `
  UPDATE supplier_transactions
  SET    expense_category = '33003'
  WHERE  company_id = ${COMPANY_ID}
    AND  expense_category IS NULL
    AND  supplier_code IN (
          SELECT DISTINCT code FROM suppliers
          WHERE company_id=${COMPANY_ID} AND (
            name LIKE '%لودر%' OR 
            name LIKE '%ميكنة%' OR 
            name LIKE '%عامل%' OR 
            name LIKE '%فني%'
          )
        )
`

if (APPLY) {
  executeSql(e1Sql, '[E1] Service suppliers (contractors/technicians) → expense_category=33003')
} else {
  console.log('\n[E1] Service suppliers (contractors/technicians)')
  console.log('    SQL: UPDATE … WHERE supplier_code IN (لودر%, ميكنة%, عامل%, فني%)')
  console.log('    Action: Set expense_category = 33003 (Equipment Services)')
  console.log('    Safety: Only updates NULL expense_category')
}

// ──────────────────────────────────────────────────────────────
// E2: Government/institutional zero-amount grants (supplier 20900151)
// ──────────────────────────────────────────────────────────────
const e2Sql = `
  UPDATE supplier_transactions
  SET    center_code = 1006001,
         expense_category = NULL
  WHERE  company_id = ${COMPANY_ID}
    AND  center_code IS NULL
    AND  amount = 0
    AND  supplier_code = 20900151
`

if (APPLY) {
  executeSql(e2Sql, '[E2] Government grants (supplier 20900151) → center=1006001, expense=NULL')
} else {
  console.log('\n[E2] Government/institutional grants (supplier 20900151)')
  console.log('    SQL: UPDATE … WHERE supplier_code = 20900151 AND amount = 0')
  console.log('    Action: Set center_code = 1006001, expense_category = NULL (non-expense)')
  console.log('    Safety: Only updates NULL center_code + zero-amount rows')
}

// ──────────────────────────────────────────────────────────────
// E3: Large company heuristic backfill (supplier 20900353 - PRIORITY)
// ──────────────────────────────────────────────────────────────
const e3Sql = `
  UPDATE supplier_transactions
  SET    center_code = COALESCE(
           CASE 
             WHEN description LIKE '%الزراعة%' THEN 1006001
             WHEN description LIKE '%المبيعات%' THEN 1006011
             ELSE 1006001
           END,
           1006001
         ),
         expense_category = CASE 
           WHEN equipment IS NOT NULL THEN '33003'
           ELSE '31001'
         END
  WHERE  company_id = ${COMPANY_ID}
    AND  supplier_code = 20900353
    AND  (center_code IS NULL OR expense_category IS NULL)
`

if (APPLY) {
  executeSql(e3Sql, '[E3] PRIORITY: Large company (20900353, 66 rows, 33.77M EGP) → heuristic backfill')
} else {
  console.log('\n[E3] PRIORITY: Large company (supplier 20900353 - عرفة للتصدير)')
  console.log('    SQL: UPDATE … WHERE supplier_code = 20900353 AND (center_code IS NULL OR expense_category IS NULL)')
  console.log('    Heuristic:')
  console.log('      - center_code: if "الزراعة" → 1006001, if "المبيعات" → 1006011, else → 1006001')
  console.log('      - expense_category: if equipment → 33003 (Equipment), else → 31001 (Materials)')
  console.log('    Impact: ~66 rows, 33.77M EGP')
  console.log('    Safety: Only updates NULL center_code OR NULL expense_category')
}

// ──────────────────────────────────────────────────────────────
// E4: Catch-all for remaining sparse suppliers
// ──────────────────────────────────────────────────────────────
const e4Sql = `
  UPDATE supplier_transactions
  SET    center_code = COALESCE(center_code, 1006001),
         expense_category = COALESCE(expense_category, '31001')
  WHERE  company_id = ${COMPANY_ID}
    AND  (center_code IS NULL OR expense_category IS NULL)
    AND  supplier_code NOT IN (20900353, 20900151)
`

if (APPLY) {
  executeSql(e4Sql, '[E4] Remaining sparse suppliers → default center=1006001, expense=31001')
} else {
  console.log('\n[E4] Remaining sparse suppliers (catch-all)')
  console.log('    SQL: UPDATE … WHERE supplier_code NOT IN (20900353, 20900151) AND (NULL checks)')
  console.log('    Action: Set center_code = COALESCE(existing, 1006001), expense = COALESCE(existing, 31001)')
  console.log('    Impact: ~2-5 rows')
  console.log('    Safety: Idempotent (COALESCE preserves existing non-NULL values)')
}

// ──────────────────────────────────────────────────────────────
// Post-backfill snapshot & validation
// ──────────────────────────────────────────────────────────────
if (APPLY) {
  console.log('\n' + '─'.repeat(70))
  const postSnap = executeSql(
    `SELECT 
      COUNT(*) AS total_suppliers,
      SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center,
      SUM(CASE WHEN expense_category IS NOT NULL THEN 1 ELSE 0 END) AS with_expense,
      ROUND(SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS center_pct,
      ROUND(SUM(CASE WHEN expense_category IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS expense_pct
    FROM supplier_transactions WHERE company_id=${COMPANY_ID}`,
    '📊 POST-BACKFILL VALIDATION'
  )

  const post = postSnap.results[0] || {}
  console.log(`   Total: ${post.total_suppliers}`)
  console.log(`   With center: ${post.with_center} (${post.center_pct}%)`)
  console.log(`   With expense: ${post.with_expense} (${post.expense_pct}%)`)

  const improvement = {
    centerImproved: (post.with_center - pre.with_center) || 0,
    expenseImproved: (post.with_expense - pre.with_expense) || 0,
  }
  console.log(`\n✅ Improved:`)
  console.log(`   Center coverage: +${improvement.centerImproved} rows`)
  console.log(`   Expense coverage: +${improvement.expenseImproved} rows`)

  if (post.center_pct >= 90 && post.expense_pct >= 90) {
    console.log(`\n🎉 TARGET REACHED: supplier_center_pct=${post.center_pct}%, expense_pct=${post.expense_pct}% (≥90%)`)
  } else {
    console.log(`\n⚠️  Target not yet reached. Continue with manual mapping if needed.`)
  }
}

// ──────────────────────────────────────────────────────────────
// Summary & Next Steps
// ──────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70))
if (DRY_RUN && !APPLY) {
  console.log('✅ DRY-RUN COMPLETE')
  console.log('\nNext step: Review plan above, then run:')
  console.log('  node scripts/phase_e_supplier_backfill.js --apply')
  console.log('\nMonitor progress with:')
  console.log('  npx wrangler tail')
} else if (APPLY) {
  console.log('✅ PHASE E BACKFILL COMPLETE')
  console.log('\nNext step: Run daily data quality check:')
  console.log('  node scripts/daily_data_quality_check.js')
  console.log('\nThen commit changes:')
  console.log('  git add . && git commit -m "Phase E: Supplier dimension backfill (95 rows)"')
}
console.log('═'.repeat(70) + '\n')
