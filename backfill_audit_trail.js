const { execSync } = require('child_process');
const fs = require('fs');

const DB_NAME = 'agri-nile-flow-data-lake';

function runQuery(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${compact}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(out)[0].results;
}

async function backfillTrace() {
  console.log('Fetching Journal Entries with trace data...');
  
  const entries = runQuery(`
    SELECT id, company_id, entry_date, posting_rule_trace 
    FROM journal_entries 
    WHERE posting_rule_trace IS NOT NULL AND company_id = 1
  `);

  console.log(`Processing ${entries.length} entries...`);

  let statements = [];
  entries.forEach(je => {
    try {
      const trace = JSON.parse(je.posting_rule_trace);
      if (!trace.eventId) return;

      // Map rebuild v2 trace to trace log schema
      // Trace example: {"rebuild":"v2","eventId":412,"eventType":"inventory_movement"}
      
      const id = `TRACE_${je.id}`;
      const businessEventType = trace.eventType || 'unknown';
      const sourceRecordId = trace.eventId; // In our rebuild scripts, eventId was the source record ID
      const sourceModule = je.id < 500 ? (businessEventType.includes('inventory') ? 'inventory' : 'suppliers') : 'unknown'; // Rough heuristic
      
      // Better: resolve from eventId
      // We don't have all details in the trace, but we can fulfill mandatory fields
      
      statements.push(`INSERT OR IGNORE INTO posting_trace_log (
        id, company_id, business_event_type, source_record_id, source_module, 
        source_timestamp, journal_entry_id, posting_rule_id, posting_timestamp,
        classification, engine_version, is_traced
      ) VALUES (
        '${id}', ${je.company_id}, '${businessEventType}', ${sourceRecordId}, 
        '${businessEventType.split('_')[0]}', '${je.entry_date}', ${je.id}, 
        'REBUILD_V2', datetime('now'), 'RESEED_POSTING', 'v2.1', 1
      );`);
    } catch (e) {
      console.warn(`Failed to parse trace for JE ${je.id}`);
    }
  });

  if (statements.length === 0) {
    console.log('No traces to backfill.');
    return;
  }

  const chunkSize = 100;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    const sql = chunk.join('\n');
    fs.writeFileSync('temp_trace.sql', sql);
    console.log(`Executing chunk ${i / chunkSize + 1}...`);
    execSync(`npx wrangler d1 execute ${DB_NAME} --remote --yes --file temp_trace.sql`, { stdio: 'inherit' });
  }

  fs.unlinkSync('temp_trace.sql');
  console.log('Audit trail backfill complete.');
}

backfillTrace();
