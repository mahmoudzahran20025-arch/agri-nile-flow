'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DB_NAME = 'agri-nile-flow-data-lake';
const BASE = __dirname;

// Reverse double-UTF-8 encoding: bytes were UTF-8 Arabic, misread as Latin-1, then re-encoded as UTF-8
function fix(s) {
  return Buffer.from(s, 'latin1').toString('utf8');
}

const corrupted = [
  { code: 20300086,  name: "Ø¹ÙŠØ¯ Ø´Ø¹Ø¨Ø§Ù†-Ù„ÙˆØ¯Ø±",                                                     activity: "Ù…ÙˆØ±Ø¯ÙŠÙ† Ø£Ù„Ø§Øª ÙˆÙ…Ø¹Ø¯Ø§Øª" },
  { code: 20900151,  name: "Ø¬Ù‡Ø§Ø² Ù…Ø³ØªÙ‚Ø¨Ù„ Ù…ØµØ± Ù„Ù„ØªÙ†Ù…ÙŠØ© Ø§Ù„Ù…Ø³ØªØ¯Ø§Ù…Ø©",                    activity: "Ù…ÙˆØ±Ø¯ÙŠÙ† Ù…Ù†ØªØ¬Ø§Øª Ø²Ø±Ø§Ø¹ÙŠØ©" },
  { code: 20900353,  name: "Ø´Ø±ÙƒØ© Ø¹Ø±ÙØ© Ù„Ù„ØªØµØ¯ÙŠØ± ÙˆØ§Ù„ØªÙ†Ù…ÙŠØ© Ø§Ù„Ø²Ø±Ø§Ø¹ÙŠØ© ÙˆØ§Ø³ØªØµÙ„Ø§Ø Ø§Ù„Ø§Ø±Ø§Ø¶ÙŠ", activity: "Ù…ÙˆØ±Ø¯ÙŠÙ† Ù…Ù†ØªØ¬Ø§Øª Ø²Ø±Ø§Ø¹ÙŠØ©" },
  { code: 21400002,  name: "Ø§ØÙ…Ø¯ Ø¯Ø³ÙˆÙ‚ÙŠ-Ø¹Ù…Ø§Ù„Ø©",                                               activity: "Ù…ÙˆØ±Ø¯ÙŠÙ† Ø¹Ù…Ø§Ù„Ø©" },
  { code: 20100033,  name: "Ø¹Ù…Ø±Ùˆ Ø§Ù„Ø³Ù…Ø§Ù„ÙˆØ³ÙŠ - Ù„ÙˆØ¯Ø±",                                        activity: "Ù…ÙˆØ±Ø¯ÙŠÙ† Ø£Ù„Ø§Øª ÙˆÙ…Ø¹Ø¯Ø§Øª" },
  { code: 21400108,  name: "Ø§Ø¨Ø±Ø§Ù‡ÙŠÙ… Ø±Ù…Ø¶Ø§Ù† Ø§Ù„ÙƒÙŠÙ„Ø§ÙˆÙŠ",                                      activity: "Ù…ÙˆØ±Ø¯ÙŠÙ† Ø¹Ù…Ø§Ù„Ø©" },
  { code: 10100192,  name: "Ø¹Ù…ÙŠÙ„ Ù†Ù‚Ø¯Ù‰",                                                           activity: "Ø¹Ù…Ù„Ø§Ø¡ Ù…ØÙ„ÙŠÙˆÙ†" },
  { code: 35300902,  name: "Ø´Ø±ÙƒØ© Ø¹Ø±ÙØ© Ù„Ù„ØªØµØ¯ÙŠØ± ÙˆØ§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯ ÙˆØ§Ù„ØªÙˆØ±ÙŠØ¯Ø§Øª",            activity: "Ù…ÙˆØ±Ø¯ÙŠÙ† Ù…ØªÙ†ÙˆØ¹Ø§Øª" },
];

// Show preview first
console.log('Encoding fix preview:');
corrupted.forEach(r => {
  const fixedName = fix(r.name);
  const fixedAct  = fix(r.activity);
  console.log(`  [${r.code}] ${r.name.substring(0,12)}… → ${fixedName.substring(0,20)}`);
});

// Generate SQL
const lines = corrupted.map(r => {
  const fixedName = fix(r.name).replace(/'/g, "''");
  const fixedAct  = fix(r.activity).replace(/'/g, "''");
  return `UPDATE suppliers SET name='${fixedName}', activity='${fixedAct}' WHERE code=${r.code} AND company_id=1;`;
});

const sqlPath = path.join(BASE, 'fix_supplier_enc.sql');
fs.writeFileSync(sqlPath, lines.join('\n') + '\n', 'utf8');
console.log(`\nSQL written to ${sqlPath}`);

// Execute
console.log('Executing...');
execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file "${sqlPath}" --yes`, {
  cwd: BASE, encoding: 'utf8', stdio: 'inherit', timeout: 60000
});
console.log('Done. Verifying...');

// Verify
const out = execSync(
  `npx wrangler d1 execute ${DB_NAME} --remote --json --command "SELECT COUNT(*) as bad FROM suppliers WHERE company_id=1 AND hex(substr(name,1,1))='C398'"`,
  { cwd: BASE, encoding: 'utf8', timeout: 30000 }
);
const bad = JSON.parse(out)[0]?.results[0]?.bad ?? '?';
console.log(`Remaining corrupted supplier names: ${bad}`);

// Show fixed names
const out2 = execSync(
  `npx wrangler d1 execute ${DB_NAME} --remote --json --command "SELECT code, name FROM suppliers WHERE company_id=1 ORDER BY code"`,
  { cwd: BASE, encoding: 'utf8', timeout: 30000 }
);
const rows = JSON.parse(out2)[0]?.results || [];
console.log('\nAll supplier names now:');
rows.forEach(r => console.log(`  [${r.code}] ${r.name}`));
