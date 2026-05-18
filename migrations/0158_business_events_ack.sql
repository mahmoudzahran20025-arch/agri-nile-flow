-- 0158: Add acknowledged flag to business_events for error dismissal
-- Allows accountants to acknowledge known GL posting failures without auto-retry.

ALTER TABLE business_events ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_events ADD COLUMN acknowledged_by INTEGER;
ALTER TABLE business_events ADD COLUMN acknowledged_at TEXT;

CREATE INDEX IF NOT EXISTS idx_business_events_error_ack
ON business_events (company_id, status, acknowledged)
WHERE status = 'error';
