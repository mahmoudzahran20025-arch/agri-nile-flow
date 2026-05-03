# Move all SESSION_*, AUDIT_*, PHASE_* docs to archive/docs/ and keep only README + ROADMAP
- Move ~80 *.md files (all except README.md and ROADMAP.md) to archive/docs/.
- Update README.md with a one-line note: "Historical audit documents are in archive/docs/".
- Commit the cleanup as a single chore commit.
Verification:
- Root directory has ≤5 .md files. `git log --oneline -1` shows the cleanup commit. Repo still builds.
