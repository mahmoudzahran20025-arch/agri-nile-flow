# FinancialStatementsPage — add skeleton loader and error boundary
- Read FinancialStatementsPage.tsx. Find where it renders while isLoading.
- Replace blank screen with a skeleton (3-4 grey bars) while data loads.
- Add an error state: if query fails, show "فشل تحميل البيانات — حاول مرة أخرى" with retry button.
Verification:
- Slow network: skeleton visible during load. Broken API: error message with retry appears.
