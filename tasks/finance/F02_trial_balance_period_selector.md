# GlIntegrityAuditPage trial balance — pre-load current period dates automatically
- Read GlIntegrityAuditPage.tsx. The trial balance section requires manual date entry.
- Auto-populate from_date/to_date with the current open gl_period dates on mount.
- Fetch from GET /gl/periods?status=open&limit=1 and set the inputs.
Verification:
- Opening /gl/integrity-audit shows trial balance date range pre-filled with current period. Load button works immediately.
