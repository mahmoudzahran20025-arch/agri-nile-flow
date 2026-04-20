/**
 * 📊 Comprehensive Excel Sheet Analyzer
 * Analyzes ALL columns and data structure
 * Run: node analyze_sheets.js
 */

const XLSX = require('xlsx');
const fs = require('fs');

// Auto-detect Excel file
const files = fs.readdirSync('.').filter(f => f.endsWith('.xlsx'));
const excelFile = files.find(f => f.includes('مخازن')) || files[0];

if (!excelFile) {
  console.error('❌ No Excel file found');
  process.exit(1);
}

console.log(`\n📁 Analyzing: ${excelFile}\n`);

const workbook = XLSX.readFile(excelFile);
console.log('📋 Sheets:', workbook.SheetNames.join(', '));
console.log('\n' + '='.repeat(80));

// Analyze each sheet
workbook.SheetNames.forEach(sheetName => {
  console.log(`\n📄 SHEET: ${sheetName}`);
  console.log('─'.repeat(80));
  
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  if (!data || data.length === 0) {
    console.log('  ❌ Empty sheet');
    return;
  }
  
  console.log(`  📊 Total Rows: ${data.length}`);
  
  // Show structure
  console.log('\n  📋 ROW STRUCTURE:');
  console.log('  ┌─ Row 1 (usually empty or summary)');
  if (data[0]) {
    console.log(`  │  ${data[0].map(v => v ? `✓ ${v}` : '—').join(' | ')}`);
  }
  
  console.log('  ├─ Row 2 (headers)');
  if (data[1]) {
    console.log(`  │  ${data[1].map((v, i) => `[${i}]=${v || '(empty)'}`).join(' | ')}`);
  }
  
  console.log('  ├─ Row 3 (first data)');
  if (data[2]) {
    console.log(`  │  ${data[2].map((v, i) => `[${i}]=${v || '(empty)'}`).join(' | ')}`);
  }
  
  console.log('  └─ Sample (rows 3-7)');
  
  // Detailed column analysis
  console.log('\n  📊 COLUMN ANALYSIS:');
  const headerRow = data[1] || [];
  
  const columns = [];
  for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
    const header = headerRow[colIdx];
    if (!header || header === '') continue; // Skip empty columns
    
    // Count non-empty values in this column
    let filledCount = 0;
    let sampleValues = [];
    
    for (let rowIdx = 2; rowIdx < Math.min(data.length, 10); rowIdx++) {
      const val = data[rowIdx]?.[colIdx];
      if (val !== undefined && val !== '' && val !== null) {
        filledCount++;
        if (sampleValues.length < 3) sampleValues.push(val);
      }
    }
    
    columns.push({
      index: colIdx,
      header,
      filled: filledCount,
      samples: sampleValues,
    });
  }
  
  // Group columns
  const importantCols = columns.filter(c => c.filled > 0.5 * (data.length - 2));
  const partialCols = columns.filter(c => c.filled > 0 && c.filled <= 0.5 * (data.length - 2));
  const sparseCol = columns.filter(c => c.filled === 0);
  
  if (importantCols.length > 0) {
    console.log('\n  ✅ IMPORTANT COLUMNS (most rows filled):');
    importantCols.forEach(c => {
      console.log(`     [${c.index}] ${c.header} (${c.filled}/${data.length - 2} rows)`);
      if (c.samples.length > 0) {
        console.log(`         Samples: ${c.samples.map(s => JSON.stringify(s)).join(', ')}`);
      }
    });
  }
  
  if (partialCols.length > 0) {
    console.log('\n  ⚠️  PARTIAL COLUMNS (some rows filled):');
    partialCols.forEach(c => {
      console.log(`     [${c.index}] ${c.header} (${c.filled}/${data.length - 2} rows)`);
      if (c.samples.length > 0) {
        console.log(`         Samples: ${c.samples.map(s => JSON.stringify(s)).join(', ')}`);
      }
    });
  }
  
  if (sparseCol.length > 0) {
    console.log(`\n  ❌ EMPTY COLUMNS (${sparseCol.length}): ${sparseCol.map(c => `[${c.index}]=${c.header}`).join(', ')}`);
  }
  
  // Mapping recommendation
  console.log('\n  📝 RECOMMENDED MAPPING FOR config.js:');
  console.log('  {');
  importantCols.forEach(c => {
    console.log(`    ${c.header.replace(/\s+/g, '_').toLowerCase()}: '${String.fromCharCode(65 + c.index)}', // [${c.index}]`);
  });
  console.log('  }');
});

console.log('\n' + '='.repeat(80));
console.log('\n✅ Analysis complete! Copy the mapping above to config.js\n');
