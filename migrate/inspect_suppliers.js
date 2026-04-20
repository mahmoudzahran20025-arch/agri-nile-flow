import XLSX from 'xlsx';
const fileName = 'الموردين والعملاء نواة المستقبل2025-2026.xlsx';
try {
    const workbook = XLSX.readFile(fileName);
    const sheetName = 'البيان';
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
        console.error('Sheet \"' + sheetName + '\" not found.');
        process.exit(1);
    }
    const data = XLSX.utils.sheet_to_json(sheet, {header: 1});
    const headers = data[2] || [];
    const sample = data[3] || [];
    
    console.log('--- Column Mapping (0-31) ---');
    console.log('Index | Header | Sample Value');
    console.log('------------------------------');
    for (let i = 0; i <= 31; i++) {
        const header = headers[i] !== undefined ? headers[i] : '(empty)';
        const value = sample[i] !== undefined ? sample[i] : '(empty)';
        console.log(i.toString().padEnd(5) + ' | ' + header.toString().padEnd(20) + ' | ' + value);
    }
} catch (e) {
    console.error('Error:', e.message);
}
