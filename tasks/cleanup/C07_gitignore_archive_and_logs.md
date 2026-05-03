# Update .gitignore to exclude archive/, logs, and debug scripts
- Read current .gitignore. Add: archive/, *.local.sql, fix_*.js, gl_audit_*.js, test_financial_*.js.
- Move fix_negative_stock.js, gl_audit_stock_recon.js, test_financial_period_close_flow.js to archive/.
- These are debug scripts that should not be in the tracked codebase.
Verification:
- `git status` shows none of the debug scripts as tracked. `git ls-files *.js` at root returns only package.json-adjacent files.
