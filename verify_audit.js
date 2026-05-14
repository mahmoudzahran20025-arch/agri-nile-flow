const { execSync } = require('child_process');

const queries = [
  "SELECT COUNT(*) as posted_no_je FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL;",
  "SELECT COUNT(*) as im_no_je FROM inventory_movements WHERE company_id=1 AND gl_posting_status NOT IN ('exempt_zero_value','future_blocked') AND journal_entry_id IS NULL;",
  "SELECT COUNT(*) as error_events FROM business_events WHERE company_id=1 AND status='error';",
  "SELECT status, COUNT(*) as cnt FROM business_events WHERE company_id=1 GROUP BY status ORDER BY cnt DESC;",
  "SELECT COUNT(*) as stale_balances FROM inventory_balances WHERE company_id=1 AND is_stale=1;",
  "SELECT fp.name, fp.is_closed, fp.start_date, fp.end_date, COUNT(je.id) as je_count FROM financial_periods fp LEFT JOIN journal_entries je ON je.company_id=fp.company_id WHERE fp.company_id=1 GROUP BY fp.id ORDER BY fp.start_date;",
  "SELECT SUM(debit)-SUM(credit) as gl_balance FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id WHERE je.company_id=1;"
];

const results = [];

for (const q of queries) {
  try {
    const cmd = `npx wrangler d1 execute agri-nile-flow-data-lake --remote --command="${q}" --json`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const jsonOutput = output.substring(output.indexOf('['), output.lastIndexOf(']') + 1);
    const parsed = JSON.parse(jsonOutput);
    results.push({ query: q, result: parsed[0].results });
  } catch (err) {
    console.error(`Error executing query: ${q}`, err.message);
  }
}

console.log(JSON.stringify(results, null, 2));
