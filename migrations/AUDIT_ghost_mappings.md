# Ghost Account Mappings Audit
**Date:** 2025-01-01  
**Database:** agri-nile-flow-data-lake  
**Query used:**  
```sql
SELECT m.mapping_key, m.account_code
FROM gl_account_mappings m
WHERE m.account_code NOT IN (
  SELECT code FROM chart_of_accounts WHERE company_id = m.company_id
)
ORDER BY m.mapping_key;
```

---

## Summary

8 of 19 `gl_account_mappings` rows reference account codes that **do not exist** in `chart_of_accounts`. Every auto-post that uses these keys writes to ghost (non-existent) accounts, producing 1,478 orphan `journal_entry_lines` rows.

---

## Ghost Mapping Details

### 1. `cogs` → `5110` ❌
| Field | Value |
|---|---|
| ghost account_code | `5110` |
| CoA result | NULL (not found) |
| **Code paths that use this key** | `gl.ts::glInventoryMovement()` — withdrawal with work_order_id; `gl.ts::glWorkOrderLabor()` |
| **Recommended replacement** | `45010001` — "تكلفة المبيعات" (account_type=revenue, is_header=0) |
| **Notes** | `45010001` is the live COGS account. account_type='revenue' is expected in this CoA (contra-revenue treatment). Verify `is_header=0` before applying. |

---

### 2. `expense` → `5410` ❌
| Field | Value |
|---|---|
| ghost account_code | `5410` |
| CoA result | NULL (not found) |
| **Code paths that use this key** | `gl.ts::glSupplierTransaction()` — debit side for 'د' entries; fallback in multiple functions |
| **Recommended replacement** | `51200034` — "مصروفات متنوعة" (account_type=expense, general catch-all) |
| **Notes** | This is the generic expense fallback. Consider whether a more specific expense account is appropriate per transaction type. |

---

### 3. `expense_default` → `5410` ❌
| Field | Value |
|---|---|
| ghost account_code | `5410` |
| CoA result | NULL (not found) |
| **Code paths that use this key** | `gl.ts::glCashTransaction()` — expense direction fallback; `gl.ts::glSupplierTransaction()` AP fallback; `finance_core.ts::prepareCashMovement()` — `expense_default` key for non-supplier, non-partner cash-out |
| **Recommended replacement** | `51200034` — "مصروفات متنوعة" (account_type=expense) |
| **Notes** | Same account as `expense` key. Both can be fixed with the same UPDATE. |

---

### 4. `inventory` → `1130` ❌
| Field | Value |
|---|---|
| ghost account_code | `1130` |
| CoA result | NULL (not found) |
| **Code paths that use this key** | `gl.ts::glInventoryMovement()` — both addition (DR) and withdrawal (CR); `finance_core.ts::processPOReceipt()` — inline `invAcc` lookup; `finance_core.ts::postHarvestLedger()` — COGS CR side |
| **Recommended replacement** | `140701` — "المخزون -المحصول" (account_type=asset, is_header=0) |
| **Notes** | `140701` is the parent inventory summary account. Sub-accounts `14070101`–`14070106` exist per commodity (fertilizer, seeds, irrigation, spare parts, misc). If posting-group setup is used, the engine should route to the correct sub-account via `inventory_posting_setup`. For the flat mapping fix, `140701` is the safest catch-all. |

---

### 5. `purchases` → `5110` ❌
| Field | Value |
|---|---|
| ghost account_code | `5110` |
| CoA result | NULL (not found) |
| **Code paths that use this key** | `gl.ts::glSupplierInvoice()` — primary lookup (`purchases` key, falls back to `expense_default`) |
| **Recommended replacement** | `45010001` — "تكلفة المبيعات" (COGS account) |
| **Notes** | Shares ghost code `5110` with `cogs`. In the context of `glSupplierInvoice`, the debit side should be a purchases/expense account. If purchases should be expensed immediately, `51200024` ("مقاولات نقل - مشتريات", account_type=expense) may also be appropriate depending on transaction type. |

---

