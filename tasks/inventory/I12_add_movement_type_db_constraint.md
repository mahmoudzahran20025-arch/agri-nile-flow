# Add DB-level CHECK constraint on inventory_movements.movement_type
- Write migration 0088: recreate table with CHECK(movement_type IN ('GRN','ISSUE','TRANSFER_IN','TRANSFER_OUT','RETURN_SUPPLIER','RETURN_CUSTOMER','ADJUSTMENT_PROFIT','ADJUSTMENT_LOSS','PRODUCTION_IN','PRODUCTION_OUT')) — or add a trigger if SQLite doesn't support ALTER ADD CONSTRAINT.
- Use BEFORE INSERT trigger approach: RAISE(ABORT, 'invalid movement_type') if value not in set.
- Also add trigger for UPDATE.
Verification:
- INSERT with movement_type='اضافة' fails with error. INSERT with 'GRN' succeeds.
