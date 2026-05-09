const { execSync } = require('child_process');

const queries = [
  { 
    name: "Control Accounts mapped to Header/Inactive", 
    sql: "SELECT p.mapping_key, p.account_code, c.is_header, c.is_active FROM posting_rules p JOIN chart_of_accounts c ON p.account_code = c.code WHERE p.rule_type = 'control' AND (c.is_header = 1 OR c.is_active = 0);" 
  },
  { 
    name: "General Rules mapped to Header/Inactive", 
    sql: "SELECT p.id, p.bus_posting_group_code, p.prod_posting_group_code, c.code, c.is_header, c.is_active FROM posting_rules p JOIN chart_of_accounts c ON c.code IN (p.sales_account, p.purchases_account, p.cogs_account, p.expense_account) WHERE p.rule_type = 'general' AND (c.is_header = 1 OR c.is_active = 0);" 
  },
  { 
    name: "Inventory Rules mapped to Header/Inactive", 
    sql: "SELECT p.id, p.inv_posting_group_code, p.prod_posting_group_code, c.code, c.is_header, c.is_active FROM posting_rules p JOIN chart_of_accounts c ON c.code IN (p.inventory_account, p.wip_account, p.finished_goods_account) WHERE p.rule_type = 'inventory' AND (c.is_header = 1 OR c.is_active = 0);" 
  },
  {
    name: "Crop Mappings mapped to Header/Inactive",
    sql: "SELECT m.crop_label, m.account_code, c.is_header, c.is_active FROM crop_account_mappings m JOIN chart_of_accounts c ON m.account_code = c.code WHERE c.is_header = 1 OR c.is_active = 0;"
  },
  {
    name: "Count Rules by Type",
    sql: "SELECT rule_type, count(*) as count FROM posting_rules GROUP BY rule_type;"
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
