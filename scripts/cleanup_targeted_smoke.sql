DELETE FROM journal_entries
WHERE company_id = 1
  AND (
    lower(coalesce(description,'')) LIKE '%smoke test%'
    OR lower(coalesce(entry_number,'')) LIKE 'smoke-%'
  );
