# 🏛️ Agri-Nile ERP - Corporate Audit Protocol (v1.0)

This document contains a structured prompt and checklist for performing a high-level corporate audit of the Agri-Nile ERP system following the 2026 data merge.

---

## 🎯 Auditor Prompt

> "You are a Senior Financial Auditor and ERP Implementation Specialist. Your goal is to conduct a **Business Integrity Audit** of the Agri-Nile Flow ERP system after a massive data migration of 1,000+ transactions. 
>
> Please analyze the current state using the following files:
> 1. `docs/DATABASE_AUDIT_REPORT.md` (System status)
> 2. `migrate/import.js` & `migrate/backfill_gl.js` (Migration logic)
> 3. The latest `reconcile.js` output (Parity report)
>
> **Focus on these 4 Dimensions:**
>
> 1. **Financial Accuracy**: Verify if the negative Treasury balance (-19,801 EGP) aligns with the historical revenue/expense flow from the Excel source. Is there an opening balance that was missed?
> 2. **Chart of Accounts (COA) Health**: Review the account structure. Does it support multi-dimensional reporting (Season/Field/Center)? 
> 3. **GL Automation Mapping**: Audit the current 10/15 mappings in `gl_account_mappings`. Are the 'Purchases' and 'COGS' accounts correctly linked to support automated inventory costing?
> 4. **Process Governance**: Evaluate the 'Draft-to-Post' status of the 955 journal entries. Are the business controls sufficient to prevent future orphans?
>
> Provide a summary for the CEO highlighting 'Financial Risks', 'Operational Gaps', and 'Optimization Opportunities'."

---

## 📋 Corporate Audit Checklist

### 1. Financial Controls
- [ ] **Opening Balance**: Is the -19k balance a result of transactions alone, or does it require a "Balance Forward" entry from 2025?
- [ ] **Account Reconciliation**: Do the Supplier Balances in the DB match the final "Accounts Payable" totals in the GL?

### 2. Operational Logic
- [ ] **Inventory Valuation**: Are the 700 movements valued at the correct unit price? (Check for outliers in `inventory_movements`).
- [ ] **Multi-Dimension Mapping**: Are there transactions without a `season_id` or `field_id` that should have them?

### 3. System Stability
- [ ] **Frontend Robustness**: Verify that all forms (Add Transaction, Add Movement) handle empty dropdowns gracefully (Stability Patch applied 2026-04-25).
- [ ] **Audit Trail**: Ensure `system_error_logs` is empty or only contains non-critical warnings.

### 4. Integration Settings
- [ ] **Module Activation**: Confirm that 'Inventory' and 'Operations' integrations are ENABLED for real-time GL posting.
- [ ] **Mapping Completion**: Map the remaining 5 accounts (Harvest/Bank) if those modules are planned for 2026.

---
> [!NOTE]
> This protocol is designed to be run periodically or after significant data imports to maintain corporate governance standards.
