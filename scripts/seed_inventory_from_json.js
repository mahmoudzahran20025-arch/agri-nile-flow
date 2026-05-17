/**
 * seed_inventory_from_json.js
 * ============================
 * يقرأ البيانات من مخازن_نواة_المستقبل_2025-2026.json
 * ويدخلها عبر الـ API بالترتيب الصحيح (اضافة أولاً ثم صرف)
 *
 * الاستخدام:
 *   $env:API_TOKEN = "your_jwt_token"
 *   node scripts/seed_inventory_from_json.js
 *
 * الخيارات:
 *   --dry-run       معاينة فقط بدون إدخال
 *   --limit 50      حدد عدد المعاملات للاختبار
 *   --type GRN      أدخل نوع واحد فقط (GRN أو ISSUE)
 *
 * مثال اختبار:
 *   node scripts/seed_inventory_from_json.js --dry-run --limit 10
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Config ─────────────────────────────────────────────────────────
const BASE_URL = 'https://agri-nile-flow.mahm-zahran22.workers.dev'
const TOKEN    = process.env.API_TOKEN ?? ''

const args    = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT   = (() => { const i = args.indexOf('--limit'); return i !== -1 ? Number(args[i + 1]) : Infinity })()
const TYPE_FILTER = (() => { const i = args.indexOf('--type'); return i !== -1 ? args[i + 1] : null })()
// BATCH_SIZE: عدد الأصناف في كل batch request (group بنفس document_number + movement_type + date + warehouse)
const BATCH_SIZE = 50

if (!TOKEN && !DRY_RUN) {
  console.error('❌  Set API_TOKEN env var to a valid JWT before running.')
  console.error('    $env:API_TOKEN = "your_token_here"')
  process.exit(1)
}

// ── Load JSON ──────────────────────────────────────────────────────
const jsonPath = resolve(__dirname, '../مخازن_نواة_المستقبل_2025-2026.json')
const raw      = JSON.parse(readFileSync(jsonPath, 'utf8'))
const allTx    = raw['البيانات_الرئيسية']['المعاملات']

console.log(`📦  Loaded ${allTx.length} transactions from JSON`)

// ── Type mapping: Arabic → typed code ─────────────────────────────
function mapMovementType(arabic) {
  const map = { 'اضافة': 'GRN', 'صرف': 'ISSUE' }
  const code = map[arabic?.trim()]
  if (!code) {
    console.warn(`⚠️  Unknown movement type: "${arabic}" — defaulting to GRN`)
    return 'GRN'
  }
  return code
}

// ── Date normalization ─────────────────────────────────────────────
function normalizeDate(rawDate) {
  // "2025-12-05 00:00:00" → "2025-12-05"
  if (!rawDate) return null
  return String(rawDate).slice(0, 10)
}

// ── Filter and sort ────────────────────────────────────────────────
let filtered = allTx
  .filter(tx => tx['كود الصنف'] && tx['الكمية'] && tx['التاريخ'])
  .map(tx => ({
    date:          normalizeDate(tx['التاريخ']),
    warehouse:     tx['المخزن'] ?? '',
    movement_type: mapMovementType(tx['النوع']),
    doc_number:    tx['رقم المستند'] ? Number(tx['رقم المستند']) : undefined,
    supplier_code: tx['كود المورد'] ? Number(tx['كود المورد']) : undefined,
    center_code:   tx['كود مركز التكلفة'] ? Number(tx['كود مركز التكلفة']) : undefined,
    item_code:     Number(tx['كود الصنف']),
    quantity:      Math.abs(Number(tx['الكمية'])),
    unit_price:    (() => {
      const qty = Math.abs(Number(tx['الكمية']))
      if (!qty) return undefined
      const val = tx['قيمة الوارد'] || tx['قيمة المنصرف'] || 0
      return val > 0 ? Number(val) / qty : undefined
    })(),
    notes:         tx['ملاحظات'] ?? undefined,
  }))
  .filter(tx => tx.quantity > 0 && tx.date && tx.warehouse)

// Sort: GRN first (أهم لضمان الرصيد قبل الصرف), then ISSUE, chronological within each
filtered.sort((a, b) => {
  const typeOrder = { GRN: 0, ISSUE: 1 }
  const typeA = typeOrder[a.movement_type] ?? 2
  const typeB = typeOrder[b.movement_type] ?? 2
  if (typeA !== typeB) return typeA - typeB
  return a.date.localeCompare(b.date)
})

if (TYPE_FILTER) {
  filtered = filtered.filter(tx => tx.movement_type === TYPE_FILTER.toUpperCase())
}
if (LIMIT < Infinity) {
  filtered = filtered.slice(0, LIMIT)
}

console.log(`📊  After filter/sort: ${filtered.length} transactions to process`)
console.log(`    GRN:   ${filtered.filter(t => t.movement_type === 'GRN').length}`)
console.log(`    ISSUE: ${filtered.filter(t => t.movement_type === 'ISSUE').length}`)
if (DRY_RUN) {
  console.log('\n🔍  DRY RUN — first 5 transactions:')
  filtered.slice(0, 5).forEach((tx, i) => {
    console.log(`  [${i+1}] ${tx.movement_type} | ${tx.date} | ${tx.warehouse} | item:${tx.item_code} | qty:${tx.quantity} | price:${tx.unit_price ?? 'N/A'} | doc:${tx.doc_number ?? '-'} | supplier:${tx.supplier_code ?? '-'} | center:${tx.center_code ?? '-'}`)
  })
  console.log('\n✅  Dry run complete. Remove --dry-run to execute.')
  process.exit(0)
}

// ── Group into batches by: date + warehouse + movement_type + doc_number ──
function groupIntoBatches(txList) {
  const groups = new Map()
  for (const tx of txList) {
    const key = `${tx.date}|${tx.warehouse}|${tx.movement_type}|${tx.doc_number ?? 'nodoc'}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(tx)
  }
  return groups
}

// ── API call: POST /api/inventory/movements/batch ──────────────────
async function postBatch(group, items) {
  const [date, warehouse, movement_type, _doc] = group.split('|')
  const firstItem = items[0]
  const body = {
    movement_date:   date,
    warehouse:       warehouse,
    movement_type:   movement_type,
    supplier_code:   firstItem.supplier_code,
    center_code:     firstItem.center_code,
    document_number: firstItem.doc_number,
    notes:           firstItem.notes,
    items: items.map(tx => ({
      item_code:  tx.item_code,
      quantity:   tx.quantity,
      unit_price: tx.unit_price,
      notes:      tx.notes,
    }))
  }

  const res = await fetch(`${BASE_URL}/api/inventory/movements/batch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body:    JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, body: json }
}

// ── Main execution ─────────────────────────────────────────────────
async function main() {
  // GRN first pass — all additions
  const grnList   = filtered.filter(t => t.movement_type === 'GRN')
  const issueList = filtered.filter(t => t.movement_type === 'ISSUE')

  console.log(`\n🚀  Starting seed import (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`)
  console.log(`    Mode: GRN first → ISSUE second`)
  console.log(`    Base URL: ${BASE_URL}\n`)

  let successCount = 0
  let failCount    = 0
  const errors     = []

  // ── PASS 1: GRN ────────────────────────────────────────────────
  console.log(`\n📥  PASS 1 — GRN (${grnList.length} transactions)`)
  const grnGroups = groupIntoBatches(grnList)
  let gIdx = 0
  for (const [groupKey, items] of grnGroups.entries()) {
    gIdx++
    // chunk to BATCH_SIZE
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const chunk = items.slice(start, start + BATCH_SIZE)
      const { status, ok, body } = await postBatch(groupKey, chunk)
      if (ok && body.success) {
        successCount += chunk.length
        process.stdout.write(`  ✓ [${gIdx}/${grnGroups.size}] doc:${chunk[0].doc_number ?? '-'} date:${chunk[0].date} wh:${chunk[0].warehouse} items:${chunk.length}\n`)
      } else if (status === 409 || body.code === 'DUPLICATE_DOCUMENT') {
        // Already imported — skip silently (idempotent re-run)
        process.stdout.write(`  ⏭  [${gIdx}/${grnGroups.size}] SKIP (duplicate) doc:${chunk[0].doc_number ?? '-'} wh:${chunk[0].warehouse}\n`)
      } else {
        failCount += chunk.length
        const errMsg = body.error ?? `HTTP ${status}`
        errors.push({ groupKey, chunk: chunk.length, error: errMsg })
        console.error(`  ✗ [${gIdx}/${grnGroups.size}] FAILED — ${errMsg}`)
        if (errMsg.includes('فترة مالية') || errMsg.includes('PERIOD')) {
          console.error(`    ⚠️  Period blocker! Run this SQL first:`)
          console.error(`    UPDATE financial_periods SET status='open' WHERE start_date<='${chunk[0].date}' AND end_date>='${chunk[0].date}';`)
        }
      }
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 50))
  }

  // ── PASS 2: ISSUE ──────────────────────────────────────────────
  console.log(`\n📤  PASS 2 — ISSUE (${issueList.length} transactions)`)
  const issueGroups = groupIntoBatches(issueList)
  let iIdx = 0
  for (const [groupKey, items] of issueGroups.entries()) {
    iIdx++
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const chunk = items.slice(start, start + BATCH_SIZE)
      const { status, ok, body } = await postBatch(groupKey, chunk)
      if (ok && body.success) {
        successCount += chunk.length
        process.stdout.write(`  ✓ [${iIdx}/${issueGroups.size}] doc:${chunk[0].doc_number ?? '-'} date:${chunk[0].date} wh:${chunk[0].warehouse} items:${chunk.length}\n`)
      } else if (status === 409 || body.code === 'DUPLICATE_DOCUMENT') {
        process.stdout.write(`  ⏭  [${iIdx}/${issueGroups.size}] SKIP (duplicate) doc:${chunk[0].doc_number ?? '-'} wh:${chunk[0].warehouse}\n`)
      } else {
        failCount += chunk.length
        const errMsg = body.error ?? `HTTP ${status}`
        errors.push({ groupKey, chunk: chunk.length, error: errMsg })
        console.error(`  ✗ [${iIdx}/${issueGroups.size}] FAILED — ${errMsg}`)
        if (errMsg.includes('INSUFFICIENT_STOCK')) {
          console.error(`    ⚠️  Stock check failure — this ISSUE has no prior GRN or wrong warehouse`)
        }
      }
    }
    await new Promise(r => setTimeout(r, 50))
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log(`✅  Seed complete`)
  console.log(`    Succeeded: ${successCount} line items`)
  console.log(`    Failed:    ${failCount} line items`)
  if (errors.length > 0) {
    console.log(`\n⚠️  Failures (${errors.length}):`)
    errors.forEach(e => console.log(`    ${e.groupKey} (${e.chunk} items): ${e.error}`))
  }
  console.log('\n📋  Next steps:')
  console.log('    1. Trigger outbox: POST /api/inventory/posting-outbox/process')
  console.log('    2. Verify: run the health check queries')
}

main().catch(err => {
  console.error('❌  Fatal error:', err)
  process.exit(1)
})
