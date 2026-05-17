INSERT INTO chart_of_accounts (
  company_id,
  code,
  name,
  account_type,
  normal_balance,
  parent_code,
  level,
  is_header,
  is_active,
  notes
)
SELECT
  1,
  '212000030',
  'شركة عرفة ( اسمدة ومبيدات )',
  'liability',
  'credit',
  '2120',
  4,
  0,
  1,
  'حساب فرعي صريح لمشتريات شركة عرفة المختلطة من الاسمدة والمبيدات (تصنيف 31001).'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '212000030'
);

UPDATE suppliers
SET gl_account_code = CASE code
  WHEN 20900151 THEN '212000013'
  WHEN 21400108 THEN '212000017'
  WHEN 21400002 THEN '212000018'
  WHEN 20100033 THEN '212000019'
  WHEN 20300086 THEN '212000020'
  ELSE gl_account_code
END
WHERE company_id = 1
  AND code IN (20900151, 21400108, 21400002, 20100033, 20300086);

UPDATE journal_entries
SET description = (
  SELECT TRIM(
    CASE
      WHEN st.entry_type = 'م' THEN 'سداد مستحقات مورد'
      ELSE 'إثبات معاملة مورد'
    END
    || ' | ' || COALESCE(s.name, 'مورد ' || CAST(st.supplier_code AS TEXT))
    || CASE
      WHEN COALESCE(TRIM(st.expense_category), '') <> '' THEN ' | ' || st.expense_category
      ELSE ''
    END
    || CASE
      WHEN st.document_number IS NOT NULL THEN ' | مستند ' || CAST(st.document_number AS TEXT)
      WHEN COALESCE(TRIM(st.document_type), '') <> '' THEN ' | ' || st.document_type
      ELSE ''
    END
  )
  FROM supplier_transactions st
  LEFT JOIN suppliers s
    ON s.company_id = st.company_id
   AND s.code = st.supplier_code
  WHERE st.company_id = journal_entries.company_id
    AND st.id = journal_entries.ref_id
)
WHERE company_id = 1
  AND ref_type = 'supplier_transaction'
  AND (
    description LIKE 'Phase4 supplier%'
    OR description LIKE 'Supplier #%'
  );

