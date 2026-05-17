-- 0093_work_order_equipment_journal_link.sql
-- Goal: Track GL posting per equipment line to avoid duplicate posting
--       and support traceability at work_order_equipment row level.

ALTER TABLE work_order_equipment ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);

CREATE INDEX IF NOT EXISTS idx_woe_journal_entry ON work_order_equipment(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_woe_company_unposted ON work_order_equipment(company_id, work_order_id, journal_entry_id);
