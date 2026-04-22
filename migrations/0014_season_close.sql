-- Phase E-3: Season Close — add formal close metadata to seasons
ALTER TABLE seasons ADD COLUMN closed_at    TEXT;
ALTER TABLE seasons ADD COLUMN closed_by    INTEGER;
ALTER TABLE seasons ADD COLUMN close_notes  TEXT;