### 6. `revenue` → `4210` ❌
| Field | Value |
|---|---|
| ghost account_code | `4210` |
| CoA result | NULL (not found) |
| **Code paths that use this key** | `gl.ts::glCashTransaction()` — credit side when direction='د' (income) as part of contraAccountOverride chain |
| **Recommended replacement** | `41010001` — "إيراد نشاط المحصول" (account_type=revenue, is_header=0) |
| **Notes** | This is the primary crop revenue account. For non-crop revenue, `71030001`–`71030004` (misc revenue sub-accounts) may be more appropriate. |

---

### 7. `revenue_default` → `4210` ❌
| Field | Value |
|---|---|
| ghost account_code | `4210` |
| CoA result | NULL (not found) |
| **Code paths that use this key** | `gl.ts::glCashTransaction()` — fallback when no contraAccountOverride; `finance_core.ts::prepareCashMovement()` — fallback for non-supplier, non-partner cash-in |
| **Recommended replacement** | `41010001` — "إيراد نشاط المحصول" (account_type=revenue, is_header=0) |
| **Notes** | Same ghost code as `revenue`. Both can be fixed with the same UPDATE. |

---

### 8. `wages` → `5210` ❌
| Field | Value |
|---|---|
| ghost account_code | `5210` |
| CoA result | NULL (not found) |
| **Code paths that use this key** | `gl.ts::glPayroll()` — debit side (wages expense); fallback: uses `expense_default` if `wages` is missing |
| **Recommended replacement** | `51010001` — "الأجور والمرتبات" (account_type=expense, is_header=0) |
| **Notes** | This is the primary wages/salaries expense account. Already present and active in live CoA. |

---

## Valid Mappings (for reference — do NOT change)

| mapping_key | account_code | Status |
|---|---|---|
| `accounts_payable` | `2110` | ✅ valid |
| `bank` | `14010301` | ✅ valid |
| `cash` | `1110` | ✅ valid |
| `deferred_revenue` | `2210` | ✅ valid |
| `equity` | `3` | ✅ valid (header — used for reporting only) |
| `harvest_cogs` | `6` | ✅ valid |
| `harvest_revenue` | `7` | ✅ valid |
| `partner_current_account` | `2105` | ✅ valid |
| `payable` | `2110` | ✅ valid (duplicate of accounts_payable) |
| `receivable_default` | `1403` | ✅ valid |
| `wages_payable` | `2120` | ✅ valid |

---

## Impact Assessment

| Ghost Key | Transactions Affected | Risk Level |
|---|---|---|
| `inventory` | All inventory movements (700 in DB) + PO receipts | 🔴 CRITICAL |
| `cogs` / `purchases` | All work-order costs + supplier invoices | 🔴 CRITICAL |
| `revenue_default` / `revenue` | All cash-in transactions (non-supplier) | 🔴 CRITICAL |
| `expense_default` / `expense` | All cash-out transactions + supplier debits | 🔴 CRITICAL |
| `wages` | All payroll runs (6 employees) | 🟠 HIGH |

**Total orphan journal lines confirmed:** 1,478 (from diagnostic A-02)

---

## Remediation Path

### Option A — Quick Fix (low risk, no engine required)
Run `FIX_ghost_mappings.sql` after manual review to UPDATE the 8 broken mapping rows.  
✅ Fixes all future auto-posts  
⚠️ Historical orphan entries (1,478 lines) remain unlinked unless separately corrected

### Option B — Full Engine Migration (posting_engine.ts)
Enable `ENABLE_POSTING_ENGINE` flag after seeding `general_posting_setup` and `inventory_posting_setup`.  
✅ Account resolution becomes per-document-type accurate  
✅ Historical orphan entries stop growing  
⚠️ Requires data entry: populate 5 new posting-group setup tables first  

### Recommended Sequence (Hybrid)
1. **Now (safe):** Apply `FIX_ghost_mappings.sql` — stops new ghost writes immediately
2. **Next sprint:** Populate posting-group tables (BPG/PPG/IPG codes + GPS/IPS matrix rows)  
3. **Then:** Flip `ENABLE_POSTING_ENGINE = true` in `gl_integration_settings`  
4. **Finally:** Archive/reconcile the 1,478 existing orphan lines with the correct accounts

---

*Generated by: Agri-Nile Flow ERP Audit — Phase 3*
