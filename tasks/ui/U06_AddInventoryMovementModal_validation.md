# AddInventoryMovementModal — add client-side validation before submit
- Read AddInventoryMovementModal.tsx. Find the submit handler.
- Add validation: item_code required, quantity > 0, movement_date not blank, warehouse selected.
- Show inline error messages below each field (not a global toast) before the API call fires.
Verification:
- Submitting empty form shows field-level errors. No API call made until all required fields filled.
