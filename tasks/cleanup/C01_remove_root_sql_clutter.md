# Move 50+ loose SQL files from project root to archive/
- Create `archive/sql/` folder, move all *.sql files from root (not in migrations/).
- Keep only README.md and ROADMAP.md in root; move all other *.md audit/session docs to `archive/docs/`.
- Add `archive/` to .gitignore so it doesn't pollute git history.
Verification:
- `ls *.sql` and `ls *.md` in root return only README.md and ROADMAP.md.
