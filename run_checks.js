const { execSync } = require('child_process');

const queries = [
  { name: "Total accounts breakdown", sql: "SELECT is_header, account_type, count(*) as count FROM chart_of_accounts GROUP BY is_header, account_type;" },
  { name: "Total journal entries & lines", sql: "SELECT (SELECT count(*) FROM journal_entries) as total_entries, (SELECT count(*) FROM journal_entry_lines) as total_lines;" },
  { name: "Phantom Accounts (Used in ledger but missing in CoA)", sql: "SELECT l.account_code, COUNT(*) as line_count, SUM(l.debit) as total_dr, SUM(l.credit) as total_cr FROM journal_entry_lines l LEFT JOIN chart_of_accounts a ON l.account_code = a.code AND l.company_id = a.company_id WHERE a.code IS NULL GROUP BY l.account_code;" },
  { name: "Unbalanced Journal Entries", sql: "SELECT e.id, e.entry_number, SUM(l.debit) as total_dr, SUM(l.credit) as total_cr, (SUM(COALESCE(l.debit, 0)) - SUM(COALESCE(l.credit, 0))) as difference FROM journal_entries e JOIN journal_entry_lines l ON e.id = l.entry_id GROUP BY e.id HAVING ABS(SUM(COALESCE(l.debit, 0)) - SUM(COALESCE(l.credit, 0))) > 0.01;" },
  { name: "Accounts with no transactions (Idle Leaf Accounts)", sql: "SELECT count(*) as idle_leaf_accounts FROM chart_of_accounts a LEFT JOIN journal_entry_lines l ON a.code = l.account_code AND a.company_id = l.company_id WHERE a.is_header = 0 AND l.id IS NULL;" },
  { name: "Accounts used in transactions but marked as header!", sql: "SELECT a.code, a.name, count(l.id) as line_count FROM chart_of_accounts a JOIN journal_entry_lines l ON a.code = l.account_code AND a.company_id = l.company_id WHERE a.is_header = 1 GROUP BY a.code, a.name;" }
];

function run() {
  console.log("Starting DB checks on production...\n");
  for (const q of queries) {
    console.log(`\n--- ${q.name} ---`);
    try {
      const result = execSync(`npx wrangler d1 execute agri-nile-flow-data-lake --remote --command="${q.sql}" --json`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      
      const match = result.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (parsed && parsed.length > 0 && parsed[0].results) {
             console.table(parsed[0].results);
          } else {
             console.log("No results.");
          }
        } catch (e) {
           console.log("Failed to parse JSON.");
        }
      } else {
         console.log("No JSON found in output.");
      }
    } catch(err) {
      console.log("Error executing query.", err.message);
    }
  }
}

run();
