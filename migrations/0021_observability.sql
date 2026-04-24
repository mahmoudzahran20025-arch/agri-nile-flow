-- Migration: System Observability
CREATE TABLE IF NOT EXISTS system_error_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id       INTEGER,
    user_id          INTEGER,
    endpoint         TEXT NOT NULL,
    method           TEXT NOT NULL,
    error_message    TEXT NOT NULL,
    stack_trace      TEXT,
    request_payload  TEXT, -- JSON string of the request body
    created_at       DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_error_date ON system_error_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_error_company ON system_error_logs(company_id);
