-- Preview the exact generated entries targeted for cleanup (company_id = 1)

SELECT je.ref_type,
       COUNT(*) AS entry_count,
       ROUND(SUM(COALESCE(lines.total_debit, 0)), 2) AS total_debit,
       ROUND(SUM(COALESCE(lines.total_credit, 0)), 2) AS total_credit
FROM journal_entries je
LEFT JOIN (
  SELECT entry_id,
         SUM(debit) AS total_debit,
         SUM(credit) AS total_credit
  FROM journal_entry_lines
  WHERE company_id = 1
  GROUP BY entry_id
) lines
  ON lines.entry_id = je.id
WHERE je.company_id = 1
  AND (
    je.local_id LIKE 'phase4_%'
    OR je.local_id LIKE 'reclass_supplier_ap_%'
    OR je.description LIKE 'Phase4 %'
  )
GROUP BY je.ref_type
ORDER BY entry_count DESC;

SELECT je.id,
       je.entry_date,
       je.ref_type,
       je.ref_id,
       je.local_id,
       je.description
FROM journal_entries je
WHERE je.company_id = 1
  AND (
    je.local_id LIKE 'phase4_%'
    OR je.local_id LIKE 'reclass_supplier_ap_%'
    OR je.description LIKE 'Phase4 %'
  )
ORDER BY je.id
LIMIT 200;
