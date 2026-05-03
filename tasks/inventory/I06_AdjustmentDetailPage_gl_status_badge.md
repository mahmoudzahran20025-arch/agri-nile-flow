# AdjustmentDetailPage — show GL posting status per movement line
- Read AdjustmentDetailPage.tsx. Currently shows line items without GL status.
- Add a gl_posting_status badge column (same style as InventoryMovementsPage): posted/pending/failed/exempt.
- Pull journal_entry_id from the API response and make it a link to /gl/entries?id=X.
Verification:
- Opening any adjustment shows green "مرحّل" badge or yellow "معلق" per line. GL link opens correct entry.
