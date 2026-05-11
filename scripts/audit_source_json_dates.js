const fs = require('fs');
const path = require('path');

const files = [
  'شجرة_نواة_المستقبل.json',
  'خزينة_نواة_المستقبل_2025-2026.json',
  'مخازن_نواة_المستقبل_2025-2026.json',
  'نواة_المستقبل_2025-2026.json',
];

const dateKeys = new Set([
  'transaction_date',
  'movement_date',
  'document_date',
  'due_date',
  'date',
  'movementdate',
  'transactiondate',
  'التاريخ',
  'تاريخ',
  'تاريخ الحركة',
  'تاريخ المعاملة',
  'تاريخ المستند',
]);

const today = new Date().toISOString().slice(0, 10);

function normalizeDate(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}

function walk(node, keyHint, acc) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, keyHint, acc);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      walk(v, k, acc);
    }
    return;
  }
  const d = normalizeDate(node);
  if (d) {
    acc.allDates.push(d);
    const keyRaw = String(keyHint || '').trim();
    const keyLower = keyRaw.toLowerCase();
    if (dateKeys.has(keyLower) || dateKeys.has(keyRaw)) {
      acc.targetDates.push(d);
    }
  }
}

for (const rel of files) {
  const full = path.join(process.cwd(), rel);
  if (!fs.existsSync(full)) {
    console.log(JSON.stringify({ file: rel, error: 'NOT_FOUND' }));
    continue;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    console.log(JSON.stringify({ file: rel, error: 'JSON_PARSE_ERROR', detail: String(err.message || err) }));
    continue;
  }

  const acc = { allDates: [], targetDates: [] };
  walk(parsed, null, acc);

  const use = acc.targetDates.length > 0 ? acc.targetDates : acc.allDates;
  use.sort();

  const minDate = use.length ? use[0] : null;
  const maxDate = use.length ? use[use.length - 1] : null;
  const futureCount = use.filter((d) => d > today).length;

  console.log(
    JSON.stringify({
      file: rel,
      source: acc.targetDates.length > 0 ? 'target_date_keys' : 'all_date_strings',
      count: use.length,
      minDate,
      maxDate,
      futureCount,
      today,
    })
  );
}
