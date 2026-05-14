const { execSync } = require('child_process');

const queries = [
  "SELECT 'Total Suppliers' as Metric, COUNT(*) as Value FROM suppliers;",
  "SELECT 'Total Items' as Metric, COUNT(*) as Value FROM items;",
  "SELECT 'Total Cost Centers' as Metric, COUNT(*) as Value FROM cost_centers;",
  "SELECT 'Total Chart of Accounts' as Metric, COUNT(*) as Value FROM chart_of_accounts;",
  "SELECT 'Total Journal Entries' as Metric, COUNT(*) as Value FROM journal_entries;",
  "SELECT 'Total JE Lines' as Metric, COUNT(*) as Value FROM journal_entry_lines;",
  "SELECT 'Total Supplier Transactions' as Metric, COUNT(*) as Value FROM supplier_transactions;",
  "SELECT 'Total Inventory Movements' as Metric, COUNT(*) as Value FROM inventory_movements;",
  "SELECT 'Total Cash Transactions' as Metric, COUNT(*) as Value FROM cash_transactions;",
  "SELECT 'Suppliers missing BPG' as Metric, COUNT(*) as Value FROM suppliers WHERE bus_posting_group_code IS NULL;",
  "SELECT 'Items missing PPG' as Metric, COUNT(*) as Value FROM items WHERE prod_posting_group_code IS NULL;",
  "SELECT 'Items missing IPG' as Metric, COUNT(*) as Value FROM items WHERE inv_posting_group_code IS NULL;",
  "SELECT 'Unbalanced Journal Entries' as Metric, COUNT(*) as Value FROM (SELECT entry_id, SUM(debit) as total_debit, SUM(credit) as total_credit FROM journal_entry_lines GROUP BY entry_id HAVING ABS(SUM(debit) - SUM(credit)) > 0.01);",
  "SELECT 'GL Lines missing Account' as Metric, COUNT(*) as Value FROM journal_entry_lines WHERE account_code IS NULL;",
  "SELECT 'Supplier Tx without GL' as Metric, COUNT(*) as Value FROM supplier_transactions WHERE journal_entry_id IS NULL;",
  "SELECT 'Inventory Movements without GL' as Metric, COUNT(*) as Value FROM inventory_movements WHERE journal_entry_id IS NULL;",
  "SELECT 'Cash Transactions without GL' as Metric, COUNT(*) as Value FROM cash_transactions WHERE journal_entry_id IS NULL;",
  "SELECT supplier_type as SupplierType, COUNT(*) as Count FROM suppliers GROUP BY supplier_type;",
  "SELECT status as PeriodStatus, COUNT(*) as Count FROM financial_periods GROUP BY status;"
];

const results = [];

for (const q of queries) {
  try {
    const cmd = `npx wrangler d1 execute agri-nile-flow-data-lake --remote --command="${q}" --json`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const jsonOutput = output.substring(output.indexOf('['), output.lastIndexOf(']') + 1);
    const parsed = JSON.parse(jsonOutput);
    results.push(...parsed[0].results);
  } catch (err) {
    console.error(`Error executing query: ${q}`, err.message);
  }
}

console.log(JSON.stringify(results, null, 2));
