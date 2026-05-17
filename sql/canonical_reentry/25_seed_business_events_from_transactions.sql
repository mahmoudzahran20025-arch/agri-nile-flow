-- Phase 3.5 — Seed business_events for all canonical transactions that lack them
-- This is required so the posting job can emit journal entries.
-- Safe to re-run: uses INSERT OR IGNORE (no duplicates on source_module+source_id+company_id)

-- supplier_transactions → source_module='suppliers'
INSERT OR IGNORE INTO business_events
  (company_id, event_type, event_date, source_module, source_id, payload, status, created_at)
SELECT
  st.company_id,
  CASE
    WHEN TRIM(COALESCE(st.entry_type,'')) = 'م' THEN 'supplier_payment_posted'
    ELSE 'supplier_transaction_posted'
  END,
  st.transaction_date,
  'suppliers',
  st.id,
  '{"migration":"phase3_canonical_reload"}',
  'pending',
  datetime('now')
FROM supplier_transactions st
WHERE st.company_id = 1
  AND st.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM business_events be
    WHERE be.company_id = st.company_id
      AND be.source_module = 'suppliers'
      AND be.source_id = st.id
  );

-- cash_transactions → source_module='cash'
INSERT OR IGNORE INTO business_events
  (company_id, event_type, event_date, source_module, source_id, payload, status, created_at)
SELECT
  ct.company_id,
  CASE
    WHEN TRIM(COALESCE(ct.direction, ct.entry_type,'')) = 'د' THEN 'cash_receipt_posted'
    ELSE 'cash_payment_posted'
  END,
  ct.transaction_date,
  'cash',
  ct.id,
  '{"migration":"phase3_canonical_reload"}',
  'pending',
  datetime('now')
FROM cash_transactions ct
WHERE ct.company_id = 1
  AND ct.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM business_events be
    WHERE be.company_id = ct.company_id
      AND be.source_module = 'cash'
      AND be.source_id = ct.id
  );

-- inventory_movements → source_module='inventory' (GRN and ISSUE only)
INSERT OR IGNORE INTO business_events
  (company_id, event_type, event_date, source_module, source_id, payload, status, created_at)
SELECT
  im.company_id,
  CASE im.movement_type
    WHEN 'GRN'   THEN 'inventory_grn_posted'
    WHEN 'ISSUE' THEN 'inventory_issue_posted'
    ELSE 'inventory_movement_posted'
  END,
  im.movement_date,
  'inventory',
  im.id,
  '{"migration":"phase3_canonical_reload"}',
  'pending',
  datetime('now')
FROM inventory_movements im
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND im.movement_type IN ('GRN','ISSUE')
  AND NOT EXISTS (
    SELECT 1 FROM business_events be
    WHERE be.company_id = im.company_id
      AND be.source_module = 'inventory'
      AND be.source_id = im.id
  );

-- Verification
SELECT 'business_events_total' AS metric, COUNT(*) AS cnt FROM business_events WHERE company_id = 1;
SELECT 'events_pending' AS metric, COUNT(*) AS cnt FROM business_events WHERE company_id = 1 AND status = 'pending';
SELECT source_module, COUNT(*) AS cnt FROM business_events WHERE company_id = 1 GROUP BY source_module;
