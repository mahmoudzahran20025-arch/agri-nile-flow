import xlsx from 'xlsx';
const filename = 'الموردين والعملاء نواة المستقبل2025-2026.xlsx';
const workbook = xlsx.readFile(filename);
const sheetName = 'الكود';
const sheet = workbook.Sheets[sheetName];

if (!sheet) {
    console.error('Sheet \"' + sheetName + '\" not found');
    process.exit(1);
}

const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

console.log('--- Rows 1-5 ---');
for (let i = 0; i < 5 && i < data.length; i++) {
    console.log('Row ' + i + ':', JSON.stringify(data[i]));
}

console.log('\n--- Column Mapping ---');
const targetColumns = ['الكود', 'المورد', 'النشاط'];
targetColumns.forEach(target => {
    let found = false;
    for (let i = 0; i < 10 && i < data.length; i++) {
        const row = data[i];
        if (row) {
            const index = row.findIndex(cell => cell && String(cell).trim() === target);
            if (index !== -1) {
                console.log('Found \"' + target + '\" at Column Index: ' + index + ' in Row ' + i);
                found = true;
                break;
            }
        }
    }
    if (!found) {
        console.log('\"' + target + '\" not found in the first 10 rows');
    }
});
