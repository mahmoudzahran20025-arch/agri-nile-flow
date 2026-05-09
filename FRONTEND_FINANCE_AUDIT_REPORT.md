# Global Frontend Assessment

- **Overall Health & Aesthetics:** The UI is remarkably clean, modern, and adheres to a robust design system. The use of Tailwind CSS, Lucide icons, and intelligent components (like `LifecycleStepper`) creates a premium, Dynamics-like ERP experience.
- **Posting Engine Centralization:** Recent cleanups have significantly improved the Treasury and Supplier modules, successfully eliminating redundant inventory-like fields and enforcing a "Single Source of Truth" via `skipGlPosting`.
- **Transparency & Trust:** The inclusion of the `GLPreviewPanel` in the Inventory module is an exceptional UX pattern. It bridges the gap between operational users and accountants by showing the exact financial impact before submission.
- **Operational vs. Financial Disconnects:** While core finance forms are healthy, operational forms (like Contracts and Work Orders) suffer from "Ghost Data" — fields that suggest financial tracking (e.g., `paid_value` in Purchase Contracts) but do not actually trigger the GL Posting engine.
- **Missing Dimensional Data:** Some critical forms (like Inventory Issue) are missing key dimensional inputs (like `field_id`), which prevents accurate cost-center allocation for agricultural accounting.

---

# Forms & Inputs Review

### 1. Treasury Module
**Main Form:** `AddCashTransactionModal.tsx`
- **Field Analysis:**
  | Field | Business Meaning | Backend/DB | Posting Impact | Notes/Issues |
  |-------|------------------|------------|----------------|--------------|
  | `amount` | Cash Value | `cash_transactions.amount` | DR/CR Treasury | Cleaned up. Correctly replaces legacy qty/price logic. |
  | `partner_id`/`supplier_code`/`employee_id` | Counterparty | `cash_transactions.*_id` | Resolves Contra Account | Perfect routing through `resolveCashLedger`. |
  | `season_id` / `center_code` | Dimensions | `cash_transactions.season_id` | GL Line Dimensions | Works exactly as intended. |

### 2. Suppliers Module
**Main Form:** `AddSupplierTransactionModal.tsx`
**Field Analysis:**
  | Field | Business Meaning | Backend/DB | Posting Impact | Notes/Issues |
  |-------|------------------|------------|----------------|--------------|
  | `amount` | Invoice/Payment Value | `supplier_transactions.amount` | AP/Expense GL | Correctly simplified. |
  | `equipment_type_id` | Capital Asset Link | `supplier_transactions` | Capitalizes Asset | Triggers `createOwnedCapitalAsset` perfectly. |
  | `payment_method` | Cash vs Credit | Backend routing | `skipGlPosting` logic | Prevents double entries effectively. |

### 3. Inventory Module
**Main Forms:** `AddInventoryBatchModal.tsx`, `InternalTransferModal.tsx`
**Field Analysis:**
  | Field | Business Meaning | Backend/DB | Posting Impact | Notes/Issues |
  |-------|------------------|------------|----------------|--------------|
  | `movement_type` | GRN/ISSUE/etc. | `inventory_movements` | Determines DR/CR rules | Very clear and robust. |
  | `payment_method` | AP vs Treasury | Payload | Triggers Cash Movement | Excellent dual-entry integration. |
  | `center_code` | Cost Center | Payload | GL Line Dimension | Works, but missing crop allocation. |
  | ⚠️ **Missing: `field_id`** | Crop Dimension | *Not in UI* | Fails to tag crop cost | **CRITICAL ISSUE:** You cannot issue fertilizer to a specific field right now via the UI. |

