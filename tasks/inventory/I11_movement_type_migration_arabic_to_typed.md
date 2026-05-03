# Migrate Arabic movement_type values to typed codes (صرف→ISSUE, اضافة→GRN)
- Write migration 0087: UPDATE inventory_movements SET movement_type = 'GRN' WHERE movement_type = 'اضافة', and SET movement_type = 'ISSUE' WHERE movement_type = 'صرف'.
- Wrap in a transaction. Verify count before and after.
- After migration: remove Arabic aliases from isSupportedMovementType() in inventory_posting.ts.
Verification:
- SELECT DISTINCT movement_type FROM inventory_movements returns only typed codes. All movements page still loads correctly.
