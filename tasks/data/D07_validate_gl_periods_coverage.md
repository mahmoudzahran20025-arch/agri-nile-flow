# Every journal_entry must fall within an existing gl_period
- SELECT je.id, je.entry_date FROM journal_entries je LEFT JOIN gl_periods p ON je.entry_date BETWEEN p.period_start AND p.period_end WHERE p.id IS NULL.
- Any orphan entries: create a catch-all open period covering the gap, or investigate.
- Ensure no period has status='locked' covering entries dated in the future.
Verification:
- Query returns 0. PeriodsPage shows continuous coverage with no gaps.
