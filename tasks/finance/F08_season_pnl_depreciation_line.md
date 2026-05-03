# SeasonPnLPage — add depreciation cost line (Cost 7)
- Read src/api/reports/season.ts. Find the cost lines array.
- Add cost line 7: sum depreciation_schedules.amount WHERE period falls within season dates and asset.center_code matches.
- Show as "إهلاك الأصول الثابتة" in the P&L table with its own line.
Verification:
- Season with active fixed assets shows depreciation line. Season with no assets shows 0 or hides the line.
