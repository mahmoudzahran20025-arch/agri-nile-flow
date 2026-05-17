# Inventory tables overflow on mobile — add horizontal scroll wrapper
- Check InventoryMovementsPage, ItemMasterPage, TransactionHistoryPage on 375px viewport.
- Ensure the table container has `overflow-x-auto` and the table has `min-w-[800px]`.
- Column headers should not wrap. Action buttons should stay aligned.
Verification:
- All three pages scroll horizontally on mobile without breaking layout. No text overflow.
