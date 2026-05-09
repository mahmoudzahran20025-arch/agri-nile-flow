#!/usr/bin/env node
const { execSync } = require('child_process');

const DB_NAME = 'agri-nile-flow-data-lake';

function run(sql, label) {
  const compact = sql.replace(/\s+/g, ' ').trim();
  const escaped = compact.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escaped}"`;
  console.log(`\n[RUN] ${label}`);
  execSync(cmd, { stdio: 'inherit', maxBuffer: 50 * 1024 * 1024 });
}

function main() {
  const dropTrigger = `
    DROP TRIGGER IF EXISTS trg_gl_prevent_posted_line_update;
  `;

  const recreateTrigger = `
    CREATE TRIGGER trg_gl_prevent_posted_line_update
    BEFORE UPDATE ON journal_entry_lines
    WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1
    BEGIN
      SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot modify lines of a posted journal entry. Use reversal instead.');
    END;
  `;

  const enrichDescriptions = `
    UPDATE journal_entries
    SET description = (
      SELECT 'Inventory #' || im.id || ' ' || COALESCE(im.movement_type, '-') ||
             ' | Item ' || COALESCE(CAST(im.item_code AS TEXT), '-') ||
             ' ' || COALESCE(it.name, '') ||
             ' | WH ' || COALESCE(im.warehouse, '-')
      FROM inventory_movements im
      LEFT JOIN items it ON it.company_id = im.company_id AND it.code = im.item_code
      WHERE im.company_id = journal_entries.company_id AND im.id = journal_entries.ref_id
    )
    WHERE company_id = 1 AND ref_type = 'inventory_movement' AND ref_id IS NOT NULL;

    UPDATE journal_entries
    SET description = (
      SELECT 'Supplier #' || st.id || ' | Supplier ' || COALESCE(CAST(st.supplier_code AS TEXT), '-') ||
             ' | Doc ' || COALESCE(CAST(st.document_number AS TEXT), '-')
      FROM supplier_transactions st
      WHERE st.company_id = journal_entries.company_id AND st.id = journal_entries.ref_id
    )
    WHERE company_id = 1 AND ref_type = 'supplier_transaction' AND ref_id IS NOT NULL;

    UPDATE journal_entries
    SET description = (
      SELECT 'Cash #' || ct.id || ' | Dir ' || COALESCE(ct.direction, '-') ||
             ' | Doc ' || COALESCE(CAST(ct.document_number AS TEXT), '-')
      FROM cash_transactions ct
      WHERE ct.company_id = journal_entries.company_id AND ct.id = journal_entries.ref_id
    )
    WHERE company_id = 1 AND ref_type = 'cash_transaction' AND ref_id IS NOT NULL;

    UPDATE journal_entry_lines
    SET description = (SELECT je.description FROM journal_entries je WHERE je.id = journal_entry_lines.entry_id)
    WHERE company_id = 1;
  `;

  const propagateCenters = `
    UPDATE journal_entry_lines
    SET center_code = (
      SELECT im.center_code
      FROM journal_entries je
      JOIN inventory_movements im ON im.company_id = je.company_id AND im.id = je.ref_id
      WHERE je.id = journal_entry_lines.entry_id AND je.ref_type = 'inventory_movement'
      LIMIT 1
    )
    WHERE company_id = 1
      AND center_code IS NULL
      AND entry_id IN (
        SELECT je.id
        FROM journal_entries je
        JOIN inventory_movements im ON im.company_id = je.company_id AND im.id = je.ref_id
        WHERE je.company_id = 1 AND je.ref_type = 'inventory_movement' AND im.center_code IS NOT NULL
      );

    UPDATE journal_entry_lines
    SET center_code = (
      SELECT ct.center_code
      FROM journal_entries je
      JOIN cash_transactions ct ON ct.company_id = je.company_id AND ct.id = je.ref_id
      WHERE je.id = journal_entry_lines.entry_id AND je.ref_type = 'cash_transaction'
      LIMIT 1
    )
    WHERE company_id = 1
      AND center_code IS NULL
      AND entry_id IN (
        SELECT je.id
        FROM journal_entries je
        JOIN cash_transactions ct ON ct.company_id = je.company_id AND ct.id = je.ref_id
        WHERE je.company_id = 1 AND je.ref_type = 'cash_transaction' AND ct.center_code IS NOT NULL
      );

    UPDATE journal_entry_lines
    SET center_code = (
      SELECT st.center_code
      FROM journal_entries je
      JOIN supplier_transactions st ON st.company_id = je.company_id AND st.id = je.ref_id
      WHERE je.id = journal_entry_lines.entry_id AND je.ref_type = 'supplier_transaction'
      LIMIT 1
    )
    WHERE company_id = 1
      AND center_code IS NULL
      AND entry_id IN (
        SELECT je.id
        FROM journal_entries je
        JOIN supplier_transactions st ON st.company_id = je.company_id AND st.id = je.ref_id
        WHERE je.company_id = 1 AND je.ref_type = 'supplier_transaction' AND st.center_code IS NOT NULL
      );
  `;

  const createTraceability = `
    INSERT INTO business_events (
      company_id, event_type, event_date, source_module, source_id,
      payload, status, journal_entry_id, posted_at, created_at
    )
    SELECT
      je.company_id,
      CASE je.ref_type
        WHEN 'inventory_movement' THEN 'INVENTORY_POSTED'
        WHEN 'supplier_transaction' THEN 'SUPPLIER_POSTED'
        WHEN 'cash_transaction' THEN 'CASH_POSTED'
        ELSE 'GL_POSTED'
      END,
      je.entry_date,
      je.ref_type,
      je.ref_id,
      json_object('journal_entry_id', je.id, 'ref_type', je.ref_type, 'ref_id', je.ref_id, 'description', je.description),
      'posted',
      je.id,
      je.created_at,
      datetime('now')
    FROM journal_entries je
    WHERE je.company_id = 1
      AND je.ref_type IN ('inventory_movement', 'supplier_transaction', 'cash_transaction')
      AND je.ref_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM business_events be
        WHERE be.company_id = je.company_id
          AND be.source_module = je.ref_type
          AND be.source_id = je.ref_id
          AND be.event_type = CASE je.ref_type
            WHEN 'inventory_movement' THEN 'INVENTORY_POSTED'
            WHEN 'supplier_transaction' THEN 'SUPPLIER_POSTED'
            WHEN 'cash_transaction' THEN 'CASH_POSTED'
            ELSE 'GL_POSTED'
          END
      );

    INSERT INTO source_documents (
      company_id, source_module, source_id, document_type, event_id,
      event_date, status, payload_snapshot, created_at, updated_at
    )
    SELECT
      je.company_id,
      je.ref_type,
      CAST(je.ref_id AS TEXT),
      je.ref_type,
      (SELECT be.id FROM business_events be
        WHERE be.company_id = je.company_id AND be.source_module = je.ref_type AND be.source_id = je.ref_id
        ORDER BY be.id DESC LIMIT 1),
      je.entry_date,
      'posted',
      json_object('journal_entry_id', je.id, 'description', je.description, 'ref_type', je.ref_type, 'ref_id', je.ref_id),
      datetime('now'),
      datetime('now')
    FROM journal_entries je
    WHERE je.company_id = 1
      AND je.ref_type IN ('inventory_movement', 'supplier_transaction', 'cash_transaction')
      AND je.ref_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM source_documents sd
        WHERE sd.company_id = je.company_id
          AND sd.source_module = je.ref_type
          AND sd.source_id = CAST(je.ref_id AS TEXT)
          AND sd.document_type = je.ref_type
      );

    INSERT INTO source_document_links (company_id, source_document_id, journal_entry_id, link_type, created_at)
    SELECT
      je.company_id,
      sd.id,
      je.id,
      'primary',
      datetime('now')
    FROM journal_entries je
    JOIN source_documents sd
      ON sd.company_id = je.company_id
     AND sd.source_module = je.ref_type
     AND sd.source_id = CAST(je.ref_id AS TEXT)
     AND sd.document_type = je.ref_type
    WHERE je.company_id = 1
      AND je.ref_type IN ('inventory_movement', 'supplier_transaction', 'cash_transaction')
      AND je.ref_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM source_document_links sdl
        WHERE sdl.company_id = je.company_id
          AND sdl.source_document_id = sd.id
          AND sdl.journal_entry_id = je.id
          AND sdl.link_type = 'primary'
      );
  `;

  try {
    run(dropTrigger, 'Drop posted-line update trigger (temporary)');
    run(enrichDescriptions, 'Enrich journal entry and line descriptions');
    run(propagateCenters, 'Propagate center_code into posted lines');
    run(createTraceability, 'Create business events and source document bridges');
  } finally {
    run(recreateTrigger, 'Recreate posted-line update trigger');
  }

  console.log('\nRemediation complete.');
}

main();
