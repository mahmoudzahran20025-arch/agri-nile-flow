#!/usr/bin/env node
/**
 * Run 6 Audit Queries on D1 Database
 * Results for AUDIT_DATA_QUALITY_ASSESSMENT.md
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';

function runQuery(sql, queryName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`QUERY: ${queryName}`);
  console.log('='.repeat(60));
  console.log(`SQL: ${sql}`);
  
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"')}"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    
    console.log('\n--- RESULT ---');
    console.log(result);
    
    try {
      const parsed = JSON.parse(result);
      if (parsed[0]?.results) {
        console.log('\nParsed Results:');
        console.table(parsed[0].results);
        return parsed[0].results;
      }
    } catch (e) {
      // Not JSON or no results
    }
    
    return result;
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}`);
    if (err.stderr) console.error(`stderr: ${err.stderr}`);
    return null;
  }
}

console.log('\n' + '='.repeat(60));
console.log('AUDIT DATA QUALITY ASSESSMENT — 6 SQL QUERIES');
console.log('='.repeat(60));
console.log(`Database: ${DB}`);
console.log(`Date: ${new Date().toISOString()}`);
console.log('='.repeat(60));

// QUERY 1: Count total journal entries
runQuery(
  'SELECT COUNT(*) as total_entries FROM journal_entries WHERE is_posted = 1',
  'Q1: Total Posted Journal Entries'
);

// QUERY 2: Check ref_type breakdown
runQuery(
  'SELECT ref_type, COUNT(*) as count FROM journal_entries WHERE is_posted = 1 GROUP BY ref_type',
  'Q2: Breakdown by Reference Type'
);

// QUERY 3: GL Balance check
runQuery(
  'SELECT SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit, ABS(SUM(jl.debit) - SUM(jl.credit)) as imbalance FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = 1 AND je.is_posted = 1',
  'Q3: GL Balance Check (Company 1)'
);

// QUERY 4: Source tracking status
runQuery(
  'SELECT COUNT(*) as total_lines, COUNT(CASE WHEN source_ledger IS NOT NULL THEN 1 END) as with_source_ledger, COUNT(CASE WHEN source_ledger IS NULL THEN 1 END) as without_source_ledger FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = 1 AND je.is_posted = 1',
  'Q4: Source Ledger Tracking Status'
);

// QUERY 5: Business events status
runQuery(
  'SELECT status, COUNT(*) as count, COUNT(CASE WHEN journal_entry_id IS NOT NULL THEN 1 END) as linked_to_gl FROM business_events WHERE company_id = 1 GROUP BY status',
  'Q5: Business Events Status'
);

// QUERY 6: Monthly breakdown
runQuery(
  'SELECT strftime(\'%Y-%m\', entry_date) as month, COUNT(*) as entry_count FROM journal_entries WHERE company_id = 1 AND is_posted = 1 GROUP BY strftime(\'%Y-%m\', entry_date) ORDER BY month',
  'Q6: Monthly Entry Breakdown'
);

console.log('\n' + '='.repeat(60));
console.log('AUDIT COMPLETE');
console.log('='.repeat(60));
