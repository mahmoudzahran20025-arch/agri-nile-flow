-- Add analytical dimensions (season_id, field_id) to journal_entry_lines
ALTER TABLE journal_entry_lines ADD COLUMN season_id INTEGER REFERENCES seasons(id);
ALTER TABLE journal_entry_lines ADD COLUMN field_id INTEGER REFERENCES fields(id);
