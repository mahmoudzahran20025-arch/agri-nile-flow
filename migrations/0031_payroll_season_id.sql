-- Attribute payroll runs to a season so staff costs appear in season P&L
ALTER TABLE payroll_runs ADD COLUMN season_id INTEGER REFERENCES seasons(id);
