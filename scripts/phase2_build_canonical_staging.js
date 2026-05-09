const fs = require('fs');
const path = require('path');

function getByPath(obj, dottedPath) {
  const parts = dottedPath.split('.');
  let current = obj;
  for (const p of parts) {
    if (current == null || !(p in current)) return undefined;
    current = current[p];
  }
  return current;
}

function normalizeValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    return trimmed;
  }
  return value;
}

function mapRow(row, fieldMap) {
  const out = {};
  for (const [target, source] of Object.entries(fieldMap)) {
    out[target] = normalizeValue(row[source]);
  }
  return out;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function main() {
  const root = process.cwd();
  const contractPath = path.join(root, 'config', 'canonical_source_contract.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

  const outDir = path.join(root, 'staging', 'canonical');
  ensureDir(outDir);

  const index = {
    generatedAt: new Date().toISOString(),
    contractVersion: contract.version,
    outputs: [],
  };

  for (const src of contract.sources) {
    const filePath = path.join(root, src.file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    for (const entity of src.entities || []) {
      const arr = getByPath(data, entity.from);
      if (!Array.isArray(arr)) {
        throw new Error(`Expected array at ${src.file}:${entity.from}`);
      }

      const mapped = arr.map((row) => mapRow(row, entity.fieldMap || {}));
      const outName = `${src.domain}__${entity.name}.json`;
      const outPath = path.join(outDir, outName);
      fs.writeFileSync(
        outPath,
        JSON.stringify(
          {
            domain: src.domain,
            entity: entity.name,
            sourceFile: src.file,
            sourcePath: entity.from,
            rowCount: mapped.length,
            rows: mapped,
          },
          null,
          2
        ),
        'utf8'
      );

      index.outputs.push({
        domain: src.domain,
        entity: entity.name,
        file: path.relative(root, outPath).replace(/\\/g, '/'),
        rowCount: mapped.length,
      });
    }
  }

  const indexPath = path.join(outDir, '_index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');

  console.log(`Wrote canonical staging to ${outDir}`);
  console.log(`Index: ${indexPath}`);
}

main();
