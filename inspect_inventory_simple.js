const XLSX = require("xlsx");
const fileName = "????? ???? ????????2025-2026.xlsx";
try {
    const workbook = XLSX.readFile(fileName);
    console.log("Sheet Names:", workbook.SheetNames);
    const sheetName = "????????";
    if (!workbook.Sheets[sheetName]) {
        console.error("Sheet " + sheetName + " not found");
        process.exit(1);
    }
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, {header: 1});
    
    console.log("\n--- Headers (Index 1) ---");
    const headerRow = data[1] || [];
    for (let i = 0; i <= 31; i++) {
        console.log("Column [" + i + "]: " + (headerRow[i] !== undefined ? headerRow[i] : "EMPTY"));
    }

    console.log("\n--- First Data Row (Index 2) ---");
    const firstDataRow = data[2] || [];
    for (let i = 0; i <= 31; i++) {
        console.log("Column [" + i + "]: " + (firstDataRow[i] !== undefined ? firstDataRow[i] : "EMPTY"));
    }

    console.log("\nTotal Rows:", data.length);
    
    const usedCols = [];
    for (let i = 0; i <= 31; i++) {
        let hasData = false;
        for (let j = 2; j < data.length; j++) {
            if (data[j] && data[j][i] !== undefined && data[j][i] !== "") {
                hasData = true;
                break;
            }
        }
        if (hasData) usedCols.push(i);
    }
    console.log("\nUsed Columns (Indices):", usedCols.join(", "));
} catch (e) {
    console.error("Error:", e.message);
}
