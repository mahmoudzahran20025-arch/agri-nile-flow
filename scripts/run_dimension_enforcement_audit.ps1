$ErrorActionPreference = 'Stop'

$DbName = 'agri-nile-flow-data-lake'
$OutDir = 'reports/dimension_audit_2026-05-09'
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

function Invoke-D1Query {
  param(
    [string]$Name,
    [string]$Sql
  )

  Write-Host "=== $Name ==="
  $outFile = Join-Path $OutDir ("{0}.log" -f $Name)
  npx wrangler d1 execute $DbName --remote --command $Sql 2>&1 | Tee-Object -FilePath $outFile
}

# 1) Supplier layer metrics
Invoke-D1Query -Name '01_supplier_layer' -Sql @"
WITH base AS (
  SELECT * FROM supplier_transactions WHERE company_id=1 AND status='posted'
),
supplier_center AS (
  SELECT supplier_code, MIN(center_code) c FROM base WHERE center_code IS NOT NULL GROUP BY supplier_code HAVING COUNT(DISTINCT center_code)=1
),
expense_center AS (
  SELECT expense_category, MIN(center_code) c FROM base WHERE center_code IS NOT NULL AND COALESCE(expense_category,'')<>'' GROUP BY expense_category HAVING COUNT(DISTINCT center_code)=1
),
required_scope AS (
  SELECT b.id
  FROM base b
  LEFT JOIN suppliers s ON s.company_id=b.company_id AND s.code=b.supplier_code
  WHERE (
    lower(COALESCE(b.entry_type,'')) LIKE '%rent%' OR lower(COALESCE(b.entry_type,'')) LIKE '%mechan%' OR lower(COALESCE(b.entry_type,'')) LIKE '%maint%' OR lower(COALESCE(b.entry_type,'')) LIKE '%labor%'
    OR lower(COALESCE(b.expense_category,'')) LIKE '%rent%' OR lower(COALESCE(b.expense_category,'')) LIKE '%mechan%' OR lower(COALESCE(b.expense_category,'')) LIKE '%maint%' OR lower(COALESCE(b.expense_category,'')) LIKE '%labor%'
    OR COALESCE(b.entry_type,'') LIKE '%معدات%' OR COALESCE(b.expense_category,'') LIKE '%معدات%' OR COALESCE(s.activity,'') LIKE '%معدات%' OR COALESCE(s.activity,'') LIKE '%الات%' OR COALESCE(s.activity,'') LIKE '%عمالة%'
  )
  AND NOT (
    lower(COALESCE(b.entry_type,'')) LIKE '%opening%' OR lower(COALESCE(b.entry_type,'')) LIKE '%settlement%' OR lower(COALESCE(b.entry_type,'')) LIKE '%clearing%' OR lower(COALESCE(b.entry_type,'')) LIKE '%adjust%' OR lower(COALESCE(b.entry_type,'')) LIKE '%misc%'
    OR lower(COALESCE(b.expense_category,'')) LIKE '%opening%' OR lower(COALESCE(b.expense_category,'')) LIKE '%settlement%' OR lower(COALESCE(b.expense_category,'')) LIKE '%clearing%' OR lower(COALESCE(b.expense_category,'')) LIKE '%adjust%' OR lower(COALESCE(b.expense_category,'')) LIKE '%misc%'
    OR COALESCE(b.entry_type,'') LIKE '%افتتاح%' OR COALESCE(b.expense_category,'') LIKE '%افتتاح%' OR COALESCE(b.entry_type,'') LIKE '%تسوية%' OR COALESCE(b.expense_category,'') LIKE '%تسوية%'
  )
),
inferable AS (
  SELECT b.id
  FROM base b
  LEFT JOIN supplier_center sc ON sc.supplier_code=b.supplier_code
  LEFT JOIN expense_center ec ON ec.expense_category=b.expense_category
  WHERE b.center_code IS NULL AND (sc.c IS NOT NULL OR ec.c IS NOT NULL)
),
equipment_implied AS (
  SELECT b.id
  FROM base b
  LEFT JOIN suppliers s ON s.company_id=b.company_id AND s.code=b.supplier_code
  WHERE COALESCE(b.equipment,'')<>'' OR b.equipment_type_id IS NOT NULL OR b.work_order_id IS NOT NULL
    OR lower(COALESCE(b.expense_category,'')) LIKE '%equipment%' OR lower(COALESCE(b.expense_category,'')) LIKE '%machin%'
    OR lower(COALESCE(b.description,'')) LIKE '%equipment%' OR lower(COALESCE(b.description,'')) LIKE '%machin%'
    OR COALESCE(b.expense_category,'') LIKE '%معدات%' OR COALESCE(b.description,'') LIKE '%معدات%' OR COALESCE(s.activity,'') LIKE '%معدات%' OR COALESCE(s.activity,'') LIKE '%الات%'
)
SELECT
  COUNT(*) AS total_supplier_transactions,
  SUM(CASE WHEN s.gl_account_code IS NOT NULL AND coa.code IS NOT NULL AND coa.is_active=1 AND coa.account_type IN ('liability','expense') THEN 1 ELSE 0 END) AS with_valid_gl_mapping,
  ROUND(100.0*SUM(CASE WHEN s.gl_account_code IS NOT NULL AND coa.code IS NOT NULL AND coa.is_active=1 AND coa.account_type IN ('liability','expense') THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_valid_gl_mapping_pct,
  SUM(CASE WHEN b.center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center_code,
  ROUND(100.0*SUM(CASE WHEN b.center_code IS NOT NULL THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_center_code_pct,
  SUM(CASE WHEN COALESCE(b.equipment,'')<>'' THEN 1 ELSE 0 END) AS with_equipment,
  SUM(CASE WHEN b.equipment_type_id IS NOT NULL THEN 1 ELSE 0 END) AS with_equipment_type_id,
  (SELECT COUNT(*) FROM inferable) AS inferable_center_code,
  ROUND(100.0*(SELECT COUNT(*) FROM inferable)/NULLIF(COUNT(*),0),2) AS inferable_center_code_pct,
  SUM(CASE WHEN b.id IN (SELECT id FROM required_scope) AND b.center_code IS NULL AND b.id NOT IN (SELECT id FROM inferable) THEN 1 ELSE 0 END) AS non_inferable_missing_dimensions,
  ROUND(100.0*SUM(CASE WHEN b.id IN (SELECT id FROM required_scope) AND b.center_code IS NULL AND b.id NOT IN (SELECT id FROM inferable) THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS non_inferable_missing_dimensions_pct,
  (SELECT COUNT(*) FROM equipment_implied) AS equipment_implied_count,
  SUM(CASE WHEN b.id IN (SELECT id FROM equipment_implied) AND (COALESCE(b.equipment,'')<>'' OR b.equipment_type_id IS NOT NULL) THEN 1 ELSE 0 END) AS equipment_implied_with_binding,
  SUM(CASE WHEN b.id IN (SELECT id FROM equipment_implied) AND COALESCE(b.equipment_usage_mode,'')<>'' THEN 1 ELSE 0 END) AS equipment_implied_with_usage_mode,
  SUM(CASE WHEN b.id IN (SELECT id FROM equipment_implied) AND b.work_order_id IS NOT NULL THEN 1 ELSE 0 END) AS equipment_implied_with_work_order
FROM base b
LEFT JOIN suppliers s ON s.company_id=b.company_id AND s.code=b.supplier_code
LEFT JOIN chart_of_accounts coa ON coa.company_id=s.company_id AND coa.code=CAST(s.gl_account_code AS TEXT);
"@

# 2) Supplier category split
Invoke-D1Query -Name '02_supplier_category_split' -Sql @"
SELECT
  CASE
    WHEN lower(COALESCE(activity,'')) LIKE '%rent%' OR lower(COALESCE(activity,'')) LIKE '%mechan%' OR lower(COALESCE(activity,'')) LIKE '%maint%' OR lower(COALESCE(activity,'')) LIKE '%labor%'
      OR COALESCE(activity,'') LIKE '%معدات%' OR COALESCE(activity,'') LIKE '%الات%' OR COALESCE(activity,'') LIKE '%عمالة%' OR COALESCE(activity,'') LIKE '%تشغيل%'
    THEN 'operational'
    WHEN lower(COALESCE(activity,'')) LIKE '%opening%' OR lower(COALESCE(activity,'')) LIKE '%settlement%' OR lower(COALESCE(activity,'')) LIKE '%clearing%' OR lower(COALESCE(activity,'')) LIKE '%adjust%'
      OR COALESCE(activity,'') LIKE '%افتتاح%' OR COALESCE(activity,'') LIKE '%تسوية%'
    THEN 'optional_context'
    ELSE 'other_or_unknown'
  END AS operational_type,
  COUNT(*) AS suppliers_count,
  ROUND(100.0*COUNT(*)/NULLIF((SELECT COUNT(*) FROM suppliers WHERE company_id=1),0),2) AS pct
FROM suppliers
WHERE company_id=1
GROUP BY 1
ORDER BY suppliers_count DESC;
"@

# 3) Cash layer metrics
Invoke-D1Query -Name '03_cash_layer' -Sql @"
WITH base AS (
  SELECT * FROM cash_transactions WHERE company_id=1 AND status='posted'
),
expense_center AS (
  SELECT expense_code, MIN(center_code) c FROM base WHERE center_code IS NOT NULL AND expense_code IS NOT NULL GROUP BY expense_code HAVING COUNT(DISTINCT center_code)=1
),
supplier_center AS (
  SELECT supplier_code, MIN(center_code) c FROM base WHERE center_code IS NOT NULL AND supplier_code IS NOT NULL GROUP BY supplier_code HAVING COUNT(DISTINCT center_code)=1
),
inferable AS (
  SELECT b.id FROM base b
  LEFT JOIN expense_center e ON e.expense_code=b.expense_code
  LEFT JOIN supplier_center s ON s.supplier_code=b.supplier_code
  WHERE b.center_code IS NULL AND (e.c IS NOT NULL OR s.c IS NOT NULL)
),
operational_scope AS (
  SELECT id FROM base
  WHERE COALESCE(expense_code,0)<>0
    OR lower(COALESCE(narration,'')) LIKE '%fuel%' OR lower(COALESCE(narration,'')) LIKE '%rent%' OR lower(COALESCE(narration,'')) LIKE '%labor%' OR lower(COALESCE(narration,'')) LIKE '%maint%'
    OR COALESCE(narration,'') LIKE '%وقود%' OR COALESCE(narration,'') LIKE '%ايجار%' OR COALESCE(narration,'') LIKE '%عمالة%' OR COALESCE(narration,'') LIKE '%صيانة%'
)
SELECT
  COUNT(*) AS total_cash_transactions,
  SUM(CASE WHEN COALESCE(direction,'')<>'' THEN 1 ELSE 0 END) AS with_entry_type_proxy,
  ROUND(100.0*SUM(CASE WHEN COALESCE(direction,'')<>'' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_entry_type_proxy_pct,
  SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center_code,
  ROUND(100.0*SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_center_code_pct,
  (SELECT COUNT(*) FROM inferable) AS inferable_center_code,
  ROUND(100.0*(SELECT COUNT(*) FROM inferable)/NULLIF(COUNT(*),0),2) AS inferable_center_code_pct,
  SUM(CASE WHEN id IN (SELECT id FROM operational_scope) AND center_code IS NULL THEN 1 ELSE 0 END) AS operational_expenses_missing_center,
  ROUND(100.0*SUM(CASE WHEN id IN (SELECT id FROM operational_scope) AND center_code IS NULL THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS operational_expenses_missing_center_pct
FROM base;
"@

# 4) Inventory layer metrics
Invoke-D1Query -Name '04_inventory_layer' -Sql @"
WITH base AS (
  SELECT * FROM inventory_movements WHERE company_id=1 AND status='posted'
),
item_center AS (
  SELECT item_code, MIN(center_code) c FROM base WHERE center_code IS NOT NULL AND item_code IS NOT NULL GROUP BY item_code HAVING COUNT(DISTINCT center_code)=1
),
wh_center AS (
  SELECT warehouse, MIN(center_code) c FROM base WHERE center_code IS NOT NULL AND COALESCE(warehouse,'')<>'' GROUP BY warehouse HAVING COUNT(DISTINCT center_code)=1
),
inferable AS (
  SELECT b.id FROM base b
  LEFT JOIN item_center i ON i.item_code=b.item_code
  LEFT JOIN wh_center w ON w.warehouse=b.warehouse
  WHERE b.center_code IS NULL AND (i.c IS NOT NULL OR w.c IS NOT NULL)
)
SELECT
  COUNT(*) AS total_inventory_movements,
  SUM(CASE WHEN item_code IS NOT NULL THEN 1 ELSE 0 END) AS with_item_code,
  ROUND(100.0*SUM(CASE WHEN item_code IS NOT NULL THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_item_code_pct,
  SUM(CASE WHEN COALESCE(warehouse,'')<>'' OR warehouse_id IS NOT NULL THEN 1 ELSE 0 END) AS with_warehouse,
  ROUND(100.0*SUM(CASE WHEN COALESCE(warehouse,'')<>'' OR warehouse_id IS NOT NULL THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_warehouse_pct,
  SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center_code,
  ROUND(100.0*SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_center_code_pct,
  (SELECT COUNT(*) FROM inferable) AS inferable_center_code,
  ROUND(100.0*(SELECT COUNT(*) FROM inferable)/NULLIF(COUNT(*),0),2) AS inferable_center_code_pct,
  SUM(CASE WHEN i.code IS NOT NULL AND COALESCE(i.inv_posting_group_code,'')<>'' THEN 1 ELSE 0 END) AS posting_group_coverage,
  ROUND(100.0*SUM(CASE WHEN i.code IS NOT NULL AND COALESCE(i.inv_posting_group_code,'')<>'' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS posting_group_coverage_pct
FROM base b
LEFT JOIN items i ON i.company_id=b.company_id AND i.code=b.item_code;
"@

# 5) Equipment layer metrics
Invoke-D1Query -Name '05_equipment_layer' -Sql @"
WITH supplier_base AS (
  SELECT * FROM supplier_transactions WHERE company_id=1 AND status='posted'
),
cash_base AS (
  SELECT * FROM cash_transactions WHERE company_id=1 AND status='posted'
),
inventory_base AS (
  SELECT * FROM inventory_movements WHERE company_id=1 AND status='posted'
),
implied AS (
  SELECT 'supplier' src, id, equipment_type_id, work_order_id, equipment_usage_mode, COALESCE(equipment,'') equipment_text
  FROM supplier_base
  WHERE COALESCE(equipment,'')<>'' OR equipment_type_id IS NOT NULL OR work_order_id IS NOT NULL
     OR lower(COALESCE(expense_category,'')) LIKE '%equipment%' OR lower(COALESCE(expense_category,'')) LIKE '%machin%'
     OR lower(COALESCE(description,'')) LIKE '%equipment%' OR lower(COALESCE(description,'')) LIKE '%machin%'
     OR COALESCE(expense_category,'') LIKE '%معدات%' OR COALESCE(description,'') LIKE '%معدات%'
  UNION ALL
  SELECT 'cash', id, NULL, work_order_id, NULL, ''
  FROM cash_base
  WHERE lower(COALESCE(narration,'')) LIKE '%equipment%' OR lower(COALESCE(narration,'')) LIKE '%machin%' OR COALESCE(narration,'') LIKE '%معدات%'
  UNION ALL
  SELECT 'inventory', id, NULL, work_order_id, NULL, ''
  FROM inventory_base
  WHERE lower(COALESCE(notes,'')) LIKE '%equipment%' OR lower(COALESCE(notes,'')) LIKE '%machin%' OR COALESCE(notes,'') LIKE '%معدات%'
),
resolved AS (
  SELECT i.*,
         CASE WHEN i.equipment_type_id IS NOT NULL AND et.id IS NOT NULL THEN 1 ELSE 0 END has_equipment_type,
         CASE WHEN i.work_order_id IS NOT NULL AND wo.id IS NOT NULL THEN 1 ELSE 0 END has_work_order
  FROM implied i
  LEFT JOIN equipment_types et ON et.company_id=1 AND et.id=i.equipment_type_id
  LEFT JOIN work_orders wo ON wo.company_id=1 AND wo.id=i.work_order_id
)
SELECT
  COUNT(*) AS transactions_implying_equipment_usage,
  SUM(CASE WHEN COALESCE(equipment_text,'')<>'' OR has_equipment_type=1 THEN 1 ELSE 0 END) AS with_equipment_binding,
  ROUND(100.0*SUM(CASE WHEN COALESCE(equipment_text,'')<>'' OR has_equipment_type=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_equipment_binding_pct,
  SUM(CASE WHEN COALESCE(equipment_usage_mode,'')<>'' THEN 1 ELSE 0 END) AS with_usage_mode,
  ROUND(100.0*SUM(CASE WHEN COALESCE(equipment_usage_mode,'')<>'' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_usage_mode_pct,
  SUM(CASE WHEN has_work_order=1 THEN 1 ELSE 0 END) AS with_work_order,
  ROUND(100.0*SUM(CASE WHEN has_work_order=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS with_work_order_pct,
  SUM(CASE WHEN (COALESCE(equipment_text,'')<>'' OR has_equipment_type=1 OR has_work_order=1) AND has_equipment_type=0 AND has_work_order=0 THEN 1 ELSE 0 END) AS unresolved_equipment_references
FROM resolved;
"@

# 6) GL traceability
Invoke-D1Query -Name '06_gl_traceability' -Sql @"
WITH supplier_base AS (SELECT * FROM supplier_transactions WHERE company_id=1 AND status='posted'),
cash_base AS (SELECT * FROM cash_transactions WHERE company_id=1 AND status='posted'),
inventory_base AS (SELECT * FROM inventory_movements WHERE company_id=1 AND status='posted'),
linked AS (
  SELECT 'supplier' src, id source_id, journal_entry_id FROM supplier_base WHERE journal_entry_id IS NOT NULL
  UNION ALL
  SELECT 'cash', id, journal_entry_id FROM cash_base WHERE journal_entry_id IS NOT NULL
  UNION ALL
  SELECT 'inventory', id, journal_entry_id FROM inventory_base WHERE journal_entry_id IS NOT NULL
),
cross_link AS (
  SELECT journal_entry_id FROM linked GROUP BY journal_entry_id HAVING COUNT(DISTINCT src)>1
),
dup_risk AS (
  SELECT src, journal_entry_id FROM linked GROUP BY src, journal_entry_id HAVING COUNT(*)>1
)
SELECT
  (SELECT COUNT(*) FROM supplier_base) AS supplier_total,
  (SELECT COUNT(*) FROM supplier_base s LEFT JOIN journal_entries je ON je.id=s.journal_entry_id AND je.company_id=s.company_id WHERE s.journal_entry_id IS NOT NULL AND je.id IS NOT NULL) AS supplier_to_je_integrity,
  (SELECT COUNT(*) FROM cash_base) AS cash_total,
  (SELECT COUNT(*) FROM cash_base c LEFT JOIN journal_entries je ON je.id=c.journal_entry_id AND je.company_id=c.company_id WHERE c.journal_entry_id IS NOT NULL AND je.id IS NOT NULL) AS cash_to_je_integrity,
  (SELECT COUNT(*) FROM inventory_base) AS inventory_total,
  (SELECT COUNT(*) FROM inventory_base i LEFT JOIN journal_entries je ON je.id=i.journal_entry_id AND je.company_id=i.company_id WHERE i.journal_entry_id IS NOT NULL AND je.id IS NOT NULL) AS inventory_to_je_integrity,
  (SELECT COUNT(*) FROM journal_entry_lines l LEFT JOIN journal_entries je ON je.id=l.entry_id AND je.company_id=l.company_id WHERE l.company_id=1 AND je.id IS NULL) AS orphan_journal_lines,
  (SELECT COUNT(*) FROM supplier_base s LEFT JOIN journal_entries je ON je.id=s.journal_entry_id AND je.company_id=s.company_id WHERE s.journal_entry_id IS NOT NULL AND je.id IS NULL)
  + (SELECT COUNT(*) FROM cash_base c LEFT JOIN journal_entries je ON je.id=c.journal_entry_id AND je.company_id=c.company_id WHERE c.journal_entry_id IS NOT NULL AND je.id IS NULL)
  + (SELECT COUNT(*) FROM inventory_base i LEFT JOIN journal_entries je ON je.id=i.journal_entry_id AND je.company_id=i.company_id WHERE i.journal_entry_id IS NOT NULL AND je.id IS NULL) AS orphan_source_rows,
  (SELECT COUNT(*) FROM cross_link) AS cross_linked_entries,
  (SELECT COUNT(*) FROM dup_risk) AS duplicate_posting_risks;
"@

# 7) Inference rule determinism
Invoke-D1Query -Name '07_inference_rules' -Sql @"
WITH supplier_base AS (SELECT * FROM supplier_transactions WHERE company_id=1 AND status='posted'),
cash_base AS (SELECT * FROM cash_transactions WHERE company_id=1 AND status='posted'),
inventory_base AS (SELECT * FROM inventory_movements WHERE company_id=1 AND status='posted'),
r1 AS (SELECT supplier_code k, COUNT(DISTINCT center_code) v FROM supplier_base WHERE supplier_code IS NOT NULL AND center_code IS NOT NULL GROUP BY supplier_code),
r2 AS (SELECT expense_category k, COUNT(DISTINCT center_code) v FROM supplier_base WHERE COALESCE(expense_category,'')<>'' AND center_code IS NOT NULL GROUP BY expense_category),
r3 AS (SELECT expense_code k, COUNT(DISTINCT center_code) v FROM cash_base WHERE expense_code IS NOT NULL AND center_code IS NOT NULL GROUP BY expense_code),
r4 AS (SELECT item_code k, COUNT(DISTINCT center_code) v FROM inventory_base WHERE item_code IS NOT NULL AND center_code IS NOT NULL GROUP BY item_code),
r5 AS (SELECT warehouse k, COUNT(DISTINCT center_code) v FROM inventory_base WHERE COALESCE(warehouse,'')<>'' AND center_code IS NOT NULL GROUP BY warehouse)
SELECT 'supplier_code -> center_code' AS rule_name,
       SUM(CASE WHEN v=1 THEN 1 ELSE 0 END) AS deterministic_keys,
       COUNT(*) AS total_keys,
       ROUND(100.0*SUM(CASE WHEN v=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS determinism_pct,
       SUM(CASE WHEN v>1 THEN 1 ELSE 0 END) AS collision_keys
FROM r1
UNION ALL
SELECT 'supplier.expense_category -> center_code', SUM(CASE WHEN v=1 THEN 1 ELSE 0 END), COUNT(*), ROUND(100.0*SUM(CASE WHEN v=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2), SUM(CASE WHEN v>1 THEN 1 ELSE 0 END) FROM r2
UNION ALL
SELECT 'cash.expense_code -> center_code', SUM(CASE WHEN v=1 THEN 1 ELSE 0 END), COUNT(*), ROUND(100.0*SUM(CASE WHEN v=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2), SUM(CASE WHEN v>1 THEN 1 ELSE 0 END) FROM r3
UNION ALL
SELECT 'inventory.item_code -> center_code', SUM(CASE WHEN v=1 THEN 1 ELSE 0 END), COUNT(*), ROUND(100.0*SUM(CASE WHEN v=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2), SUM(CASE WHEN v>1 THEN 1 ELSE 0 END) FROM r4
UNION ALL
SELECT 'inventory.warehouse -> center_code', SUM(CASE WHEN v=1 THEN 1 ELSE 0 END), COUNT(*), ROUND(100.0*SUM(CASE WHEN v=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2), SUM(CASE WHEN v>1 THEN 1 ELSE 0 END) FROM r5;
"@

# 8) High-risk samples
Invoke-D1Query -Name '08_high_risk_supplier' -Sql @"
SELECT id, supplier_code, entry_type, expense_category, amount, description
FROM supplier_transactions
WHERE company_id=1 AND status='posted' AND center_code IS NULL
  AND (
    lower(COALESCE(entry_type,'')) LIKE '%rent%' OR lower(COALESCE(entry_type,'')) LIKE '%mechan%' OR lower(COALESCE(entry_type,'')) LIKE '%maint%' OR lower(COALESCE(entry_type,'')) LIKE '%labor%'
    OR lower(COALESCE(expense_category,'')) LIKE '%rent%' OR lower(COALESCE(expense_category,'')) LIKE '%mechan%' OR lower(COALESCE(expense_category,'')) LIKE '%maint%' OR lower(COALESCE(expense_category,'')) LIKE '%labor%'
    OR COALESCE(entry_type,'') LIKE '%معدات%' OR COALESCE(expense_category,'') LIKE '%معدات%' OR COALESCE(entry_type,'') LIKE '%عمالة%' OR COALESCE(expense_category,'') LIKE '%عمالة%'
  )
LIMIT 20;
"@

Invoke-D1Query -Name '09_high_risk_cash' -Sql @"
SELECT id, supplier_code, expense_code, amount, narration
FROM cash_transactions
WHERE company_id=1 AND status='posted' AND center_code IS NULL
  AND (
    COALESCE(expense_code,0)<>0
    OR lower(COALESCE(narration,'')) LIKE '%fuel%' OR lower(COALESCE(narration,'')) LIKE '%rent%' OR lower(COALESCE(narration,'')) LIKE '%labor%' OR lower(COALESCE(narration,'')) LIKE '%maint%'
    OR COALESCE(narration,'') LIKE '%وقود%' OR COALESCE(narration,'') LIKE '%ايجار%' OR COALESCE(narration,'') LIKE '%عمالة%' OR COALESCE(narration,'') LIKE '%صيانة%'
  )
LIMIT 20;
"@

Invoke-D1Query -Name '10_high_risk_inventory' -Sql @"
SELECT id, item_code, warehouse, movement_type, quantity, value_in, value_out, notes
FROM inventory_movements
WHERE company_id=1 AND status='posted' AND center_code IS NULL
LIMIT 20;
"@

Invoke-D1Query -Name '11_high_risk_equipment' -Sql @"
SELECT id, supplier_code, equipment, equipment_type_id, work_order_id, equipment_usage_mode, amount, description
FROM supplier_transactions
WHERE company_id=1 AND status='posted'
  AND (
      COALESCE(equipment,'')<>'' OR equipment_type_id IS NOT NULL OR work_order_id IS NOT NULL
      OR COALESCE(expense_category,'') LIKE '%معدات%' OR COALESCE(description,'') LIKE '%معدات%'
  )
  AND (
      (equipment_type_id IS NOT NULL AND equipment_type_id NOT IN (SELECT id FROM equipment_types WHERE company_id=1))
      OR (work_order_id IS NOT NULL AND work_order_id NOT IN (SELECT id FROM work_orders WHERE company_id=1))
      OR (COALESCE(equipment_usage_mode,'')='' AND work_order_id IS NULL)
  )
LIMIT 20;
"@

Write-Host "Audit logs written to: $OutDir"
