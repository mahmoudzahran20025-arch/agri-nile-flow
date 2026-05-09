const { execSync } = require('child_process');

const queries = [
  { 
    name: "Unbalanced Journal Entries", 
    sql: "SELECT e.id, e.entry_number, SUM(l.debit) as total_dr, SUM(l.credit) as total_cr FROM journal_entries e JOIN journal_entry_lines l ON e.id = l.entry_id GROUP BY e.id HAVING ABS(SUM(COALESCE(l.debit, 0)) - SUM(COALESCE(l.credit, 0))) > 0.01;" 
  },
  { 
    name: "Orphan Journal Lines", 
    sql: "SELECT count(*) as count FROM journal_entry_lines WHERE entry_id NOT IN (SELECT id FROM journal_entries);" 
  },
  { 
    name: "Empty Journal Entries (No lines)", 
    sql: "SELECT count(*) as count FROM journal_entries e WHERE NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.entry_id = e.id);" 
  },
  { 
    name: "Supplier TX without GL", 
    sql: "SELECT count(*) as count FROM supplier_transactions WHERE journal_entry_id IS NULL AND status = 'posted';" 
  },
  { 
    name: "Inventory Movements without GL", 
    sql: "SELECT count(*) as count FROM inventory_movements WHERE journal_entry_id IS NULL AND status = 'posted' AND value_out > 0;" 
  },
  { 
    name: "Ghost Posted Records (GL with no source)", 
    sql: "SELECT count(*) as count FROM journal_entries e WHERE e.ref_type IN ('supplier_transaction', 'cash_transaction', 'inventory_movement') AND NOT EXISTS (SELECT 1 FROM supplier_transactions s WHERE s.id = e.ref_id) AND NOT EXISTS (SELECT 1 FROM cash_transactions c WHERE c.id = e.ref_id) AND NOT EXISTS (SELECT 1 FROM inventory_movements i WHERE i.id = e.ref_id);" 
  },
  { 
    name: "Double Posting (Multiple GL for same source)", 
    sql: "SELECT ref_type, ref_id, count(*) as gl_count FROM journal_entries WHERE ref_type IS NOT NULL AND ref_type != 'manual' GROUP BY ref_type, ref_id HAVING count(*) > 1;" 
  },
  { 
    name: "Outbox / Staging Pending failures", 
    sql: "SELECT status, count(*) as count FROM offline_queue GROUP BY status;" 
  },
  { 
    name: "Period NULL on posted entries", 
    sql: "SELECT count(*) as count FROM journal_entries WHERE period_id IS NULL AND is_posted = 1;" 
  },
  {
    name: "Supplier Operational vs Ledger Discrepancy",
    sql: `
      WITH ops AS (
         SELECT supplier_code, SUM(credit) - SUM(debit) as ops_balance 
         FROM supplier_transactions 
         GROUP BY supplier_code
      ),
      gl AS (
         SELECT l.center_code as supplier_code, SUM(l.credit) - SUM(l.debit) as gl_balance 
         FROM journal_entry_lines l 
         JOIN chart_of_accounts a ON l.account_code = a.code AND l.company_id = a.company_id 
         WHERE a.account_type = 'liability' 
         GROUP BY l.center_code
      )
      SELECT ops.supplier_code, ops.ops_balance, gl.gl_balance 
      FROM ops 
      LEFT JOIN gl ON ops.supplier_code = gl.supplier_code 
      WHERE ABS(COALESCE(ops.ops_balance,0) - COALESCE(gl.gl_balance,0)) > 1.0;
    `
  }
];

function run() {
  const results = {};
  for (const q of queries) {
    try {
      const result = execSync(`npx wrangler d1 execute agri-nile-flow-data-lake --remote --command="${q.sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const match = result.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed && parsed.length > 0 && parsed[0].results) {
           results[q.name] = parsed[0].results;
        } else {
           results[q.name] = [];
        }
      } else {
         results[q.name] = "NO_JSON";
      }
    } catch(err) {
      results[q.name] = "ERROR: " + err.message;
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

run();
