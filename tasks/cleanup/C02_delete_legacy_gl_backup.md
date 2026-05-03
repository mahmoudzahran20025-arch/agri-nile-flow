# Delete src/api/gl.ts.legacy.backup
- Confirm the file is truly superseded by reading it vs current src/api/gl/ directory.
- If all exports are covered by current files, delete it with `git rm`.
- Search for any `import` that references this file path (should be zero).
Verification:
- `grep -r "gl.ts.legacy" src/` returns nothing. `npx tsc --noEmit` still passes.
