const fs = require('fs');

// دالة لإزالة TRANSACTIONS وإنشاء ملفات صغيرة
function fixSQLForD1(inputFile, outputPrefix, maxLines = 100) {
  console.log(`Processing: ${inputFile}`);
  
  let content = fs.readFileSync(inputFile, 'utf8');
  
  // إزالة BEGIN TRANSACTION و COMMIT
  content = content.replace(/BEGIN TRANSACTION;?/gi, '');
  content = content.replace(/COMMIT;?/gi, '');
  content = content.replace(/--.*\n/g, ''); // إزالة التعليقات
  
  // تقسيم إلى statements
  const statements = content.split(';').map(s => s.trim()).filter(s => s.length > 0);
  
  console.log(`  Total statements: ${statements.length}`);
  
  // تقسيم إلى batches
  const batches = [];
  let currentBatch = [];
  
  for (const stmt of statements) {
    currentBatch.push(stmt);
    if (currentBatch.length >= maxLines) {
      batches.push([...currentBatch]);
      currentBatch = [];
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  
  // حفظ batches
  const files = [];
  for (let i = 0; i < batches.length; i++) {
    const batchFile = `${outputPrefix}_batch${String(i + 1).padStart(3, '0')}.sql`;
    const batchSQL = batches[i].join(';\n') + ';';
    fs.writeFileSync(batchFile, batchSQL);
    files.push(batchFile);
    console.log(`  Created: ${batchFile} (${batches[i].length} statements)`);
  }
  
  // إنشاء script لتنفيذ batches
  const scriptFile = `${outputPrefix}_execute.ps1`;
  const psScript = files.map((f, i) => 
    `# Batch ${i + 1}\nnpx wrangler d1 execute agri-nile-flow-data-lake --remote --file=${f}\nStart-Sleep -Seconds 3\n`
  ).join('\n');
  
  fs.writeFileSync(scriptFile, psScript);
  console.log(`  Created execution script: ${scriptFile}\n`);
  
  return files;
}

console.log('=== Fixing SQL files for D1 compatibility ===\n');

// 1. Items - تقسيم إلى batches صغيرة (50 سجل)
const itemFiles = fixSQLForD1('import_items_complete.sql', 'items_import', 50);

// 2. Cost Centers
const ccFiles = fixSQLForD1('setup_cost_centers_gl.sql', 'cost_centers_import', 100);

// 3. Banks
const bankFiles = fixSQLForD1('integrate_banks.sql', 'banks_import', 100);

// 4. Periods
const periodFiles = fixSQLForD1('setup_single_period.sql', 'periods_import', 100);

console.log('\n=== Summary ===');
console.log(`Items: ${itemFiles.length} batches`);
console.log(`Cost Centers: ${ccFiles.length} batches`);
console.log(`Banks: ${bankFiles.length} batches`);
console.log(`Periods: ${periodFiles.length} batches`);
console.log('\nTo execute:');
console.log('  ./items_import_execute.ps1');
console.log('  ./cost_centers_import_execute.ps1');
console.log('  ./banks_import_execute.ps1');
console.log('  ./periods_import_execute.ps1');
