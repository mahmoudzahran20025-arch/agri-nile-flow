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

function firstObject(arr) {
  return arr.find((x) => x && typeof x === 'object' && !Array.isArray(x));
}

function validateSource(rootDir, sourceCfg) {
  const fullPath = path.join(rootDir, sourceCfg.file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const data = JSON.parse(raw);

  const pathChecks = sourceCfg.requiredPaths.map((p) => {
    const value = getByPath(data, p);
    const exists = value !== undefined;
    const isArray = Array.isArray(value);
    const length = isArray ? value.length : null;
    return { path: p, exists, isArray, length };
  });

  const entityChecks = (sourceCfg.entities || []).map((entity) => {
    const arr = getByPath(data, entity.from);
    const okArray = Array.isArray(arr);
    const sample = okArray ? firstObject(arr) : null;
    const missingFields = [];

    if (sample) {
      for (const f of entity.requiredFields || []) {
        if (!(f in sample)) missingFields.push(f);
      }
    }

    return {
      entity: entity.name,
      from: entity.from,
      hasArray: okArray,
      rowCount: okArray ? arr.length : 0,
      missingRequiredFieldsInSample: missingFields,
      sampleKeys: sample ? Object.keys(sample) : [],
    };
  });

  const failures = [];
  for (const c of pathChecks) {
    if (!c.exists) failures.push(`Missing path: ${c.path}`);
    if (c.exists && !c.isArray) failures.push(`Path is not array: ${c.path}`);
    if (c.isArray && c.length === 0) failures.push(`Path is empty: ${c.path}`);
  }
  for (const e of entityChecks) {
    if (!e.hasArray) failures.push(`Entity source is not array: ${e.entity}`);
    if (e.rowCount === 0) failures.push(`Entity source empty: ${e.entity}`);
    if (e.missingRequiredFieldsInSample.length > 0) {
      failures.push(
        `Entity sample missing fields (${e.entity}): ${e.missingRequiredFieldsInSample.join(', ')}`
      );
    }
  }

  return {
    file: sourceCfg.file,
    domain: sourceCfg.domain,
    pathChecks,
    entityChecks,
    pass: failures.length === 0,
    failures,
  };
}

function main() {
  const rootDir = process.cwd();
  const contractPath = path.join(rootDir, 'config', 'canonical_source_contract.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

  const results = contract.sources.map((s) => validateSource(rootDir, s));
  const failed = results.filter((r) => !r.pass);

  const report = {
    generatedAt: new Date().toISOString(),
    contractVersion: contract.version,
    sourcesChecked: results.length,
    failedSources: failed.length,
    pass: failed.length === 0,
    results,
  };

  const outDir = path.join(rootDir, 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, 'phase2_contract_validation.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Wrote ${outPath}`);
  if (!report.pass) {
    console.error('Phase 2 contract validation failed.');
    process.exit(1);
  }

  console.log('Phase 2 contract validation passed.');
}

main();
