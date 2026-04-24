-- Migration: Add closure-related fields to seasons table
-- Required for the formal season-close workflow

ALTER TABLE seasons ADD COLUMN closed_at TEXT;
ALTER TABLE seasons ADD COLUMN closed_by TEXT;
ALTER TABLE seasons ADD COLUMN close_notes TEXT;
