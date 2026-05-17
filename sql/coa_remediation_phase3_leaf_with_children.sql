-- COA remediation phase 3: resolve remaining leaf_with_children anomaly
-- Target: account 2110 (posting leaf with historical postings) has child 21100001
-- Safe strategy: keep 2110 as posting account (do not reclassify to header),
-- and re-parent 21100001 under existing header 2120 (موردون).

PRAGMA foreign_keys = ON;

-- BEFORE snapshot
SELECT 'before_leaf_with_children' AS section;
SELECT a.code, a.name, a.parent_code, a.is_header, COUNT(c.code) AS child_count
FROM chart_of_accounts a
JOIN chart_of_accounts c
  ON c.company_id = a.company_id
 AND c.parent_code = a.code
WHERE a.company_id = 1
  AND a.is_header = 0
GROUP BY a.code, a.name, a.parent_code, a.is_header
ORDER BY child_count DESC, a.code;

-- Re-parent specific child account to suppliers header.
UPDATE chart_of_accounts
SET parent_code = '2120',
    notes = CASE
      WHEN notes IS NULL OR notes = '' THEN 'Re-parented from 2110 to 2120 by COA remediation phase 3 (2026-05-08)'
      WHEN notes LIKE '%COA remediation phase 3 (2026-05-08)%' THEN notes
      ELSE notes || ' | Re-parented from 2110 to 2120 by COA remediation phase 3 (2026-05-08)'
    END
WHERE company_id = 1
  AND code = '21100001'
  AND parent_code = '2110';

-- AFTER snapshot
SELECT 'after_leaf_with_children' AS section;
SELECT a.code, a.name, a.parent_code, a.is_header, COUNT(c.code) AS child_count
FROM chart_of_accounts a
JOIN chart_of_accounts c
  ON c.company_id = a.company_id
 AND c.parent_code = a.code
WHERE a.company_id = 1
  AND a.is_header = 0
GROUP BY a.code, a.name, a.parent_code, a.is_header
ORDER BY child_count DESC, a.code;

SELECT code, name, parent_code, is_header, is_active
FROM chart_of_accounts
WHERE company_id = 1
  AND code IN ('2110', '21100001', '2120')
ORDER BY code;
