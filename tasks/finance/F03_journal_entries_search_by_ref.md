# JournalEntriesPage — add search by source document reference
- Read JournalEntriesPage.tsx. Check if ref_id / source_type search exists.
- If missing: add a search input that filters by description OR source_id (as entered).
- Pass to backend GET /gl/entries?search=X and filter in SQL with LIKE.
Verification:
- Searching "INV-2026-001" shows only entries with that document reference. Empty state if none.
