import XLSX from "xlsx"

const file = "الموردين والعملاء نواة المستقبل2025-2026.xlsx"
const wb = XLSX.readFile(file)
const ws = wb.Sheets["البيان"]
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

console.log("Row 4 (Data Example):", JSON.stringify(data[3]))
const row4 = data[3]
if (row4) {
  console.log("\nMapping indices to values for Row 4:")
  console.log(`Column 0 (Date): ${row4[0]}`)
  console.log(`Column 2 (Supplier Code): ${row4[2]}`)
  console.log(`Column 20 (Credit/دائن): ${row4[20]}`)
  console.log(`Column 21 (Debit/مدين): ${row4[21]}`)
}