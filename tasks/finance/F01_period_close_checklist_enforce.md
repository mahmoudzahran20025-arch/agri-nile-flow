# PeriodCloseCockpit — enforce checklist before allowing close
- Read PeriodCloseCockpit.tsx. Find the "إغلاق الفترة" button.
- Add a pre-check: call GET /gl/reconciliation/integrity first. If critical_issues > 0, show blocking warning and disable the close button.
- Show a summary: "X قيد غير متوازن · Y حساب وهمي · الإغلاق غير مسموح حتى الحل".
Verification:
- Attempting to close a period with unbalanced entries shows the block. Clean period closes normally.
