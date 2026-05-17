# Confirm src/api/gl.ts.legacy.backup is fully superseded then delete
- Run: diff <(grep "export" src/api/gl.ts.legacy.backup) <(grep "export" web/src/api/gl.ts) to check coverage.
- Grep all source files for imports of gl.ts.legacy — should be zero.
- If confirmed unused: git rm src/api/gl.ts.legacy.backup.
Verification:
- File is gone. `npx tsc --noEmit` passes. No import errors.
