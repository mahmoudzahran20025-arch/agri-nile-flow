const XLSX = require('xlsx');
const { Client } = require('undici'); // For D1 API via Worker if needed, but we use wrangler CLI for stability
const { execSync } = require('child_process');

const COMPANY_ID = 1;
const DB_NAME = "agri-nile-flow-data-lake";

async function runSQL(sql) {
  const escapedSql = sql.replace(/"/g, '\"');
  execSync(`npx wrangler d1 execute ${DB_NAME} --remote --command="${escapedSql}"`, { stdio: 'inherit' });
}

async function importPartnerEquity() {
  console.log("⬆ Importing Partner Equity...");
  const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx');
  const ws = wb.Sheets["مساهمة الشركاء"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  
  // Rows 7 and 8 are the data
  const partners = [
    { name: rows[7][1], capital: rows[7][2] },
    { name: rows[8][1], capital: rows[8][2] }
  ];

  for (const p of partners) {
    if (p.name && p.capital) {
      console.log(`  - Partner: ${p.name} | Capital: ${p.capital}`);
      const sql = `INSERT OR REPLACE INTO partners (company_id, name, capital_paid) VALUES (${COMPANY_ID}, '${p.name}', ${p.capital});`;
      await runSQL(sql);
    }
  }
}

async function importDetailedSuppliers() {
  console.log("⬆ Importing 15,000+ Detailed Supplier Transactions...");
  const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
  const ws = wb.Sheets[wb.SheetNames[3]]; // "كشف حساب مفصل"
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const transactions = [];
  let currentSupplier = null;

  // We need to parse headers to find supplier names, or use the data rows if they contain codes
  // Based on debug, data starts around Row 9
  for (let i = 9; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 10) continue;

    const dateNum = r[2];
    const desc = r[3];
    const center = r[4];
    const category = r[5];
    const credit = r[8] || 0; // Purchase/Service (Amount we owe)
    const debit = r[9] || 0;  // Payment (Amount we paid)
    
    // In this sheet, there might not be a supplier code in every row. 
    // We might need to look up the supplier name from the context.
    // BUT! I see "Supplier Name" in Column 1 in some rows?
    const supplierName = r[1]; 
    
    if (dateNum && (credit || debit)) {
      transactions.push({
        date: new Date((dateNum - 25569) * 86400 * 1000).toISOString().split('T')[0],
        supplier: supplierName || "Generic Supplier",
        desc: `${desc} - ${center || ''} - ${category || ''}`,
        credit,
        debit,
        amount: credit || debit
      });
    }
  }

  console.log(`  Filtered ${transactions.length} valid transactions.`);
  
  // Import in batches of 100
  for (let i = 0; i < transactions.length; i += 100) {
    const batch = transactions.slice(i, i + 100);
    let sql = "BEGIN TRANSACTION;";
    batch.forEach(tx => {
       // We'll use a subquery to find supplier code by name if possible, or just insert with 0
       sql += `INSERT INTO supplier_transactions (company_id, transaction_date, notes, amount, credit, debit, status) 
               VALUES (${COMPANY_ID}, '${tx.date}', '${tx.desc.replace(/'/g, "''")}', ${tx.amount}, ${tx.credit}, ${tx.debit}, 'posted');`;
    });
    sql += "COMMIT;";
    await runSQL(sql);
    console.log(`  - Processed ${i + batch.length} / ${transactions.length}`);
  }
}

async function main() {
  try {
    await importPartnerEquity();
    await importDetailedSuppliers();
    console.log("✅ DONE!");
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

main();
