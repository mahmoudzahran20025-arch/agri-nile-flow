#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
//  Agri-Nile Flow — Excel → D1 Migration CLI
//  Usage: node import.js [suppliers|treasury|inventory|all]
// ════════════════════════════════════════════════════════════════

import XLSX from 'xlsx'
import { execSync } from 'child_process'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  COMPANY_ID, DB,
  SUPPLIERS_CONFIG, TREASURY_CONFIG, INVENTORY_CONFIG,
} from './config.js'

const __dir = path.dirname(fileURLToPath(import.meta.url))

// ─── D1 helper ──────────────────────────────────────────────
function d1Execute(sql) {
  const tmpFile = path.join(__dir, '_tmp_migration.sql')
  writeFileSync(tmpFile, sql, 'utf8')
  try {
    const out = execSync(
      `npx wrangler d1 execute ${DB.database_name} --remote --file="${tmpFile}"`,
      { cwd: path.join(__dir, '..'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return out
  } finally {
    unlinkSync(tmpFile)
  }
}

// ─── Excel helpers ───────────────────────────────────────────
function readSheet(file, sheetName, startRow, colMap) {
  const wb = XLSX.readFile(path.join(__dir, file))
  const ws = wb.Sheets[sheetName]
  if (!ws) {
    const available = wb.SheetNames.join(', ')
    throw new Error(`Sheet "${sheetName}" not found in ${file}.\nAvailable: ${available}`)
  }
  
  // Read as array with header=1 to get raw columns
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  const rows = raw.slice(startRow - 1)  // Skip to startRow

  return rows
    .map(row => {
      const obj = {}
      for (const [field, colRef] of Object.entries(colMap)) {
        let value = null
        
        if (typeof colRef === 'number') {
          // Direct column index (0-based)
          value = row[colRef] ?? null
        } else if (typeof colRef === 'string') {
          if (colRef.length === 1 && colRef >= 'A' && colRef <= 'Z') {
            // Letter column reference (A-Z)
            const idx = colRef.charCodeAt(0) - 65
            value = row[idx] ?? null
          } else if (colRef.startsWith('__EMPTY')) {
            // __EMPTY reference
            if (colRef === '__EMPTY') {
              value = row[0] ?? null
            } else {
              const suffix = colRef.slice(7)
              const idx = parseInt(suffix, 10)
              if (!isNaN(idx)) {
                value = row[idx + 1] ?? null
              }
            }
          }
        }
        
        obj[field] = value
      }
      return obj
    })
    .filter(r => Object.values(r).some(v => v !== null && v !== ''))  // Skip fully empty rows
}

// ─── Date normalizer ─────────────────────────────────────────
function toISODate(v) {
  if (!v) return null
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
  }
  const s = String(v).trim()
  // DD/MM/YYYY
  const ddmm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (ddmm) {
    const [,d,m,y] = ddmm
    const year = y.length === 2 ? `20${y}` : y
    return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL'
  if (typeof v === 'number') return isNaN(v) ? 'NULL' : String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

// ════════════════════════════════════════════════════════════════
//  SUPPLIERS
// ════════════════════════════════════════════════════════════════
async function importSuppliers() {
  const cfg = SUPPLIERS_CONFIG
  console.log('\n📦 [1/2] قراءة بيانات الموردين…')

  // Master records
  let masters
  try {
    masters = readSheet(cfg.file, cfg.masterSheet.name, cfg.masterSheet.startRow, cfg.masterSheet.columns)
  } catch (e) {
    console.warn(`  ⚠️  ${e.message}`)
    console.warn('  سيتم تخطي استيراد الموردين الأساسيين')
    masters = []
  }

  if (masters.length) {
    console.log(`  → ${masters.length} مورد سيتم استيراده`)
    const inserts = masters
      .filter(r => r.code && r.name)
      .map(r => `INSERT OR IGNORE INTO suppliers (code, company_id, name, activity, notes) VALUES (${esc(Number(r.code))}, ${COMPANY_ID}, ${esc(r.name)}, ${esc(r.activity)}, ${esc(r.notes)});`)
      .join('\n')

    if (inserts) {
      console.log('  ⬆  رفع الموردين…')
      d1Execute(inserts)
      console.log('  ✅ تم استيراد الموردين')
    }
  }

  // Transactions
  console.log('\n📄 [2/2] قراءة حركات الموردين…')
  let txns
  try {
    txns = readSheet(cfg.file, cfg.transSheet.name, cfg.transSheet.startRow, cfg.transSheet.columns)
  } catch (e) {
    console.warn(`  ⚠️  ${e.message}`)
    return
  }

  const valid = txns.filter(r => r.supplier_code && r.transaction_date && r.amount)
  console.log(`  → ${valid.length} حركة صالحة من أصل ${txns.length}`)

  // Split into batches of 200
  for (let i = 0; i < valid.length; i += 200) {
    const batch = valid.slice(i, i + 200)
    const sql = batch.map(r => {
      const date = toISODate(r.transaction_date)
      if (!date) return null
      const amt   = Number(r.amount) || 0
      const etype = String(r.entry_type ?? 'م').trim()
      const credit = etype === 'د' ? amt : 0
      const debit  = etype === 'م' ? amt : 0
      const d = new Date(date)
      return `INSERT INTO supplier_transactions (company_id, supplier_code, transaction_date, entry_type, document_type, document_number, expense_category, unit, quantity, unit_price, amount, credit, debit, check_amount, notes, year, month, created_by_user_id) VALUES (${COMPANY_ID}, ${esc(Number(r.supplier_code))}, ${esc(date)}, ${esc(etype)}, ${esc(r.document_type)}, ${esc(r.document_number ? Number(r.document_number) : null)}, ${esc(r.expense_category)}, ${esc(r.unit)}, ${esc(r.quantity ? Number(r.quantity) : null)}, ${esc(r.unit_price ? Number(r.unit_price) : null)}, ${amt}, ${credit}, ${debit}, 0, ${esc(r.notes)}, ${d.getFullYear()}, ${d.getMonth()+1}, 1);`
    }).filter(Boolean).join('\n')

    if (sql) {
      process.stdout.write(`  ⬆  دفعة ${Math.floor(i/200)+1} (${batch.length} حركة)…`)
      d1Execute(sql)
      console.log(' ✓')
    }
  }
  console.log('  ✅ تم استيراد حركات الموردين')
}

// ════════════════════════════════════════════════════════════════
//  TREASURY
// ════════════════════════════════════════════════════════════════
async function importTreasury() {
  const cfg = TREASURY_CONFIG
  console.log('\n💰 قراءة بيانات الخزينة…')

  let rows
  try {
    rows = readSheet(cfg.file, cfg.sheet.name, cfg.sheet.startRow, cfg.sheet.columns)
  } catch (e) {
    console.error(`  ❌ ${e.message}`)
    return
  }

  const valid = rows.filter(r => r.transaction_date && r.direction && r.amount)
  console.log(`  → ${valid.length} حركة صالحة`)

  let runningBalance = 0

  // Process in order to calculate running balance
  for (let i = 0; i < valid.length; i += 200) {
    const batch = valid.slice(i, i + 200)
    const sql = batch.map(r => {
      const date = toISODate(r.transaction_date)
      if (!date) return null
      const amt = Number(r.amount) || 0
      const dir = String(r.direction ?? 'م').trim()
      runningBalance = dir === 'د' ? runningBalance + amt : runningBalance - amt
      const debit  = dir === 'م' ? amt : 0
      const credit = dir === 'د' ? amt : 0
      const d = new Date(date)
      return `INSERT INTO cash_transactions (company_id, transaction_date, direction, document_number, recipient_name, narration, amount, debit, credit, running_balance, notes, year, month, created_by_user_id) VALUES (${COMPANY_ID}, ${esc(date)}, ${esc(dir)}, ${esc(r.document_number ? Number(r.document_number) : null)}, ${esc(r.recipient_name)}, ${esc(r.narration)}, ${amt}, ${debit}, ${credit}, ${runningBalance}, ${esc(r.notes)}, ${d.getFullYear()}, ${d.getMonth()+1}, 1);`
    }).filter(Boolean).join('\n')

    if (sql) {
      process.stdout.write(`  ⬆  دفعة ${Math.floor(i/200)+1}…`)
      d1Execute(sql)
      console.log(' ✓')
    }
  }
  console.log(`  ✅ تم الاستيراد. الرصيد النهائي: ${runningBalance.toLocaleString('ar-EG')} جنيه`)
}

// ════════════════════════════════════════════════════════════════
//  INVENTORY
// ════════════════════════════════════════════════════════════════
async function importInventory() {
  const cfg = INVENTORY_CONFIG
  console.log('\n📦 قراءة بيانات المخزون…')

  let rows
  try {
    rows = readSheet(cfg.file, cfg.sheet.name, cfg.sheet.startRow, cfg.sheet.columns)
  } catch (e) {
    console.error(`  ❌ ${e.message}`)
    return
  }

  const valid = rows.filter(r => r.movement_date && r.warehouse && r.item_code && r.quantity)
  console.log(`  → ${valid.length} حركة صالحة`)

  // Track running balances in memory for WAC calculation
  const balances = {}   // `${item_code}:${warehouse}` → { qty, val }

  for (let i = 0; i < valid.length; i += 100) {
    const batch = valid.slice(i, i + 100)
    const sql = batch.map(r => {
      const date = toISODate(r.movement_date)
      if (!date) return null
      const itemCode = Number(r.item_code)
      const qty      = Math.abs(Number(r.quantity)) || 0
      const wh       = String(r.warehouse).trim()
      const mtype    = String(r.movement_type ?? 'اضافة').trim()
      const key      = `${itemCode}:${wh}`

      if (!balances[key]) balances[key] = { qty: 0, val: 0 }
      const prev = balances[key]

      // WAC unit price
      let unitPrice = r.unit_price ? Number(r.unit_price) : 0
      if (!unitPrice && mtype === 'صرف' && prev.qty > 0) {
        unitPrice = prev.val / prev.qty
      }

      const qtyIn  = mtype === 'اضافة' ? qty : 0
      const qtyOut = mtype === 'صرف'   ? qty : 0
      const valIn  = qtyIn  * unitPrice
      const valOut = qtyOut * unitPrice

      prev.qty += qtyIn - qtyOut
      prev.val += valIn - valOut

      const balQty = prev.qty
      const balVal = prev.val
      const d = new Date(date)

      return `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type, quantity, unit_price, qty_in, qty_out, value_in, value_out, balance_qty, balance_value, document_number, notes, year, month, created_by_user_id) VALUES (${COMPANY_ID}, ${itemCode}, ${esc(date)}, ${esc(wh)}, ${esc(mtype)}, ${qty}, ${unitPrice || 0}, ${qtyIn}, ${qtyOut}, ${valIn}, ${valOut}, ${balQty}, ${balVal}, ${esc(r.document_number ? Number(r.document_number) : null)}, ${esc(r.notes)}, ${d.getFullYear()}, ${d.getMonth()+1}, 1);`
    }).filter(Boolean).join('\n')

    if (sql) {
      process.stdout.write(`  ⬆  دفعة ${Math.floor(i/100)+1}…`)
      d1Execute(sql)
      console.log(' ✓')
    }
  }
  console.log('  ✅ تم استيراد حركات المخزون')
}

// ─── Entry point ─────────────────────────────────────────────
const cmd = process.argv[2] ?? 'help'

console.log('═══════════════════════════════════════════════════')
console.log('  Agri-Nile Flow — Excel Migration Tool')
console.log(`  Target DB: ${DB.database_name}  |  Company ID: ${COMPANY_ID}`)
console.log('═══════════════════════════════════════════════════')

switch (cmd) {
  case 'suppliers': await importSuppliers(); break
  case 'treasury':  await importTreasury();  break
  case 'inventory': await importInventory(); break
  case 'all':
    await importSuppliers()
    await importTreasury()
    await importInventory()
    break
  default:
    console.log(`
الاستخدام:
  node import.js suppliers   — استيراد الموردين + حركاتهم
  node import.js treasury    — استيراد الخزينة
  node import.js inventory   — استيراد المخزون
  node import.js all         — استيراد الكل

قبل التشغيل:
  1. ضع ملفات Excel في نفس مجلد migrate/
  2. عدّل config.js لمطابقة بنية ملفاتك
  3. npm install  (مرة واحدة)
    `)
}

console.log('\n🏁 انتهت عملية الاستيراد')
