-- 0096_gl_module_views.sql
-- Purpose: canonical module-specific GL views without hardcoded company_id.

DROP VIEW IF EXISTS vw_supplier_entries;
DROP VIEW IF EXISTS vw_inventory_entries;
DROP VIEW IF EXISTS vw_cash_entries;

CREATE VIEW vw_supplier_entries AS
SELECT je.*
FROM journal_entries je
WHERE je.ref_type = 'supplier_transaction'
   OR EXISTS (
     SELECT 1
     FROM journal_entry_lines jl
     WHERE jl.entry_id = je.id
       AND jl.company_id = je.company_id
       AND jl.source_ledger = 'supplier'
   )
   OR (
     je.ref_type = 'business_event'
     AND EXISTS (
       SELECT 1
       FROM business_events be
       WHERE be.id = je.ref_id
         AND be.company_id = je.company_id
         AND LOWER(COALESCE(be.source_module, '')) IN ('supplier', 'suppliers')
     )
   );

CREATE VIEW vw_inventory_entries AS
SELECT je.*
FROM journal_entries je
WHERE je.ref_type = 'inventory_movement'
   OR EXISTS (
     SELECT 1
     FROM journal_entry_lines jl
     WHERE jl.entry_id = je.id
       AND jl.company_id = je.company_id
       AND jl.source_ledger = 'inventory'
   )
   OR (
     je.ref_type = 'business_event'
     AND EXISTS (
       SELECT 1
       FROM business_events be
       WHERE be.id = je.ref_id
         AND be.company_id = je.company_id
         AND LOWER(COALESCE(be.source_module, '')) IN ('inventory', 'inventory_movement')
     )
   );

CREATE VIEW vw_cash_entries AS
SELECT je.*
FROM journal_entries je
WHERE je.ref_type = 'cash_transaction'
   OR EXISTS (
     SELECT 1
     FROM journal_entry_lines jl
     WHERE jl.entry_id = je.id
       AND jl.company_id = je.company_id
       AND jl.source_ledger = 'cash'
   )
   OR (
     je.ref_type = 'business_event'
     AND EXISTS (
       SELECT 1
       FROM business_events be
       WHERE be.id = je.ref_id
         AND be.company_id = je.company_id
         AND LOWER(COALESCE(be.source_module, '')) IN ('cash', 'treasury', 'cash_transaction')
     )
   );
