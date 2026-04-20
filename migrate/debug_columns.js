const XLSX = require('xlsx');
const path = require('path');

const fileName = 'الموردين والعملاء نواة المستقبل2025-2026.xlsx';
const filePath = path.join(__dirname, fileName);

try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = 'البيان';
    const sheet = workbook.Sheets[sheetName];
    
    if (!sheet) {
        console.error('Sheet \"' + sheetName + '\" not found');
        process.exit(1);
    }

    // Read rows as array of arrays (header-less)
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // Row index 3 (0-indexed) is the first data row
    const row3 = data[3];

    if (!row3) {
        console.error('Row 3 not found');
        process.exit(1);
    }

    console.log('--- Inspecting Row 3 ---');
    row3.forEach((value, index) => {
        if (value !== undefined && value !== null && value !== '') {
            console.log('Column [' + index + ']: ' + value);
        }
    });

} catch (error) {
    console.error('Error:', error.message);
}
