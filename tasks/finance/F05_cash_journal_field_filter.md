# CashJournalPage — add field_id filter to cash transactions
- Cash transactions have field_id column. CashJournalPage likely doesn't filter by field.
- Add a "الحقل" dropdown (from configApi.fields) to the filter bar.
- Pass field_id param to GET /api/treasury/cash and add WHERE field_id = ? in SQL.
Verification:
- Selecting a field shows only its cash transactions. Total updates to match filtered set.
