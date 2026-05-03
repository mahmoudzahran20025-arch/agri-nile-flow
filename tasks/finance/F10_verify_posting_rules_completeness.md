# Verify all active posting_rules have valid account_code in chart_of_accounts
- Query: SELECT pr.id, pr.mapping_key, pr.account_code FROM posting_rules pr LEFT JOIN chart_of_accounts coa ON coa.company_id=pr.company_id AND coa.code=pr.account_code WHERE coa.id IS NULL AND pr.is_active=1.
- Any orphan rules: either fix the account_code or deactivate the rule.
- Run migration if needed. Document count before/after.
Verification:
- Query returns 0. PostingSetupHealthPage shows 100% account coverage.
