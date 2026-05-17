-- Migration 0107: Reclass posted AP for supplier 20900151 from 212000013 -> 212000010
-- Approach: create balancing manual reclassification journal entries (no edits to posted lines).

WITH candidate_reclass AS (
  SELECT
    je.id AS original_entry_id,
    je.company_id,
    je.period_id,
    je.entry_date,
    st.id AS supplier_txn_id,
    jl.debit AS old_debit,
    jl.credit AS old_credit,
    jl.center_code,
    jl.season_id,
    jl.field_id,
    'reclass_srv_supply_20900151_' || CAST(je.id AS TEXT) AS local_id,
    'إعادة تصنيف AP مورد 20900151 من 212000013 إلى 212000010 | أصل القيد #' || CAST(je.id AS TEXT) AS reclass_description
  FROM supplier_transactions st
  JOIN journal_entries je
    ON je.company_id = st.company_id
   AND je.id = st.journal_entry_id
   AND je.ref_type = 'supplier_transaction'
  JOIN journal_entry_lines jl
    ON jl.company_id = je.company_id
   AND jl.entry_id = je.id
   AND jl.account_code = '212000013'
  WHERE st.company_id = 1
    AND st.supplier_code = 20900151
    AND st.service_type_code = 'SRV_SUPPLY'
    AND (ABS(jl.debit) > 0 OR ABS(jl.credit) > 0)
)
INSERT INTO journal_entries (
  company_id,
  period_id,
  entry_date,
  description,
  ref_type,
  ref_id,
  is_posted,
  created_at,
  local_id
)
SELECT
  c.company_id,
  c.period_id,
  c.entry_date,
  c.reclass_description,
  'manual',
  c.original_entry_id,
  1,
  datetime('now'),
  c.local_id
FROM candidate_reclass c
WHERE NOT EXISTS (
  SELECT 1
  FROM journal_entries existing
  WHERE existing.company_id = c.company_id
    AND existing.local_id = c.local_id
);

WITH candidate_reclass AS (
  SELECT
    je.id AS original_entry_id,
    je.company_id,
    st.id AS supplier_txn_id,
    jl.debit AS old_debit,
    jl.credit AS old_credit,
    jl.center_code,
    jl.season_id,
    jl.field_id,
    'reclass_srv_supply_20900151_' || CAST(je.id AS TEXT) AS local_id,
    'إعادة تصنيف AP مورد 20900151 من 212000013 إلى 212000010 | أصل القيد #' || CAST(je.id AS TEXT) AS reclass_description
  FROM supplier_transactions st
  JOIN journal_entries je
    ON je.company_id = st.company_id
   AND je.id = st.journal_entry_id
   AND je.ref_type = 'supplier_transaction'
  JOIN journal_entry_lines jl
    ON jl.company_id = je.company_id
   AND jl.entry_id = je.id
   AND jl.account_code = '212000013'
  WHERE st.company_id = 1
    AND st.supplier_code = 20900151
    AND st.service_type_code = 'SRV_SUPPLY'
    AND (ABS(jl.debit) > 0 OR ABS(jl.credit) > 0)
)
INSERT INTO journal_entry_lines (
  entry_id,
  company_id,
  account_code,
  debit,
  credit,
  description,
  center_code,
  season_id,
  field_id,
  source_ledger,
  source_record_id
)
SELECT
  reclass.id,
  c.company_id,
  '212000013',
  c.old_credit,
  c.old_debit,
  c.reclass_description || ' | عكس الحساب القديم',
  c.center_code,
  c.season_id,
  c.field_id,
  'supplier',
  c.supplier_txn_id
FROM candidate_reclass c
JOIN journal_entries reclass
  ON reclass.company_id = c.company_id
 AND reclass.local_id = c.local_id
WHERE NOT EXISTS (
  SELECT 1
  FROM journal_entry_lines existing
  WHERE existing.entry_id = reclass.id
    AND existing.company_id = reclass.company_id
    AND existing.account_code = '212000013'
);

WITH candidate_reclass AS (
  SELECT
    je.id AS original_entry_id,
    je.company_id,
    st.id AS supplier_txn_id,
    jl.debit AS old_debit,
    jl.credit AS old_credit,
    jl.center_code,
    jl.season_id,
    jl.field_id,
    'reclass_srv_supply_20900151_' || CAST(je.id AS TEXT) AS local_id,
    'إعادة تصنيف AP مورد 20900151 من 212000013 إلى 212000010 | أصل القيد #' || CAST(je.id AS TEXT) AS reclass_description
  FROM supplier_transactions st
  JOIN journal_entries je
    ON je.company_id = st.company_id
   AND je.id = st.journal_entry_id
   AND je.ref_type = 'supplier_transaction'
  JOIN journal_entry_lines jl
    ON jl.company_id = je.company_id
   AND jl.entry_id = je.id
   AND jl.account_code = '212000013'
  WHERE st.company_id = 1
    AND st.supplier_code = 20900151
    AND st.service_type_code = 'SRV_SUPPLY'
    AND (ABS(jl.debit) > 0 OR ABS(jl.credit) > 0)
)
INSERT INTO journal_entry_lines (
  entry_id,
  company_id,
  account_code,
  debit,
  credit,
  description,
  center_code,
  season_id,
  field_id,
  source_ledger,
  source_record_id
)
SELECT
  reclass.id,
  c.company_id,
  '212000010',
  c.old_debit,
  c.old_credit,
  c.reclass_description || ' | إثبات الحساب الصحيح',
  c.center_code,
  c.season_id,
  c.field_id,
  'supplier',
  c.supplier_txn_id
FROM candidate_reclass c
JOIN journal_entries reclass
  ON reclass.company_id = c.company_id
 AND reclass.local_id = c.local_id
WHERE NOT EXISTS (
  SELECT 1
  FROM journal_entry_lines existing
  WHERE existing.entry_id = reclass.id
    AND existing.company_id = reclass.company_id
    AND existing.account_code = '212000010'
);
