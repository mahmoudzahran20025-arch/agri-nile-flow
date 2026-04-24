-- Migration 0027: Payroll Payment Columns
-- Required for the new /pay endpoint in HR module to track actual cash disbursement.

ALTER TABLE payroll_runs ADD COLUMN payment_date TEXT;
ALTER TABLE payroll_runs ADD COLUMN payment_gl_entry_id INTEGER REFERENCES journal_entries(id);

-- Also ensure salary_advances has the necessary link for payroll tracking
-- if not already there from previous manual runs.
CREATE INDEX IF NOT EXISTS idx_payroll_items_employee ON payroll_items(employee_id);
