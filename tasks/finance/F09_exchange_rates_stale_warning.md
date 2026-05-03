# ExchangeRatesPage — show warning if latest rate is older than 7 days
- Read ExchangeRatesPage.tsx. Find where rates are displayed.
- For each currency: compare updated_at to today. If diff > 7 days, show orange badge "قديم".
- Add a "تحديث" quick-button that opens the edit form pre-filled with the current rate.
Verification:
- A rate last updated 10 days ago shows the orange badge. Clicking update opens form correctly.
