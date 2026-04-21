-- ============================================================
-- Migration 005 — Calendar Events & Tasks
-- ============================================================
-- نظام التقويم والمهام والاجتماعات
-- Supports: tasks / meetings / reminders / field visits
-- Any event can have a GPS location attached (optional)
-- Meetings can have multiple attendees (event_attendees table)
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- Main calendar events table
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id              INTEGER NOT NULL REFERENCES companies(id),
  created_by              INTEGER NOT NULL REFERENCES users(id),

  -- Ownership / assignment
  assigned_to_user        INTEGER REFERENCES users(id),
  assigned_to_employee    INTEGER REFERENCES employees(id),

  -- Content
  title                   TEXT    NOT NULL,
  description             TEXT,
  event_type              TEXT    NOT NULL DEFAULT 'task',
  -- Values: task | meeting | visit | reminder | other

  -- Priority
  priority                TEXT    NOT NULL DEFAULT 'normal',
  -- Values: low | normal | high | urgent

  -- Timing
  start_datetime          TEXT    NOT NULL,   -- ISO-8601 e.g. "2025-07-10T09:00"
  end_datetime            TEXT,               -- NULL = open-ended / all-day
  all_day                 INTEGER NOT NULL DEFAULT 0,  -- 1 = all-day event

  -- Status
  status                  TEXT    NOT NULL DEFAULT 'pending',
  -- Values: pending | in_progress | done | cancelled

  -- Optional GPS location (meeting room, field, client site …)
  location_name           TEXT,             -- human-readable label
  location_lat            REAL,
  location_lng            REAL,
  location_tolerance_m    INTEGER DEFAULT 150,   -- GPS check-in acceptance radius (metres)

  -- GPS check-in result (filled by employee when they "arrive")
  checkin_lat             REAL,
  checkin_lng             REAL,
  checkin_at              TEXT,             -- ISO-8601 timestamp
  location_verified       INTEGER DEFAULT 0,     -- 1 = within tolerance
  checkin_distance_m      REAL,

  -- Cross-reference to other modules (optional)
  -- e.g. link a visit task to a specific field or supplier
  ref_table               TEXT,   -- 'fields' | 'suppliers' | 'employees' | …
  ref_id                  INTEGER,

  -- Soft link to location_tasks (auto-created for visits with GPS)
  location_task_id        INTEGER REFERENCES location_tasks(id),

  -- Colour for calendar display (hex)
  color                   TEXT    DEFAULT '#3B82F6',

  -- Recurrence (future use — store RRULE string)
  recurrence_rule         TEXT,

  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ──────────────────────────────────────────────────────────────
-- Attendees for meetings (many-to-many)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_attendees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  employee_id INTEGER REFERENCES employees(id),
  name        TEXT,            -- free-text name (for external guests)
  email       TEXT,
  response    TEXT NOT NULL DEFAULT 'pending',
  -- Values: pending | accepted | declined
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ──────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ce_company
  ON calendar_events(company_id);

CREATE INDEX IF NOT EXISTS idx_ce_start
  ON calendar_events(company_id, start_datetime);

CREATE INDEX IF NOT EXISTS idx_ce_assigned_user
  ON calendar_events(assigned_to_user)
  WHERE assigned_to_user IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ce_assigned_emp
  ON calendar_events(assigned_to_employee)
  WHERE assigned_to_employee IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ce_status
  ON calendar_events(company_id, status);

CREATE INDEX IF NOT EXISTS idx_ce_type
  ON calendar_events(company_id, event_type);

CREATE INDEX IF NOT EXISTS idx_ea_event
  ON event_attendees(event_id);
