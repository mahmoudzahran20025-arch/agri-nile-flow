-- 0047_cost_centers_unique_code_index.sql
-- Purpose: enforce unique cost center code per company for FK-safe references.
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_centers_code
ON cost_centers(company_id, code);