### 4. Contracts Module
**Main Forms:** `ContractsPage.tsx` (Purchase / Sales / Advance Modals)
**Field Analysis:**
  | Field | Business Meaning | Backend/DB | Posting Impact | Notes/Issues |
  |-------|------------------|------------|----------------|--------------|
  | `advance_paid` (Sales) | Deposit received | `contract_advances` | DR Cash / CR Def. Rev | 🟢 Excellent. Creates GL entry automatically. |
  | ⚠️ `paid_value` (Purchases) | Deposit paid | `purchase_contracts` | **None (Ghost Data)** | **CRITICAL ISSUE:** It's a manual text input. It doesn't trigger Treasury or GL. |

---

# User Flow & UX

**1. Stock Receipt/Issue (Inventory) 🟢**
- **What works well:** The form is visually stunning. The real-time stock validation, `GLPreviewPanel`, and payment routing (`cash` vs `credit`) are top-tier ERP UX.
- **What to fix:** Add a `field_id` dropdown when `movement_type === 'ISSUE'` so users can allocate seeds/fertilizers directly to a crop.

**2. Work Order Execution (Operations) 🟡**
- **What works well:** The `LifecycleStepper` and `CostBreakdown` tabs provide incredible operational clarity.
- **What to fix:** The "Total Cost" is just an aggregation of tasks. There is no clear indication if marking an order as `costed` actually posts a "Farming Cost" entry to the GL. We need a "Post to GL" button or automated integration when `status === 'costed'`.

**3. Contract Advances (Sales vs Purchasing) 🔴**
- **What works well:** Receiving an advance on a Sales Contract opens a clean modal, takes the cash, and posts it to GL.
- **What to fix:** Inconsistent UX. Purchasing contracts have no "Pay Advance" button. Users are forced to type a number in `paid_value` and manually go to Treasury to issue cash, risking discrepancies.

---

# Posting Integration Findings

**🟢 Correct, Healthy Flows:**
- Direct Treasury Payments/Receipts.
- Supplier Invoices & Supplier Payments.
- Inventory Goods Receipt Note (GRN) — correctly updates AP or Cash based on payment method.
- Sales Contract Advances — correctly credits Deferred Revenue.

**🔴 Flows with Broken or Missing Posting:**
- **Purchase Contract Advances:** UI allows typing a `paid_value` without generating a cash movement or GL entry (Ghost Data).
- **Inventory Issues to Fields:** The backend `resolveInventoryMovement` supports dimension tagging (`field_id`), but the frontend form `AddInventoryBatchModal` forgets to include it. Operational costs are bleeding into general overhead.
- **Payroll/Wages:** `EmployeesPage.tsx` manages master data, but there is no "Payroll Run" form. Wages must be posted via generic Treasury payments, losing the connection to the Employee subledger.

---

# Legacy & Cleanup Plan

### Phase 1: Disable or Hide Broken/Legacy Paths (Immediate)
- **Purchase Contracts:** Make `paid_value` read-only. Remove it from the `createPurchase` payload.
- **Operations:** If `costed` status doesn't post to the GL, add an info tooltip: *"هذه التكلفة تقديرية ولا تولد قيداً محاسبياً تلقائياً"*.

### Phase 2: Align Forms + Posting for Critical Flows (Next Steps)
- **Inventory UI Update:** Add `field_id` to `BatchForm` in `AddInventoryBatchModal.tsx` (visible only if `movement_type === 'ISSUE'`). Pass it to `inventoryApi.createBatch`.
- **Purchase Contracts Update:** Duplicate the `Receive Advance Modal` from Sales Contracts into a `Pay Advance Modal` for Purchase Contracts, connecting it to `FinanceCore.recordCashMovement` (DR Advance to Suppliers / CR Treasury).

### Phase 3: UX Polish and Consistency Pass (Future)
- **Payroll Module:** Build a dedicated `PayrollRunModal` that iterates over active employees, generates a single massive GL entry (DR Wages / CR Treasury), and inserts records into `cash_transactions`.
- **Global `GLPreviewPanel`:** Extract the `GLPreviewPanel` component from the Inventory module and make it a shared component available in Treasury, Suppliers, and Contracts so accountants can always preview entries before saving.