WITH candidate_reclass AS (
  SELECT
    je.id AS original_entry_id,
    je.company_id,
    je.period_id,
    je.entry_date,
    st.id AS supplier_txn_id,
    st.supplier_code,
    st.expense_category,
    COALESCE(s.name, 'مورد ' || CAST(st.supplier_code AS TEXT)) AS supplier_name,
    jl.debit AS generic_debit,
    jl.credit AS generic_credit,
    jl.center_code,
    jl.season_id,
    jl.field_id,
    CASE
      WHEN st.supplier_code = 20900151 THEN '212000013'
      WHEN st.supplier_code = 21400108 THEN '212000017'
      WHEN st.supplier_code = 21400002 THEN '212000018'
      WHEN st.supplier_code = 20100033 THEN '212000019'
      WHEN st.supplier_code = 20300086 THEN '212000020'
      WHEN st.supplier_code = 20900353 AND st.expense_category = '31001' THEN '212000030'
      WHEN st.supplier_code = 20900353 AND st.expense_category = 'ميكنة' THEN '212000016'
      ELSE NULL
    END AS target_account,
    'reclass_supplier_ap_' || CAST(je.id AS TEXT) AS local_id,
    TRIM(
      'إعادة تصنيف مستحقات مورد | '
      || COALESCE(s.name, 'مورد ' || CAST(st.supplier_code AS TEXT))
      || CASE
        WHEN COALESCE(TRIM(st.expense_category), '') <> '' THEN ' | ' || st.expense_category
        ELSE ''
      END
      || ' | أصل القيد #' || CAST(je.id AS TEXT)
    ) AS reclass_description
  FROM journal_entries je
  JOIN supplier_transactions st
    ON st.company_id = je.company_id
   AND st.id = je.ref_id
  LEFT JOIN suppliers s
    ON s.company_id = st.company_id
   AND s.code = st.supplier_code
  JOIN journal_entry_lines jl
    ON jl.company_id = je.company_id
   AND jl.entry_id = je.id
   AND jl.account_code = '212000010'
  WHERE je.company_id = 1
    AND je.ref_type = 'supplier_transaction'
    AND (ABS(jl.debit) > 0 OR ABS(jl.credit) > 0)
    AND (
      st.supplier_code IN (20900151, 21400108, 21400002, 20100033, 20300086)
      OR (st.supplier_code = 20900353 AND st.expense_category IN ('31001', 'ميكنة'))
    )
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
WHERE c.target_account IS NOT NULL
  AND NOT EXISTS (
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
    jl.debit AS generic_debit,
    jl.credit AS generic_credit,
    jl.center_code,
    jl.season_id,
    jl.field_id,
    CASE
      WHEN st.supplier_code = 20900151 THEN '212000013'
      WHEN st.supplier_code = 21400108 THEN '212000017'
      WHEN st.supplier_code = 21400002 THEN '212000018'
      WHEN st.supplier_code = 20100033 THEN '212000019'
      WHEN st.supplier_code = 20300086 THEN '212000020'
      WHEN st.supplier_code = 20900353 AND st.expense_category = '31001' THEN '212000030'
      WHEN st.supplier_code = 20900353 AND st.expense_category = 'ميكنة' THEN '212000016'
      ELSE NULL
    END AS target_account,
    'reclass_supplier_ap_' || CAST(je.id AS TEXT) AS local_id,
    TRIM(
      'إعادة تصنيف مستحقات مورد | '
      || COALESCE(s.name, 'مورد ' || CAST(st.supplier_code AS TEXT))
      || CASE
        WHEN COALESCE(TRIM(st.expense_category), '') <> '' THEN ' | ' || st.expense_category
        ELSE ''
      END
      || ' | أصل القيد #' || CAST(je.id AS TEXT)
    ) AS reclass_description
  FROM journal_entries je
  JOIN supplier_transactions st
    ON st.company_id = je.company_id
   AND st.id = je.ref_id
  LEFT JOIN suppliers s
    ON s.company_id = st.company_id
   AND s.code = st.supplier_code
  JOIN journal_entry_lines jl
    ON jl.company_id = je.company_id
   AND jl.entry_id = je.id
   AND jl.account_code = '212000010'
  WHERE je.company_id = 1
    AND je.ref_type = 'supplier_transaction'
    AND (ABS(jl.debit) > 0 OR ABS(jl.credit) > 0)
    AND (
      st.supplier_code IN (20900151, 21400108, 21400002, 20100033, 20300086)
      OR (st.supplier_code = 20900353 AND st.expense_category IN ('31001', 'ميكنة'))
    )
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
  c.generic_credit,
  c.generic_debit,
  c.reclass_description || ' | تحويل من موردون متنوعون',
  c.center_code,
  c.season_id,
  c.field_id,
  'supplier',
  c.supplier_txn_id
FROM candidate_reclass c
JOIN journal_entries reclass
  ON reclass.company_id = c.company_id
 AND reclass.local_id = c.local_id
WHERE c.target_account IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM journal_entry_lines existing
    WHERE existing.entry_id = reclass.id
      AND existing.company_id = reclass.company_id
      AND existing.account_code = '212000010'
  );

WITH candidate_reclass AS (
  SELECT
    je.id AS original_entry_id,
    je.company_id,
    st.id AS supplier_txn_id,
    jl.debit AS generic_debit,
    jl.credit AS generic_credit,
    jl.center_code,
    jl.season_id,
    jl.field_id,
    CASE
      WHEN st.supplier_code = 20900151 THEN '212000013'
      WHEN st.supplier_code = 21400108 THEN '212000017'
      WHEN st.supplier_code = 21400002 THEN '212000018'
      WHEN st.supplier_code = 20100033 THEN '212000019'
      WHEN st.supplier_code = 20300086 THEN '212000020'
      WHEN st.supplier_code = 20900353 AND st.expense_category = '31001' THEN '212000030'
      WHEN st.supplier_code = 20900353 AND st.expense_category = 'ميكنة' THEN '212000016'
      ELSE NULL
    END AS target_account,
    'reclass_supplier_ap_' || CAST(je.id AS TEXT) AS local_id,
    TRIM(
      'إعادة تصنيف مستحقات مورد | '
      || COALESCE(s.name, 'مورد ' || CAST(st.supplier_code AS TEXT))
      || CASE
        WHEN COALESCE(TRIM(st.expense_category), '') <> '' THEN ' | ' || st.expense_category
        ELSE ''
      END
      || ' | أصل القيد #' || CAST(je.id AS TEXT)
    ) AS reclass_description
  FROM journal_entries je
  JOIN supplier_transactions st
    ON st.company_id = je.company_id
   AND st.id = je.ref_id
  LEFT JOIN suppliers s
    ON s.company_id = st.company_id
   AND s.code = st.supplier_code
  JOIN journal_entry_lines jl
    ON jl.company_id = je.company_id
   AND jl.entry_id = je.id
   AND jl.account_code = '212000010'
  WHERE je.company_id = 1
    AND je.ref_type = 'supplier_transaction'
    AND (ABS(jl.debit) > 0 OR ABS(jl.credit) > 0)
    AND (
      st.supplier_code IN (20900151, 21400108, 21400002, 20100033, 20300086)
      OR (st.supplier_code = 20900353 AND st.expense_category IN ('31001', 'ميكنة'))
    )
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
  c.target_account,
  c.generic_debit,
  c.generic_credit,
  c.reclass_description || ' | تحويل إلى حساب المورد الفرعي',
  c.center_code,
  c.season_id,
  c.field_id,
  'supplier',
  c.supplier_txn_id
FROM candidate_reclass c
JOIN journal_entries reclass
  ON reclass.company_id = c.company_id
 AND reclass.local_id = c.local_id
WHERE c.target_account IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM journal_entry_lines existing
    WHERE existing.entry_id = reclass.id
      AND existing.company_id = reclass.company_id
      AND existing.account_code = c.target_account
  );