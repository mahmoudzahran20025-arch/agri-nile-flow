# Audit every Route in App.tsx has an existing page file and vice versa
- Extract all lazy() imports from App.tsx. Verify each file exists in web/src/pages/.
- Extract all .tsx files in web/src/pages/**. Verify each is imported in App.tsx.
- Flag: imports with no file (will crash at runtime) and files with no route (dead code).
Verification:
- Zero missing files. Zero orphan page files (or each orphan is documented as intentionally unused).
