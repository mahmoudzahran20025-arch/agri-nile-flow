const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SOURCES = [
  'شجرة_نواة_المستقبل.json',
  'نواة_المستقبل_2025-2026.json',
  'خزينة_نواة_المستقبل_2025-2026.json',
  'مخازن_نواة_المستقبل_2025-2026.json',
];

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function summarizeArray(arr) {
  const firstObject = arr.find((item) => isObject(item));
  return {
    type: 'array',
    length: arr.length,
    sampleKeys: firstObject ? Object.keys(firstObject) : [],
  };
}

function summarizeObject(obj) {
  const entries = Object.entries(obj);
  const childKeys = entries.map(([k]) => k);
  const childKinds = {};

  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      childKinds[key] = summarizeArray(value);
    } else if (isObject(value)) {
      childKinds[key] = {
        type: 'object',
        keys: Object.keys(value),
      };
    } else {
      childKinds[key] = {
        type: typeof value,
      };
    }
  }

  return {
    type: 'object',
    keys: childKeys,
    children: childKinds,
  };
}

function profileFile(fileName) {
  const fullPath = path.join(ROOT, fileName);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const data = JSON.parse(raw);

  const topLevel = summarizeObject(data);
  return {
    fileName,
    sizeBytes: Buffer.byteLength(raw, 'utf8'),
    topLevel,
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const profiles = SOURCES.map(profileFile);

  const output = {
    generatedAt: startedAt,
    sourceCount: SOURCES.length,
    sources: profiles,
  };

  const outDir = path.join(ROOT, 'reports');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'phase2_source_profile.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${outPath}`);
}

main();
