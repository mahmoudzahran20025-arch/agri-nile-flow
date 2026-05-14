-- Daily Finance Control Query Pack
-- Purpose: one-pass operational monitoring for posting quality gates.
-- How to use:
--   1) Set the cutoff date in the params CTE.
--   2) Run the full script as a single execution.
--   3) Alert if any actionable_nonfuture or unbalanced counters are non-zero.

WITH params AS (
	SELECT DATE('2026-05-11') AS cutoff_date
)
SELECT
	'baseline' AS metric,
	(SELECT cutoff_date FROM params) AS value;

WITH params AS (
	SELECT DATE('2026-05-11') AS cutoff_date
)
SELECT
	'actionable_supplier_nonfuture' AS metric,
	COUNT(*) AS value
FROM supplier_transactions st
WHERE st.company_id = 1
	AND st.status = 'posted'
	AND st.journal_entry_id IS NULL
	AND COALESCE(st.amount, 0) + COALESCE(st.debit, 0) + COALESCE(st.credit, 0) <> 0
	AND DATE(st.transaction_date) <= (SELECT cutoff_date FROM params);

WITH params AS (
	SELECT DATE('2026-05-11') AS cutoff_date
)
SELECT
	'actionable_inventory_nonfuture' AS metric,
	COUNT(*) AS value
FROM inventory_movements im
WHERE im.company_id = 1
	AND im.status = 'posted'
	AND im.movement_type IN ('GRN', 'ISSUE')
	AND im.journal_entry_id IS NULL
	AND COALESCE(im.gl_posting_status, '') NOT IN ('exempt_zero_value', 'skipped_zero_value', 'future_blocked')
	AND DATE(im.movement_date) <= (SELECT cutoff_date FROM params);

WITH params AS (
	SELECT DATE('2026-05-11') AS cutoff_date
)
SELECT
	'future_blocked_supplier' AS metric,
	COUNT(*) AS value
FROM supplier_transactions st
WHERE st.company_id = 1
	AND st.status = 'posted'
	AND st.journal_entry_id IS NULL
	AND DATE(st.transaction_date) > (SELECT cutoff_date FROM params);

WITH params AS (
	SELECT DATE('2026-05-11') AS cutoff_date
)
SELECT
	'future_blocked_inventory' AS metric,
	COUNT(*) AS value
FROM inventory_movements im
WHERE im.company_id = 1
	AND im.status = 'posted'
	AND im.movement_type IN ('GRN', 'ISSUE')
	AND im.journal_entry_id IS NULL
	AND DATE(im.movement_date) > (SELECT cutoff_date FROM params);

SELECT
	'unbalanced_supplier_entries' AS metric,
	COUNT(*) AS value
FROM (
	SELECT je.id
	FROM journal_entries je
	JOIN journal_entry_lines jl ON jl.entry_id = je.id AND jl.company_id = je.company_id
	WHERE je.company_id = 1
		AND je.ref_type = 'supplier_transaction'
	GROUP BY je.id
	HAVING ABS(ROUND(SUM(COALESCE(jl.debit, 0)), 2) - ROUND(SUM(COALESCE(jl.credit, 0)), 2)) > 0.01
) t;

SELECT
	'unbalanced_inventory_entries' AS metric,
	COUNT(*) AS value
FROM (
	SELECT je.id
	FROM journal_entries je
	JOIN journal_entry_lines jl ON jl.entry_id = je.id AND jl.company_id = je.company_id
	WHERE je.company_id = 1
		AND je.ref_type IN ('inventory_movement', 'inventory_transfer')
	GROUP BY je.id
	HAVING ABS(ROUND(SUM(COALESCE(jl.debit, 0)), 2) - ROUND(SUM(COALESCE(jl.credit, 0)), 2)) > 0.01
) t;

SELECT
	'posted_supplier_null_service_type' AS metric,
	COUNT(*) AS value
FROM supplier_transactions st
WHERE st.status = 'posted'
	AND st.supplier_code IS NOT NULL
	AND st.service_type_code IS NULL;

SELECT
	'grn_issue_null_service_type' AS metric,
	COUNT(*) AS value
FROM inventory_movements im
WHERE im.movement_type IN ('GRN', 'ISSUE')
	AND im.service_type_code IS NULL;

-- Optional drilldown: future-blocked details for operational follow-up.
WITH params AS (
	SELECT DATE('2026-05-11') AS cutoff_date
)
SELECT
	'supplier' AS source_type,
	st.id AS source_id,
	DATE(st.transaction_date) AS source_date,
	st.supplier_code,
	st.amount,
	st.debit,
	st.credit
FROM supplier_transactions st
WHERE st.company_id = 1
	AND st.status = 'posted'
	AND st.journal_entry_id IS NULL
	AND DATE(st.transaction_date) > (SELECT cutoff_date FROM params)
ORDER BY DATE(st.transaction_date), st.id;

WITH params AS (
	SELECT DATE('2026-05-11') AS cutoff_date
)
SELECT
	'inventory' AS source_type,
	im.id AS source_id,
	DATE(im.movement_date) AS source_date,
	im.supplier_code,
	im.movement_type,
	im.value_in,
	im.value_out,
	im.gl_posting_status
FROM inventory_movements im
WHERE im.company_id = 1
	AND im.status = 'posted'
	AND im.movement_type IN ('GRN', 'ISSUE')
	AND im.journal_entry_id IS NULL
	AND DATE(im.movement_date) > (SELECT cutoff_date FROM params)
ORDER BY DATE(im.movement_date), im.id;
