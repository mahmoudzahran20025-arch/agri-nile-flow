-- Migration 0106: Reclassify AP account for supplier 20900151 based on backfilled service_type_code
-- Current governance classification for historical rows is SRV_SUPPLY -> AP 212000010.

UPDATE journal_entry_lines
SET account_code = '212000010'
WHERE id IN (
  SELECT jel.id
  FROM journal_entry_lines jel
  JOIN journal_entries je
    ON je.id = jel.entry_id
   AND je.company_id = jel.company_id
  JOIN supplier_transactions st
    ON st.company_id = je.company_id
   AND st.journal_entry_id = je.id
  WHERE je.ref_type = 'supplier_transaction'
    AND st.supplier_code = 20900151
    AND st.service_type_code = 'SRV_SUPPLY'
    AND jel.account_code = '212000013'
);
