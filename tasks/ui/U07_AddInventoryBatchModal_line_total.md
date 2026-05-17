# AddInventoryBatchModal — show running total per line and grand total
- Read AddInventoryBatchModal.tsx. Find where line items are rendered.
- Add a "المبلغ" column = quantity × unit_price, formatted as EGP.
- Show a footer row "الإجمالي" summing all line amounts.
Verification:
- Adding 3 lines shows correct per-line amounts and correct grand total in footer.
